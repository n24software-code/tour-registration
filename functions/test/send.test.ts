import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import * as nodemailer from 'nodemailer';
import { MAX_ATTEMPTS, deliverMail, isTransient } from '../src/send';
import { isSecurePort } from '../src/config';
import { FakeDoc, MailCatcher } from './catcher';

const FROM = 'Tour Registration <tours@example.test>';

/** The shape /api/register writes, with a tour name that has to be escaped. */
const mailDoc = (over: Record<string, unknown> = {}) => ({
  to: 'visitor@example.test',
  message: {
    subject: 'Booking confirmed – SABIC - Home of Innovation – Batch 1 – K7QM2P',
    text: [
      'Hi Layla,', '', 'Your booking for SABIC - Home of Innovation – Batch 1 is confirmed.', '',
      'Your code: K7QM2P', 'Date: Thu, 15 Oct 2026', 'Departure time: 08:00',
      'Pickup point: Main pickup area', '',
      'Arrive 15 minutes before departure and show this code to our team.',
    ].join('\n'),
    html: '<p>Hi Layla,</p><p>Code <b>K7QM2P</b> for KAPSARC &amp; Black Gold &lt;script&gt;x&lt;/script&gt;</p>',
  },
  ...over,
});

describe('port → secure', () => {
  it('465 is implicit TLS, 587 and 25 are not', () => {
    assert.equal(isSecurePort(465), true);
    assert.equal(isSecurePort(587), false);
    assert.equal(isSecurePort(25), false);
  });
});

describe('isTransient', () => {
  it('retries connection faults and 4xx, not 5xx or plain bugs', () => {
    assert.equal(isTransient({ code: 'ETIMEDOUT' }), true);
    assert.equal(isTransient({ code: 'ECONNREFUSED' }), true);
    assert.equal(isTransient({ responseCode: 451, message: 'try later' }), true);
    assert.equal(isTransient({ responseCode: 550, message: 'no such user' }), false);
    assert.equal(isTransient(new TypeError('bug')), false);
  });
});

describe('deliverMail — success', () => {
  const catcher = new MailCatcher();
  let transport: nodemailer.Transporter;

  before(async () => {
    const port = await catcher.start();
    transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true });
  });
  after(async () => { transport.close(); await catcher.stop(); });

  it('delivers the message and records SUCCESS', async () => {
    const doc = new FakeDoc(mailDoc());
    const outcome = await deliverMail(doc, { transport, from: FROM });

    assert.equal(outcome.status, 'sent');
    assert.equal(catcher.caught.length, 1);

    const { parsed, to } = catcher.caught[0];
    assert.deepEqual(to, ['visitor@example.test']);
    assert.equal(parsed.subject, 'Booking confirmed – SABIC - Home of Innovation – Batch 1 – K7QM2P');
    // The batch, its departure time, the code and the pickup point all survive.
    assert.match(parsed.text!, /Batch 1/);
    assert.match(parsed.text!, /Departure time: 08:00/);
    assert.match(parsed.text!, /Your code: K7QM2P/);
    assert.match(parsed.text!, /Pickup point: Main pickup area/);
    // The HTML arrives escaped — no live tag, and the entities intact.
    const html = parsed.html as string;
    assert.equal(typeof html, 'string');
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;script&gt;/);
    // From falls back to the configured sender when the document has none.
    assert.match(parsed.from!.text, /tours@example\.test/);

    // Delivery is recorded in the extension's shape.
    assert.equal(doc.delivery.state, 'SUCCESS');
    assert.equal(doc.delivery.attempts, 1);
    assert.ok((doc.delivery.info as { messageId?: string }).messageId);
    assert.equal(doc.delivery.error, null);
    // It passed through PROCESSING first, so a concurrent run would have bailed out.
    assert.equal((doc.writes[0].delivery as { state: string }).state, 'PROCESSING');
  });

  it("uses the document's own from and replyTo when present", async () => {
    const doc = new FakeDoc(mailDoc({ from: 'Other <other@example.test>', replyTo: 'reply@example.test' }));
    await deliverMail(doc, { transport, from: FROM });

    const last = catcher.caught[catcher.caught.length - 1];
    assert.match(last.parsed.from!.text, /other@example\.test/);
    assert.match(last.parsed.replyTo!.text, /reply@example\.test/);
  });

  it('is idempotent: an already-delivered document is not sent again', async () => {
    const before = catcher.caught.length;
    const doc = new FakeDoc(mailDoc({ delivery: { state: 'SUCCESS', attempts: 1 } }));
    const outcome = await deliverMail(doc, { transport, from: FROM });

    assert.equal(outcome.status, 'skipped');
    assert.equal((outcome as { reason: string }).reason, 'already delivered');
    assert.equal(catcher.caught.length, before, 'no second copy');
    assert.equal(doc.writes.length, 0, 'nothing was written');
  });

  it('leaves a document another invocation is already working on', async () => {
    const before = catcher.caught.length;
    const doc = new FakeDoc(mailDoc({ delivery: { state: 'PROCESSING', attempts: 1 } }));
    const outcome = await deliverMail(doc, { transport, from: FROM });

    assert.equal(outcome.status, 'skipped');
    assert.equal(catcher.caught.length, before);
  });

  it('refuses a document with no recipient', async () => {
    const doc = new FakeDoc(mailDoc({ to: '' }));
    const outcome = await deliverMail(doc, { transport, from: FROM });

    assert.equal(outcome.status, 'failed');
    assert.equal(doc.delivery.state, 'ERROR');
    assert.equal(doc.delivery.error, 'No recipient address.');
  });

  it('skips a document that has been deleted', async () => {
    const doc = new FakeDoc(undefined);
    const outcome = await deliverMail(doc, { transport, from: FROM });
    assert.equal(outcome.status, 'skipped');
  });
});

