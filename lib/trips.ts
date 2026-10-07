/**
 * A "trip" is one departure: destination + date + departure time.
 * The Registrations, Overview and Crowd pages all group by the same key, so the
 * Crowd team picks the exact bus run rather than a whole tour.
 */
import type { Registration, Slot, Tour } from './types';

export interface Trip {
  /** `${tourId}|${date}|${departureTime}` — stable, and safe as a <select> value. */
  key: string;
  tourId: string;
  tourName: string;
  slot: Slot;
  /** "YYYY-MM-DD", or "" for tours that have no fixed date. */
  date: string;
  departureTime: string;
  pickupPoint: string;
  capacity: number;
  /** The live tour doc, when it still exists. */
  tour?: Tour;
  order: number;
}

export const tripKey = (tourId: string, date: string, departureTime: string) =>
  `${tourId}|${date ?? ''}|${departureTime ?? ''}`;

/**
 * The trip a registration belongs to. Registrations made before these fields existed
 * have neither a date nor a time, so they fall back to the tour's current values.
 */
export function regTrip(r: Registration, tour?: Tour) {
  const date = r.tourDate ?? '';
  const departureTime = r.departureTime || tour?.departureTime || '';
  return { tourId: r.tourId, date, departureTime, key: tripKey(r.tourId, date, departureTime) };
}

export const toursById = (tours: Tour[]) => new Map(tours.map((t) => [t.id, t]));

/** Blank dates sort last; otherwise date, then time, then the tour's own order. */
function compare(a: Trip, b: Trip) {
  if (!a.date !== !b.date) return a.date ? -1 : 1;
  return a.date.localeCompare(b.date)
    || a.departureTime.localeCompare(b.departureTime)
    || a.order - b.order
    || a.tourName.localeCompare(b.tourName);
}

/**
 * Every trip worth showing: one per tour as it is configured today, plus any extra
 * date/time combinations that registrations were actually taken for.
 */
export function buildTrips(tours: Tour[], regs: Registration[]): Trip[] {
  const byId = toursById(tours);
  const trips = new Map<string, Trip>();

  const add = (t: Trip) => { if (!trips.has(t.key)) trips.set(t.key, t); };

  for (const t of tours) {
    add({
      key: tripKey(t.id, t.date ?? '', t.departureTime), tourId: t.id, tourName: t.name, slot: t.slot,
      date: t.date ?? '', departureTime: t.departureTime, pickupPoint: t.pickupPoint,
      capacity: t.capacity, tour: t, order: t.order,
    });
  }

  for (const r of regs) {
    const { key, date, departureTime } = regTrip(r, byId.get(r.tourId));
    const tour = byId.get(r.tourId);
    add({
      key, tourId: r.tourId, tourName: tour?.name ?? r.tourName, slot: tour?.slot ?? r.slot,
      date, departureTime, pickupPoint: tour?.pickupPoint ?? '—',
      capacity: tour?.capacity ?? 0, tour, order: tour?.order ?? 9999,
    });
  }

  return [...trips.values()].sort(compare);
}

/** Groups registrations by trip key. Rows keep the order they came in. */
export function groupByTrip(regs: Registration[], tours: Tour[]) {
  const byId = toursById(tours);
  const groups = new Map<string, Registration[]>();
  for (const r of regs) {
    const { key } = regTrip(r, byId.get(r.tourId));
    const list = groups.get(key);
    if (list) list.push(r); else groups.set(key, [r]);
  }
  return groups;
}

// ---------------------------------------------------------------- counts

export interface TripCounts {
  /** Every row in the trip, cancelled ones included. */
  total: number;
  /** Everything except cancelled — this is what "registered" means everywhere. */
  registered: number;
  pending: number;
  confirmed: number;
  checkedIn: number;
  boarded: number;
  noShow: number;
  cancelled: number;
  flagged: number;
  capacity: number;
  seatsLeft: number;
}

/** One place that decides what the numbers mean, so every page agrees. */
export function tripCounts(rows: Registration[], capacity: number): TripCounts {
  const n = (s: Registration['status']) => rows.filter((r) => r.status === s).length;
  const cancelled = n('cancelled');
  const registered = rows.length - cancelled;
  return {
    total: rows.length,
    registered,
    pending: n('pending'),
    confirmed: n('confirmed'),
    checkedIn: n('checked_in'),
    boarded: n('boarded'),
    noShow: n('no_show'),
    cancelled,
    // A cancelled row's old flag is no longer anyone's problem.
    flagged: rows.filter((r) => r.flag && r.status !== 'cancelled').length,
    capacity,
    seatsLeft: Math.max(0, capacity - registered),
  };
}

/**
 * `tours/{id}.registeredCount` is the seat counter the booking transaction maintains;
 * counting non-cancelled registrations has to give the same number. If a write was ever
 * lost, they drift — which silently overbooks or underbooks the bus — so PO/PM get told.
 *
 * The counter is per tour, not per trip, so the comparison sums every trip of that tour.
 * Returns only the tours that disagree.
 */
export function countMismatches(tours: Tour[], regs: Registration[]) {
  const counted = new Map<string, number>();
  for (const r of regs) {
    if (r.status === 'cancelled') continue;
    counted.set(r.tourId, (counted.get(r.tourId) ?? 0) + 1);
  }
  const out = new Map<string, { counted: number; stored: number }>();
  for (const t of tours) {
    const mine = counted.get(t.id) ?? 0;
    if (mine !== (t.registeredCount ?? 0)) out.set(t.id, { counted: mine, stored: t.registeredCount ?? 0 });
  }
  return out;
}
