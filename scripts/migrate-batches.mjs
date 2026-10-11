// Splits SABIC and Saudi Aramco into two departure batches each.
//
//   npm run migrate:batches -- --dry    show the plan, write nothing
//   npm run migrate:batches             apply it
//
// Batch 1 keeps the existing document, so registrations already attached to it stay
// attached. Batch 2 is a new document that copies everything descriptive from batch 1 —
// including the SABIC nationality restriction, which must apply to both batches.
//
// Idempotent: re-running changes nothing once the schedule matches.
//
// SAFETY: if a tour already has more registrations than its new capacity, nothing is
// written for that tour and the script stops with the numbers, because silently
// lowering capacity below the people already booked would overbook the bus.
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: '.env.local' });
dotenv.config();

const DRY = process.argv.includes('--dry');

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error('Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.local first.');
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore();

/** The agreed schedule. Batch 1 is always the document that already exists. */
export const BATCH_PLAN = [
  {
    destinationId: 'sabic',
    batches: [
      { id: 'sabic-home-of-innovation', batch: 1, departureTime: '08:00', capacity: 20 },
      { id: 'sabic-home-of-innovation-b2', batch: 2, departureTime: '09:00', capacity: 20 },
    ],
  },
  {
    destinationId: 'aramco-kafd',
    batches: [
      { id: 'aramco-kafd', batch: 1, departureTime: '09:00', capacity: 10 },
      { id: 'aramco-kafd-b2', batch: 2, departureTime: '10:00', capacity: 10 },
    ],
  },
];

/** Descriptive fields batch 2 inherits from batch 1. */
const INHERITED = [
  'name', 'slot', 'pickupPoint', 'date', 'active',
  'notices', 'experienceDuration', 'restrictedNationalities',
];

if (DRY) console.log('DRY RUN — nothing will be written.\n');

const plan = [];
const blocked = [];

for (const dest of BATCH_PLAN) {
  const [first, second] = dest.batches;

  const baseSnap = await db.collection('tours').doc(first.id).get();
  if (!baseSnap.exists) {
    console.error(`Batch 1 document "${first.id}" does not exist — run \`npm run seed\` first.`);
    process.exit(1);
  }
  const base = baseSnap.data();

  // --- batch 1: adjust the existing document in place -----------------------
  const taken = base.registeredCount ?? 0;
  if (taken > first.capacity) {
    blocked.push({ id: first.id, name: base.name, registered: taken, newCapacity: first.capacity });
  } else {
    const patch = {};
    if (base.destinationId !== dest.destinationId) patch.destinationId = dest.destinationId;
    if (base.batch !== first.batch) patch.batch = first.batch;
    if (base.departureTime !== first.departureTime) patch.departureTime = first.departureTime;
    if (base.capacity !== first.capacity) patch.capacity = first.capacity;
    if (Object.keys(patch).length) plan.push({ kind: 'update', ref: baseSnap.ref, id: first.id, name: base.name, patch });
  }

  // --- batch 2: create it if it isn't there, keep it in step if it is -------
  const secondSnap = await db.collection('tours').doc(second.id).get();
  const inherited = Object.fromEntries(
    INHERITED.filter((k) => base[k] !== undefined).map((k) => [k, base[k]])
  );

  if (!secondSnap.exists) {
    plan.push({
      kind: 'create',
      ref: db.collection('tours').doc(second.id),
      id: second.id,
      name: base.name,
      patch: {
        ...inherited,
        destinationId: dest.destinationId,
        batch: second.batch,
        departureTime: second.departureTime,
        capacity: second.capacity,
        registeredCount: 0,
        // Sorted right after its batch 1 so the lists stay in departure order.
        order: (base.order ?? 0) + 0.5,
      },
    });
  } else {
    const have = secondSnap.data();
    const takenB2 = have.registeredCount ?? 0;
    if (takenB2 > second.capacity) {
      blocked.push({ id: second.id, name: have.name, registered: takenB2, newCapacity: second.capacity });
    } else {
      const patch = {};
      if (have.destinationId !== dest.destinationId) patch.destinationId = dest.destinationId;
      if (have.batch !== second.batch) patch.batch = second.batch;
      if (have.departureTime !== second.departureTime) patch.departureTime = second.departureTime;
      if (have.capacity !== second.capacity) patch.capacity = second.capacity;
      // The restriction must never drift between batches of the same destination.
      const a = JSON.stringify(have.restrictedNationalities ?? []);
      const b = JSON.stringify(base.restrictedNationalities ?? []);
      if (a !== b) patch.restrictedNationalities = base.restrictedNationalities ?? [];
      if (Object.keys(patch).length) {
        plan.push({ kind: 'update', ref: secondSnap.ref, id: second.id, name: have.name, patch });
      }
    }
  }
}

// --- every other tour gets the fields too, so queries never hit `undefined` ---
const allTours = await db.collection('tours').get();
const batched = new Set(BATCH_PLAN.flatMap((d) => d.batches.map((b) => b.id)));
for (const doc of allTours.docs) {
  if (batched.has(doc.id)) continue;
  const d = doc.data();
  const patch = {};
  if (d.batch === undefined) patch.batch = null;
  if (d.destinationId === undefined) patch.destinationId = doc.id;
  if (Object.keys(patch).length) {
    plan.push({ kind: 'update', ref: doc.ref, id: doc.id, name: d.name, patch });
  }
}

// --- the denormalised departureTime on batch-1 registrations ------------------
const timeChanges = [];
for (const dest of BATCH_PLAN) {
  const first = dest.batches[0];
  const regs = await db.collection('registrations').where('tourId', '==', first.id).get();
  for (const doc of regs.docs) {
    const d = doc.data();
    const patch = {};
    if (d.departureTime !== first.departureTime) patch.departureTime = first.departureTime;
    if (d.batch !== first.batch) patch.batch = first.batch;
    if (Object.keys(patch).length) timeChanges.push({ ref: doc.ref, id: doc.id, patch });
  }
}

// ---------------------------------------------------------------- report
if (blocked.length) {
  console.error('\nSTOPPED — these tours already have more registrations than the new capacity:\n');
  for (const b of blocked) {
    console.error(`  ${b.id} (${b.name}): ${b.registered} registered, new capacity would be ${b.newCapacity}`);
  }
  console.error('\nNothing was written. Decide how to move those visitors, then re-run.');
  process.exit(1);
}

for (const p of plan) {
  console.log(`${p.kind === 'create' ? 'create' : 'update'} ${p.id} (${p.name}) → ${JSON.stringify(p.patch)}`);
}
console.log(`${timeChanges.length} registration(s) need their departureTime/batch refreshed.`);

if (DRY) {
  console.log(`\nDry run. ${plan.length} tour change(s), ${timeChanges.length} registration change(s).`);
  process.exit(0);
}

for (const p of plan) {
  if (p.kind === 'create') await p.ref.set(p.patch);
  else await p.ref.update(p.patch);
}
for (const c of timeChanges) await c.ref.update(c.patch);

console.log(
  `\nDone. ${plan.length} tour change(s) applied, ${timeChanges.length} registration(s) updated.`
);
