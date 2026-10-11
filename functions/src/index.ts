/**
 * Booking confirmations.
 *
 * /api/register writes a `mail/{id}` document inside the same transaction as the
 * registration. This function picks that up and actually sends it over SMTP, writing
 * the outcome back onto the document so the Registrations page can show Sent / Pending
 * / Error.
 *
 * Replaces the Trigger Email from Firestore extension; the document shape is identical.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import {
  FIRESTORE_DATABASE, FUNCTION_REGION, MAIL_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT,
  SMTP_USER, createTransport, readSmtpSettings,
} from './config';
import { deliverMail, type DocLike } from './send';

initializeApp();

export const sendBookingConfirmation = onDocumentCreated(
  {
    document: 'mail/{mailId}',
    database: FIRESTORE_DATABASE,
    region: FUNCTION_REGION,
    secrets: [SMTP_PASS],
    // Ask Eventarc to redeliver on a thrown error. The attempt counter on the document
    // is what bounds it, so a permanently broken address can't loop for ever.
    retry: true,
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 10,      // a burst of registrations must not open 1000 SMTP sessions
  },
  async (event) => {
    const mailId = event.params.mailId;
    const settings = readSmtpSettings();

    if (!settings.host || !settings.user) {
      logger.error('SMTP is not configured; set SMTP_HOST/SMTP_USER and the SMTP_PASS secret.', { mailId });
      await getFirestore().collection('mail').doc(mailId).set({
        delivery: {
          state: 'ERROR', attempts: 0, endTime: new Date(),
          error: 'SMTP is not configured for this deployment.', info: null,
        },
      }, { merge: true });
      return;
    }

    const transport = createTransport(settings);
    const ref = getFirestore().collection('mail').doc(mailId) as unknown as DocLike;

    try {
      const outcome = await deliverMail(ref, { transport, from: settings.from });
      if (outcome.status === 'sent') {
        logger.info('confirmation sent', { mailId, messageId: outcome.messageId });
      } else if (outcome.status === 'skipped') {
        logger.info('confirmation skipped', { mailId, reason: outcome.reason });
      } else {
        logger.warn('confirmation failed', { mailId, error: outcome.error, willRetry: outcome.retry });
        // Throwing asks Cloud Functions to redeliver the event; the attempt counter on
        // the document is what stops it going round for ever.
        if (outcome.retry) throw new Error(outcome.error);
      }
    } finally {
      transport.close();
    }
  }
);

// Referenced so the deployment records every parameter this function depends on.
void [SMTP_HOST, SMTP_PORT, SMTP_USER, MAIL_FROM];
