/**
 * Delivering one `mail/{id}` document.
 *
 * The delivery sub-document keeps the exact shape the Trigger Email extension used, so
 * the Registrations page's Sent / Pending / Error badge keeps working unchanged:
 *
 *   delivery: { state, attempts, startTime, endTime, error, info: { messageId, ... } }
 *
 * This module deliberately knows nothing about firebase-functions. It takes a plain
 * document reference and a transporter, which is what lets the tests drive it against a
 * local SMTP catcher with no emulator and no network.
 */
import type { Transporter } from 'nodemailer';

export const MAX_ATTEMPTS = 3;

export type MailState = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR' | 'RETRY';

export interface MailMessage {
  subject?: string;
  text?: string;
  html?: string;
}

export interface MailDoc {
  to?: string | string[];
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  message?: MailMessage;
  delivery?: {
    state?: MailState;
    attempts?: number;
    error?: string | null;
    info?: { messageId?: string } | null;
  };
}

/** The slice of a Firestore DocumentReference this module needs. */
export interface DocLike {
  id: string;
  get(): Promise<{ exists: boolean; data(): MailDoc | undefined }>;
  set(data: Record<string, unknown>, options: { merge: true }): Promise<unknown>;
}

export interface DeliverDeps {
  transport: Transporter;
  from: string;
  /** Injected so tests can assert exact timestamps instead of racing the clock. */
  now?: () => Date;
}

export type DeliverOutcome =
  | { status: 'sent'; messageId?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; retry: boolean };

/** A transient fault is worth another attempt; a rejected address is not. */
export function isTransient(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const code = String(e?.code ?? '');
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'EDNS', 'EAI_AGAIN', 'ECONNECTION']
    .includes(code)) return true;
  // SMTP 4xx is "try later"; 5xx is a permanent refusal.
  const rc = Number(e?.responseCode ?? 0);
  if (rc >= 400 && rc < 500) return true;
  if (rc >= 500) return false;
  // No code at all (a thrown TypeError, say) is not worth retrying.
  return false;
}

function recipients(doc: MailDoc): string[] {
  const list = ([] as (string | undefined)[])
    .concat(doc.to ?? [], doc.cc ?? [], doc.bcc ?? [])
    .filter((v): v is string => !!v && v.trim() !== '');
  return list;
}

/**
 * Sends one document and records the outcome on it.
 *
 * Idempotent by design: a document already SUCCESS, or already being worked on by
 * another invocation (PROCESSING), is left alone. Cloud Functions guarantees at-least-
 * once delivery, so this is what stops a retry sending a second copy.
 */
export async function deliverMail(ref: DocLike, deps: DeliverDeps): Promise<DeliverOutcome> {
  const now = deps.now ?? (() => new Date());

  const snap = await ref.get();
  if (!snap.exists) return { status: 'skipped', reason: 'document no longer exists' };
  const doc = snap.data() ?? {};

  const state = doc.delivery?.state;
  if (state === 'SUCCESS') return { status: 'skipped', reason: 'already delivered' };
  if (state === 'PROCESSING') return { status: 'skipped', reason: 'another attempt is in flight' };

  const attempts = (doc.delivery?.attempts ?? 0) + 1;
  if (attempts > MAX_ATTEMPTS) {
    await ref.set({
      delivery: {
        state: 'ERROR',
        attempts: attempts - 1,
        endTime: now(),
        error: `Giving up after ${MAX_ATTEMPTS} attempts.`,
        info: null,
      },
    }, { merge: true });
    return { status: 'failed', error: 'max attempts reached', retry: false };
  }

  const to = recipients(doc);
  if (!to.length) {
    await ref.set({
      delivery: { state: 'ERROR', attempts, endTime: now(), error: 'No recipient address.', info: null },
    }, { merge: true });
    return { status: 'failed', error: 'no recipient', retry: false };
  }

  // Claim the document before doing anything slow, so a concurrent invocation bails out.
  await ref.set({
    delivery: { state: 'PROCESSING', attempts, startTime: now(), error: null, info: null },
  }, { merge: true });

  try {
    const info = await deps.transport.sendMail({
      from: doc.from || deps.from,
      to: doc.to,
      cc: doc.cc,
      bcc: doc.bcc,
      replyTo: doc.replyTo,
      subject: doc.message?.subject ?? '',
      text: doc.message?.text,
      html: doc.message?.html,
    });

    await ref.set({
      delivery: {
        state: 'SUCCESS',
        attempts,
        endTime: now(),
        error: null,
        info: {
          messageId: info?.messageId ?? null,
          accepted: info?.accepted ?? [],
          rejected: info?.rejected ?? [],
          response: info?.response ?? null,
        },
      },
    }, { merge: true });

    return { status: 'sent', messageId: info?.messageId };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    const transient = isTransient(err);
    const retry = transient && attempts < MAX_ATTEMPTS;

    await ref.set({
      delivery: {
        // RETRY tells the UI this is not final; the badge treats it as Pending.
        state: retry ? 'RETRY' : 'ERROR',
        attempts,
        endTime: now(),
        error: message,
        info: null,
      },
    }, { merge: true });

    return { status: 'failed', error: message, retry };
  }
}
