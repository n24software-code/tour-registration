import { writeFileSync } from 'node:fs';
import { adminDb } from './helpers';

export const SNAPSHOT_PATH = 'e2e/.tours-snapshot.json';

/** Head-room for a whole run's bookings; the real capacity is restored by teardown. */
export const E2E_CAPACITY = 5000;

/** Records every tour's capacity/registeredCount/active so teardown can restore them. */
export default async function globalSetup() {
  const snap = await adminDb().collection('tours').get();
  if (snap.empty) throw new Error('No tours found. Run `npm run seed` before the e2e suite.');

  // Export audit rows carry no regId, so teardown finds them by "written during this run".
  const startedAt = Date.now();
  const tours = snap.docs.map((d) => ({
    id: d.id,
    capacity: d.data().capacity,
    registeredCount: d.data().registeredCount,
    active: d.data().active,
    pickupPoint: d.data().pickupPoint,
    departureTime: d.data().departureTime,
    date: d.data().date ?? '',
    name: d.data().name,
    restrictedNationalities: d.data().restrictedNationalities ?? [],
    experienceDuration: d.data().experienceDuration ?? '',
    notices: d.data().notices ?? [],
  }));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify({ startedAt, tours }, null, 2));

  // The suite books well over a real tour's 50 seats in one run, and teardown only
  // clears up at the very end — so without this the later specs start failing with
  // "This tour is full". Capacity is restored from the snapshot in teardown, and every
  // assertion about seats reads the live value rather than assuming 50.
  const batch = adminDb().batch();
  for (const t of snap.docs) batch.update(t.ref, { capacity: E2E_CAPACITY });
  await batch.commit();

  console.log(`[global-setup] snapshotted ${tours.length} tours, capacity raised to ${E2E_CAPACITY}`);
}
