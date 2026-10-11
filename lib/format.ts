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

/**
 * How a tour is named wherever a batch matters: "SABIC - Home of Innovation – Batch 1 –
 * 08:00". A tour that doesn't run in batches keeps its plain name.
 */
export function tourTitle(t: { name: string; batch?: number | null; departureTime?: string }) {
  if (!t.batch) return t.name;
  return `${t.name} – Batch ${t.batch}${t.departureTime ? ` – ${t.departureTime}` : ''}`;
}

/** Just the batch part, for places that already show the tour name. */
export const batchLabel = (batch?: number | null) => (batch ? `Batch ${batch}` : '');
