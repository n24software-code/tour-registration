/**
 * SMTP configuration. Everything comes from Firebase params — the password from a
 * secret, the rest from parameter values — so no credential ever reaches source control.
 *
 * Non-secret values live in functions/.env.<project-id>; the password is set with
 *   npx firebase-tools functions:secrets:set SMTP_PASS
 */
import { defineSecret, defineString } from 'firebase-functions/params';
import * as nodemailer from 'nodemailer';

export const SMTP_PASS = defineSecret('SMTP_PASS');

export const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.gmail.com' });
export const SMTP_PORT = defineString('SMTP_PORT', { default: '465' });
export const SMTP_USER = defineString('SMTP_USER', { default: '' });
export const MAIL_FROM = defineString('MAIL_FROM', { default: '' });

/**
 * The function has to run where Eventarc can deliver Firestore events for this
 * database. Firestore lives in me-central2, so that is the default; if a deploy is
 * refused because the region can't host the trigger, set FUNCTION_REGION to the nearest
 * supported one (see the README) rather than editing this file.
 */
export const FUNCTION_REGION = defineString('FUNCTION_REGION', { default: 'me-central2' });

/** The Firestore database the trigger listens to. "(default)" unless one is named. */
export const FIRESTORE_DATABASE = defineString('FIRESTORE_DATABASE', { default: '(default)' });

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** Port 465 is implicit TLS; 587 and 25 start plain and upgrade with STARTTLS. */
export const isSecurePort = (port: number) => port === 465;

export function readSmtpSettings(): SmtpSettings {
  const port = Number(SMTP_PORT.value() || 465);
  const user = SMTP_USER.value();
  return {
    host: SMTP_HOST.value(),
    port,
    secure: isSecurePort(port),
    user,
    pass: SMTP_PASS.value(),
    // Fall back to the authenticating user so a half-configured deployment still has
    // a plausible sender rather than an empty From header.
    from: MAIL_FROM.value() || user,
  };
}

export function createTransport(s: SmtpSettings): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    // A stuck connection must not hold the function open for its whole timeout.
    connectionTimeout: 20_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}
