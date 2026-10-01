import { writeFileSync } from 'node:fs';
import { adminDb } from './helpers';

export const SNAPSHOT_PATH = 'e2e/.tours-snapshot.json';

/** Records every tour's capacity/registeredCount/active so teardown can restore them. */
export default async function globalSetup() {
  const snap = await adminDb().collection('tours').get();
  if (snap.empty) throw new Error('No tours found. Run `npm run seed` before the e2e suite.');

  const tours = snap.docs.map((d) => ({
    id: d.id,
    capacity: d.data().capacity,
    registeredCount: d.data().registeredCount,
    active: d.data().active,
    pickupPoint: d.data().pickupPoint,
    departureTime: d.data().departureTime,
    date: d.data().date ?? '',
    name: d.data().name,
  }));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(tours, null, 2));
  console.log(`[global-setup] snapshotted ${tours.length} tours`);
}
