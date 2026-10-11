/** Pure formatting helpers, safe to import from the server, the client and scripts. */

/** "2026-10-15" → "Thu, 15 Oct 2026". Returns "" for an empty date. */
export function formatDate(d?: string) {
  if (!d) return '';
  const date = new Date(`${d}T00:00:00`);
  return isNaN(date.getTime())
    ? d
    : date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Sat, 15 Nov 2026" when there is a date, "No fixed date" when there isn't. */
export const formatTourDate = (d?: string) => (d ? formatDate(d) : 'No fixed date');

/** Old registrations have missing fields — show a dash rather than nothing. */
export const orDash = (v?: string | null) => (v && String(v).trim()) || '—';
