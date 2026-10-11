/**
 * Pure SMTP helpers — no Supabase, no `server-only`, so the tests can import them
 * directly. lib/mailer.ts re-exports these alongside the parts that touch the database.
 */
import nodemailer, { type Transporter } from 'nodemailer';

export const MAX_ATTEMPTS = 3;

export interface SmtpSettings {
  host: string; port: number; secure: boolean; user: string; pass: string; from: string;
}

/** Port 465 is implicit TLS; 587 and 25 start plain and upgrade with STARTTLS. */
export const isSecurePort = (port: number) => port === 465;

export function readSmtp(): SmtpSettings | undefined {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return undefined;
  const port = Number(SMTP_PORT || 465);
  return {
    host: SMTP_HOST, port, secure: isSecurePort(port),
    user: SMTP_USER, pass: SMTP_PASS, from: MAIL_FROM || SMTP_USER,
  };
}

export function createTransport(s: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** A transient fault is worth another attempt; a rejected address is not. */
export function isTransient(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number };
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'EDNS', 'EAI_AGAIN', 'ECONNECTION']
    .includes(String(e?.code ?? ''))) return true;
  const rc = Number(e?.responseCode ?? 0);
  return rc >= 400 && rc < 500;
}
