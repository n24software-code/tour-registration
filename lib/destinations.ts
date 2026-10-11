/**
 * Grouping tours into destinations for the public form.
 *
 * SABIC and Saudi Aramco each run two departures, held as one tour document per batch
 * so capacity, counts and lists work per batch. The visitor should still see the
 * destination once, with its departures underneath — that is what this builds.
 */
import type { Tour } from './types';
import { seatsLeft } from './seats';

export interface Destination {
  /** `destinationId` when the tour has one, otherwise the tour's own id. */
  id: string;
  name: string;
  slot: Tour['slot'];
  pickupPoint: string;
  /** Batches in departure order. A destination that doesn't batch has exactly one. */
  batches: Tour[];
  /** True once every batch is closed or full. */
  full: boolean;
  /** Whether a departure has to be chosen, i.e. there is more than one. */
  hasBatches: boolean;
  /** Lowest order of its batches, so destinations keep the configured sequence. */
  order: number;
  /** The restriction is a property of the destination: every batch shares it. */
  restrictedNationalities: string[];
}

export const isBookable = (t: Tour) => t.active && seatsLeft(t) > 0;

/** Groups tours by destination, batches sorted by departure time. */
export function buildDestinations(tours: Tour[]): Destination[] {
  const groups = new Map<string, Tour[]>();
  for (const t of tours) {
    const key = t.destinationId || t.id;
    const list = groups.get(key);
    if (list) list.push(t); else groups.set(key, [t]);
  }

  const out: Destination[] = [];
  for (const [id, list] of groups) {
    // Defensive: once a destination runs in batches, an un-batched row for it is stale
    // data (a half-finished migration, a leftover seed). Showing it would offer a
    // departure that no longer exists, so it is dropped rather than rendered.
    const batched = list.filter((t) => t.batch !== null && t.batch !== undefined);
    const kept = batched.length ? batched : list;

    const batches = [...kept].sort(
      (a, b) => (a.batch ?? 0) - (b.batch ?? 0) || a.departureTime.localeCompare(b.departureTime)
    );
    const head = batches[0];
    out.push({
      id,
      name: head.name,
      slot: head.slot,
      pickupPoint: head.pickupPoint,
      batches,
      hasBatches: batches.length > 1 || batches.some((b) => !!b.batch),
      full: batches.every((b) => !isBookable(b)),
      order: Math.min(...batches.map((b) => b.order)),
      // Any batch carrying the restriction applies it to the whole destination; they
      // are kept in step by the migration, so this is belt and braces.
      restrictedNationalities: [
        ...new Set(batches.flatMap((b) => b.restrictedNationalities ?? [])),
      ],
    });
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** "Batch 1 · 08:00 · 7 seats left" */
export function batchOptionLabel(t: Tour) {
  const left = seatsLeft(t);
  const where = t.batch ? `Batch ${t.batch} · ` : '';
  if (!t.active) return `${where}${t.departureTime} · Registration closed`;
  if (left === 0) return `${where}${t.departureTime} · Full`;
  return `${where}${t.departureTime} · ${left} ${left === 1 ? 'seat' : 'seats'} left`;
}
