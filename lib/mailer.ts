import 'server-only';
/**
 * Sending one email_outbox row over SMTP.
 *
 * The bodies are rendered here from the registration and its tour (lib/mail.ts), so a
 * row that was queued inside the booking transaction but never rendered — because the
 * request died between the commit and the send — can still be picked up later by
 * /api/outbox/retry.
 */
import type { Transporter } from 'nodemailer';
import { supabaseAdmin } from './supabase/admin';
import { buildMailDoc } from './mail';
import { hhmm } from './supabase/types';
import { MAX_ATTEMPTS, createTransport, isTransient, readSmtp } from './smtp';

export { MAX_ATTEMPTS, createTransport, isSecurePort, isTransient, readSmtp } from './smtp';
export type { SmtpSettings } from './smtp';

/** Builds the subject and both bodies for a queued row, from live data. */
export async function renderOutbox(regCode: string) {
  const db = supabaseAdmin();
  const { data: reg } = await db
    .from('registrations').select('*').eq('code', regCode).maybeSingle();
  if (!reg) return undefined;

  const { data: tour } = await db
    .from('tours').select('*').eq('id', reg.tour_id).maybeSingle();

  return buildMailDoc({
    to: reg.email,
    code: reg.code,
    name: reg.name,
    tourName: reg.tour_name,
    batch: reg.batch ?? tour?.batch ?? null,
    tourDate: reg.tour_date ?? '',
    departureTime: hhmm(reg.departure_time) || hhmm(tour?.departure_time),
    pickupPoint: tour?.pickup_point ?? '',
    experienceDuration: tour?.experience_duration ?? null,
    notices: tour?.notices ?? null,
  });
}

export type SendOutcome =
  | { status: 'sent'; messageId?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; retry: boolean };

/**
 * Sends one outbox row and records the outcome on it. Idempotent: a row already `sent`
 * is left alone, so a retry sweep can never deliver a second copy.
 */
export async function sendOutboxRow(
  outboxId: string,
  transport?: Transporter
): Promise<SendOutcome> {
  const db = supabaseAdmin();
  const { data: row } = await db
    .from('email_outbox').select('*').eq('id', outboxId).maybeSingle();
  if (!row) return { status: 'skipped', reason: 'outbox row no longer exists' };
  if (row.status === 'sent') return { status: 'skipped', reason: 'already sent' };
  if (row.attempts >= MAX_ATTEMPTS) {
    return { status: 'skipped', reason: `already tried ${MAX_ATTEMPTS} times` };
  }

  // Render first, always. The row is then a complete record of what was meant to go
  // out — inspectable in the admin UI and re-sendable later — even if this deployment
  // has no SMTP configured yet.
  let { subject, text, html } = row;
  if (!subject || !text || !html) {
    const built = row.reg_code ? await renderOutbox(row.reg_code) : undefined;
    if (!built) {
      await db.from('email_outbox').update({
        status: 'error', error: 'The registration for this email no longer exists.',
      }).eq('id', outboxId);
      return { status: 'failed', error: 'registration missing', retry: false };
    }
    subject = built.message.subject;
    text = built.message.text;
    html = built.message.html;
    await db.from('email_outbox').update({ subject, text, html }).eq('id', outboxId);
  }

  const settings = readSmtp();
  if (!settings && !transport) {
    await db.from('email_outbox').update({
      status: 'error',
      error: 'SMTP is not configured for this deployment.',
    }).eq('id', outboxId);
    return { status: 'failed', error: 'SMTP is not configured', retry: false };
  }

  const own = !transport;
  const mailer = transport ?? createTransport(settings!);
  const attempts = row.attempts + 1;

  try {
    const info = await mailer.sendMail({
      from: settings?.from ?? process.env.MAIL_FROM ?? 'no-reply@localhost',
      to: row.to_email,
      subject,
      text,
      html,
    });
    await db.from('email_outbox').update({
      status: 'sent', attempts, error: null,
      message_id: info?.messageId ?? null, sent_at: new Date().toISOString(),
    }).eq('id', outboxId);
    return { status: 'sent', messageId: info?.messageId };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    const retry = isTransient(err) && attempts < MAX_ATTEMPTS;
    await db.from('email_outbox').update({
      status: 'error', attempts, error: message,
    }).eq('id', outboxId);
    return { status: 'failed', error: message, retry };
  } finally {
    if (own) mailer.close();
  }
}
