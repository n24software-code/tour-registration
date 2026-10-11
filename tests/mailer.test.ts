/**
 * The confirmation sender, against a real SMTP server on localhost. No external
 * service, no credentials — the catcher collects whatever is delivered to it.
 */
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import nodemailer, { type Transporter } from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import { buildMailDoc } from '../lib/mail';
import { isSecurePort, isTransient } from '../lib/smtp';

interface Caught { to: string[]; parsed: ParsedMail }

class Catcher {
  readonly caught: Caught[] = [];
  private server?: SMTPServer;
  port = 0;
  constructor(private readonly failWith?: { code: number; message: string }) {}

  async start() {
    const fail = this.failWith;
    this.server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData: (stream, session, callback) => {
        if (fail) {
          stream.resume();
          stream.on('end', () => {
            const e = new Error(fail.message) as Error & { responseCode: number };
            e.responseCode = fail.code;
            callback(e);
          });
          return;
        }
        simpleParser(stream)
          .then((parsed) => {
            this.caught.push({ to: session.envelope.rcptTo.map((r) => r.address), parsed });
            callback();
          })
          .catch((e) => callback(e as Error));
      },
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = (this.server!.server.address() as AddressInfo).port;
    return this.port;
  }

  async stop() {
    if (!this.server) return;
    await new Promise<void>((r) => this.server!.close(() => r()));
  }
}

/** The booking that produces the message — a SABIC Batch 1 with Boulevard-style notices. */
const booking = {
  to: 'visitor@example.test',
  code: 'K7QM2P',
  name: 'Layla Al Qahtani',
  tourName: 'SABIC - Home of Innovation',
  batch: 1,
  tourDate: '2026-11-05',
  departureTime: '08:00',
  pickupPoint: 'Main pickup area',
  experienceDuration: '15–20 minutes from entering the experience venue',
  notices: ['Photography is strictly prohibited inside the experience.'],
};

describe('port → secure', () => {
  it('465 is implicit TLS; 587 and 25 are not', () => {
    assert.equal(isSecurePort(465), true);
    assert.equal(isSecurePort(587), false);
    assert.equal(isSecurePort(25), false);
  });
});

describe('isTransient', () => {
  it('retries connection faults and 4xx, not 5xx or plain bugs', () => {
    assert.equal(isTransient({ code: 'ECONNREFUSED' }), true);
    assert.equal(isTransient({ responseCode: 451 }), true);
    assert.equal(isTransient({ responseCode: 550 }), false);
    assert.equal(isTransient(new TypeError('bug')), false);
  });
});

describe('the confirmation message', () => {
  const catcher = new Catcher();
  let transport: Transporter;

  before(async () => {
    const port = await catcher.start();
    transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true });
  });
  after(async () => { transport.close(); await catcher.stop(); });

  it('carries the code, tour, batch, time and pickup, and never the ID number', async () => {
    const doc = buildMailDoc(booking);
    await transport.sendMail({
      from: 'Tour Registration <tours@example.test>',
      to: doc.to,
      subject: doc.message.subject,
      text: doc.message.text,
      html: doc.message.html,
    });

    assert.equal(catcher.caught.length, 1);
    const { parsed, to } = catcher.caught[0];
    assert.deepEqual(to, ['visitor@example.test']);
    assert.equal(parsed.subject, 'Booking confirmed – SABIC - Home of Innovation – Batch 1 – K7QM2P');

    for (const body of [parsed.text!, parsed.html as string]) {
      assert.match(body, /K7QM2P/, 'the code');
      assert.match(body, /SABIC - Home of Innovation/, 'the tour');
      assert.match(body, /Batch/, 'the batch');
      assert.match(body, /08:00/, 'the departure time');
      assert.match(body, /Main pickup area/, 'the pickup point');
      assert.match(body, /Arrive 15 minutes before departure/);
      assert.match(body, /15–20 minutes from entering the experience venue/, 'the duration');
      assert.match(body, /Photography is strictly prohibited/, 'the notices');
      assert.match(body, /registered\/K7QM2P/, 'the booking link');
    }

    // The identity document must never reach the visitor's inbox.
    for (const secret of ['1000000008', 'E2E12345678', 'national_id', 'idNumber']) {
      assert.ok(!parsed.text!.includes(secret), `text must not contain ${secret}`);
      assert.ok(!(parsed.html as string).includes(secret), `html must not contain ${secret}`);
    }
  });

  it('escapes anything a visitor typed', async () => {
    const doc = buildMailDoc({
      ...booking,
      name: '<script>alert(1)</script> Nasty',
      tourName: 'KAPSARC & Black Gold <Museum>',
    });
    await transport.sendMail({
      from: 'Tour Registration <tours@example.test>',
      to: doc.to, subject: doc.message.subject,
      text: doc.message.text, html: doc.message.html,
    });

    const html = catcher.caught[catcher.caught.length - 1].parsed.html as string;
    assert.ok(!html.includes('<script>'), 'no live script tag');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&amp;/, 'the ampersand in the tour name is escaped');
    // The plain-text part is not markup, so it keeps the characters as typed.
    assert.match(catcher.caught[catcher.caught.length - 1].parsed.text!, /KAPSARC & Black Gold/);
  });

  it('uses absolute URLs for the logos', () => {
    const html = buildMailDoc(booking).message.html;
    const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(srcs.length, 3, 'three partner logos');
    for (const src of srcs) assert.match(src, /^https?:\/\//, `${src} must be absolute`);
  });

  it('omits the batch line for a tour that does not run in batches', () => {
    const doc = buildMailDoc({ ...booking, batch: null, tourName: 'Boulevard City' });
    assert.equal(doc.message.subject, 'Booking confirmed – Boulevard City – K7QM2P');
    assert.ok(!/Batch/.test(doc.message.text));
  });
});

describe('a failing SMTP server', () => {
  const catcher = new Catcher({ code: 451, message: 'Temporary local problem' });
  let transport: Transporter;

  before(async () => {
    const port = await catcher.start();
    transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true });
  });
  after(async () => { transport.close(); await catcher.stop(); });

  it('surfaces a 4xx as a transient error worth retrying', async () => {
    const doc = buildMailDoc(booking);
    let thrown: unknown;
    try {
      await transport.sendMail({
        from: 'a@b.test', to: doc.to, subject: doc.message.subject,
        text: doc.message.text, html: doc.message.html,
      });
    } catch (e) { thrown = e; }
    assert.ok(thrown, 'the send must fail');
    assert.equal(isTransient(thrown), true);
  });
});
