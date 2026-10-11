/**
 * The booking confirmation email, as a document for the Trigger Email from Firestore
 * extension (collection `mail`). Both bodies are built here so the plain-text and HTML
 * versions can never drift apart.
 *
 * Every value that came from a visitor is escaped before it reaches the HTML.
 */
import { formatDate } from './format';

export interface MailTrip {
  tourName: string;
  tourDate: string;
  departureTime: string;
  pickupPoint: string;
  experienceDuration?: string | null;
  notices?: string[] | null;
}

export interface MailInput extends MailTrip {
  code: string;
  name: string;
  to: string;
}

/** Escapes for HTML text and double-quoted attributes alike. */
export const escapeHtml = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Absolute, because an email client has no page to resolve relative URLs against. */
export const siteUrl = () =>
  (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const LOGOS = [
  { file: 'logo1.png', alt: 'WPC Energy' },
  { file: 'logo2.png', alt: '25th WPC Energy Congress, 11–15 October 2026' },
  { file: 'logo3.png', alt: 'Ministry of Energy' },
];

export const mailSubject = (t: { tourName: string; code: string }) =>
  `Booking confirmed – ${t.tourName} – ${t.code}`;

export function mailText(m: MailInput) {
  const link = `${siteUrl()}/registered/${m.code}`;
  const lines = [
    `Hi ${m.name.split(' ')[0]},`,
    '',
    `Your booking for ${m.tourName} is confirmed.`,
    '',
    `Your code: ${m.code}`,
    `Date: ${formatDate(m.tourDate) || 'To be confirmed'}`,
    `Departure time: ${m.departureTime}`,
    `Pickup point: ${m.pickupPoint}`,
    '',
    'Arrive 15 minutes before departure and show this code to our team.',
  ];
  if (m.experienceDuration) lines.push('', `Experience duration: ${m.experienceDuration}`);
  if (m.notices?.length) {
    lines.push('', 'Before you go, please note:');
    for (const n of m.notices) lines.push(`  - ${n}`);
  }
  lines.push('', `See your booking online: ${link}`, '');
  return lines.join('\n');
}

export function mailHtml(m: MailInput) {
  const e = escapeHtml;
  const link = `${siteUrl()}/registered/${encodeURIComponent(m.code)}`;
  const row = (label: string, value: string) =>
    `<tr>
       <td style="padding:6px 16px 6px 0;color:#1A2238;opacity:.7;font-size:14px;">${e(label)}</td>
       <td style="padding:6px 0;color:#1A2238;font-size:14px;font-weight:600;">${e(value)}</td>
     </tr>`;

  const logos = LOGOS.map(
    (l) => `<img src="${e(`${siteUrl()}/logos/${l.file}`)}" alt="${e(l.alt)}" height="32"
             style="height:32px;width:auto;vertical-align:middle;margin:0 8px;" />`
  ).join('');

  const notices = m.notices?.length
    ? `<h2 style="margin:28px 0 8px;font-size:16px;color:#1A2238;">Before you go</h2>
       <ul style="margin:0;padding-left:20px;color:#1A2238;font-size:14px;line-height:1.6;">
         ${m.notices.map((n) => `<li>${e(n)}</li>`).join('')}
       </ul>`
    : '';

  const duration = m.experienceDuration
    ? `<p style="margin:16px 0 0;color:#1A2238;font-size:14px;">
         <strong>Experience duration:</strong> ${e(m.experienceDuration)}
       </p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(mailSubject(m))}</title></head>
<body style="margin:0;padding:0;background:#F5F6F2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6F2;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border:1px solid rgba(26,34,56,.1);border-radius:8px;">
        <tr><td align="center" style="padding:20px;border-bottom:1px solid rgba(26,34,56,.1);">${logos}</td></tr>
        <tr><td style="padding:28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
          <p style="margin:0 0 4px;color:#1A2238;font-size:15px;">Hi ${e(m.name.split(' ')[0])},</p>
          <h1 style="margin:0 0 20px;font-size:22px;color:#1A2238;">Your booking is confirmed</h1>

          <div style="border:2px dashed rgba(26,34,56,.3);border-radius:8px;padding:20px;text-align:center;">
            <p style="margin:0 0 6px;color:#1A2238;opacity:.7;font-size:13px;">
              Your code — show it at the pickup area
            </p>
            <p style="margin:0;font-size:38px;letter-spacing:.2em;font-weight:700;color:#1A2238;font-family:monospace;">
              ${e(m.code)}
            </p>
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;">
            ${row('Tour', m.tourName)}
            ${row('Date', formatDate(m.tourDate) || 'To be confirmed')}
            ${row('Departure time', m.departureTime)}
            ${row('Pickup point', m.pickupPoint)}
          </table>

          <p style="margin:20px 0 0;padding:12px 16px;background:rgba(232,163,61,.2);border-radius:6px;
                    color:#1A2238;font-size:14px;font-weight:600;">
            Arrive 15 minutes before departure.
          </p>
          ${duration}
          ${notices}

          <p style="margin:28px 0 0;">
            <a href="${e(link)}" style="color:#2E4A7D;font-size:14px;">See your booking online</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * The full `mail/{id}` document. `from` is left to the extension's default unless
 * MAIL_FROM is set, so a deployment can override the sender without a code change.
 */
export function buildMailDoc(m: MailInput) {
  const from = process.env.MAIL_FROM;
  return {
    to: m.to,
    ...(from ? { from } : {}),
    message: {
      subject: mailSubject(m),
      text: mailText(m),
      html: mailHtml(m),
    },
  };
}
