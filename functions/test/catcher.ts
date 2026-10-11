/**
 * A real SMTP server on localhost that collects whatever is delivered to it, so the
 * send path can be tested end to end without any external service or credential.
 */
import { SMTPServer } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import type { AddressInfo } from 'node:net';

export interface Caught {
  from: string;
  to: string[];
  parsed: ParsedMail;
}

export class MailCatcher {
  readonly caught: Caught[] = [];
  private server?: SMTPServer;
  port = 0;

  /** `failWith` makes every delivery fail, for the error and retry paths. */
  constructor(private readonly failWith?: { code: number; message: string }) {}

  async start(): Promise<number> {
    const fail = this.failWith;
    this.server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData: (stream, session, callback) => {
        if (fail) {
          stream.resume();
          stream.on('end', () => {
            const err = new Error(fail.message) as Error & { responseCode: number };
            err.responseCode = fail.code;
            callback(err);
          });
          return;
        }
        simpleParser(stream)
          .then((parsed) => {
            this.caught.push({
              from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
              to: session.envelope.rcptTo.map((r) => r.address),
              parsed,
            });
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

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}

/** An in-memory stand-in for a Firestore DocumentReference. */
export class FakeDoc {
  constructor(public data: Record<string, unknown> | undefined, public id = 'mail1') {}

  readonly writes: Record<string, unknown>[] = [];

  async get() {
    return { exists: this.data !== undefined, data: () => this.data as never };
  }

  async set(patch: Record<string, unknown>, _options: { merge: true }) {
    this.writes.push(JSON.parse(JSON.stringify(patch)));
    // Shallow merge is enough: every write here sets the whole `delivery` object.
    this.data = { ...(this.data ?? {}), ...patch };
    return undefined;
  }

  get delivery() {
    return (this.data?.delivery ?? {}) as Record<string, unknown>;
  }
}