describe('deliverMail — failure and retry', () => {
  const catcher = new MailCatcher({ code: 451, message: 'Temporary local problem' });
  let transport: nodemailer.Transporter;

  before(async () => {
    const port = await catcher.start();
    transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true });
  });
  after(async () => { transport.close(); await catcher.stop(); });

  it('records RETRY on a transient failure, and asks for another attempt', async () => {
    const doc = new FakeDoc(mailDoc());
    const outcome = await deliverMail(doc, { transport, from: FROM });

    assert.equal(outcome.status, 'failed');
    assert.equal((outcome as { retry: boolean }).retry, true);
    assert.equal(doc.delivery.state, 'RETRY');
    assert.equal(doc.delivery.attempts, 1);
    assert.match(String(doc.delivery.error), /Temporary local problem/);
  });

  it(`gives up as ERROR on attempt ${MAX_ATTEMPTS} and stops asking`, async () => {
    const doc = new FakeDoc(mailDoc());
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const outcome = await deliverMail(doc, { transport, from: FROM });
      const isLast = i === MAX_ATTEMPTS - 1;
      assert.equal((outcome as { retry: boolean }).retry, !isLast, `attempt ${i + 1}`);
    }
    assert.equal(doc.delivery.state, 'ERROR');
    assert.equal(doc.delivery.attempts, MAX_ATTEMPTS);

    // A further event finds the counter spent and refuses outright.
    const extra = await deliverMail(doc, { transport, from: FROM });
    assert.equal((extra as { retry: boolean }).retry, false);
    assert.equal(doc.delivery.state, 'ERROR');
  });
});

describe('deliverMail — permanent rejection', () => {
  const catcher = new MailCatcher({ code: 550, message: 'Mailbox unavailable' });
  let transport: nodemailer.Transporter;

  before(async () => {
    const port = await catcher.start();
    transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true });
  });
  after(async () => { transport.close(); await catcher.stop(); });

  it('does not retry a 5xx', async () => {
    const doc = new FakeDoc(mailDoc());
    const outcome = await deliverMail(doc, { transport, from: FROM });

    assert.equal((outcome as { retry: boolean }).retry, false);
    assert.equal(doc.delivery.state, 'ERROR');
    assert.equal(doc.delivery.attempts, 1);
  });
});

describe('deliverMail — unreachable server', () => {
  it('treats a refused connection as transient', async () => {
    // Port 1 is never listening.
    const transport = nodemailer.createTransport({
      host: '127.0.0.1', port: 1, secure: false, connectionTimeout: 2000,
    });
    const doc = new FakeDoc(mailDoc());
    const outcome = await deliverMail(doc, { transport, from: FROM });
    transport.close();

    assert.equal(outcome.status, 'failed');
    assert.equal((outcome as { retry: boolean }).retry, true);
    assert.equal(doc.delivery.state, 'RETRY');
  });
});
