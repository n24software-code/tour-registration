import { writeFileSync } from 'node:fs';
import { adminDb } from './helpers';

export const SNAPSHOT_PATH = 'e2e/.tours-snapshot.json';

/** Head-room for a whole run's bookings; the real capacity is restored by teardown. */
export const E2E_CAPACITY = 5000;

/** Records every tour's capacity/count/active so teardown can restore them. */
export default async function globalSetup() {
  const db = adminDb();
  const { data, error } = await db.from('tours').select('*');
  if (error) throw new Error(`global-setup: ${error.message}`);
  if (!data?.length) throw new Error('No tours found. Run `npm run seed` before the e2e suite.');

  const startedAt = new Date().toISOString();
  const tours = data.map((t) => ({ ...(t as Record<string, unknown>) }));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify({ startedAt, tours }, null, 2));

  // The suite books more than a 50-seat tour holds in one run, and teardown only clears
  // up at the end — so the unbatched tours get head-room. The batched ones are left at
  // their real 10 and 20, because the batch specs assert exactly those numbers; they
  // start from a clean count instead.
  const { error: capErr } = await db
    .from('tours').update({ capacity: E2E_CAPACITY }).is('batch', null);
  if (capErr) throw new Error(`global-setup raising capacity: ${capErr.message}`);

  const { error: countErr } = await db
    .from('tours').update({ registered_count: 0 }).not('batch', 'is', null);
  if (countErr) throw new Error(`global-setup resetting batch counts: ${countErr.message}`);

  console.log(
    `[global-setup] snapshotted ${tours.length} tours; ` +
    `unbatched capacity raised to ${E2E_CAPACITY}, batched left at their real size`
  );
}
