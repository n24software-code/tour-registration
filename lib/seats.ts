/** Shared by the public form, the admin pages and lib/destinations.ts. */
export function seatsLeft(t: { capacity: number; registeredCount: number }) {
  return Math.max(0, t.capacity - t.registeredCount);
}
