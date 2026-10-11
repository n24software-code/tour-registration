// One-off migrations, safe to re-run — each step only writes what actually differs.
//
//   npm run migrate            apply
//   npm run migrate -- --dry   show what would change, write nothing
//
//   1. restrictedNationalities on every tour (SABIC blocks IQ/YE/LB/SY, the rest []).
//   2. Boulevard City's experienceDuration + notices.
//   3. registrations: passportNumber → { idType, idNumber }.
//      idType comes from the nationality (SA → national_id, otherwise passport).
//      The old field is kept until the new one is verified, then removed in the same
//      write, so no value is ever lost in between.
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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

const RESTRICTIONS = { 'sabic-home-of-innovation': ['IQ', 'YE', 'LB', 'SY'] };

export const BOULEVARD_NAME = 'Boulevard City';
export const BOULEVARD_INFO = {
  experienceDuration: '15–20 minutes from entering the experience venue',
  notices: [
    'Photography is strictly prohibited inside the experience.',
    'Pregnant women are not allowed to participate.',
    'Visitors with heart conditions or high blood pressure are not allowed to participate.',
    'Visitors who have recently undergone surgery are not allowed to participate.',
  ],
};

const sameList = (a = [], b = []) => a.length === b.length && a.every((v, i) => v === b[i]);
const write = async (ref, patch) => { if (!DRY) await ref.update(patch); };

if (DRY) console.log('DRY RUN — nothing will be written.\n');

// ---------------------------------------------------------------- 1 + 2: tours
const tours = await db.collection('tours').get();
if (tours.empty) {
  console.log('No tours found — run `npm run seed` first.');
  process.exit(0);
}

let tourChanges = 0;
for (const doc of tours.docs) {
  const data = doc.data();
  const patch = {};

  const wantRestricted = RESTRICTIONS[doc.id] ?? [];
  if (!Array.isArray(data.restrictedNationalities) || !sameList(data.restrictedNationalities, wantRestricted)) {
    patch.restrictedNationalities = wantRestricted;
  }

  // Boulevard City is matched by name: it was created through the admin UI, so its
  // document id is auto-generated rather than a slug.
  if (String(data.name ?? '').trim().toLowerCase() === BOULEVARD_NAME.toLowerCase()) {
    if (data.experienceDuration !== BOULEVARD_INFO.experienceDuration) {
      patch.experienceDuration = BOULEVARD_INFO.experienceDuration;
    }
    if (!sameList(data.notices, BOULEVARD_INFO.notices)) patch.notices = BOULEVARD_INFO.notices;
  }

  if (!Object.keys(patch).length) {
    console.log(`skip   tour ${doc.id} (${data.name})`);
    continue;
  }
  await write(doc.ref, patch);
  console.log(`update tour ${doc.id} (${data.name}) → ${Object.keys(patch).join(', ')}`);
  tourChanges++;
}

// ---------------------------------------------------------------- 3: registrations
const regs = await db.collection('registrations').get();
let regChanges = 0;
let alreadyDone = 0;
let noId = 0;

for (const doc of regs.docs) {
  const data = doc.data();
  const hasNew = typeof data.idNumber === 'string' && data.idNumber !== '';
  const legacy = typeof data.passportNumber === 'string' ? data.passportNumber.trim() : '';

  if (hasNew && data.passportNumber === undefined) { alreadyDone++; continue; }

  const patch = {};
  // Derive the type from the nationality; default to passport when it is unknown,
  // because that is what the old single field always held.
  if (!data.idType) patch.idType = data.nationality === 'SA' ? 'national_id' : 'passport';
  if (!hasNew && legacy) patch.idNumber = legacy;

  // Only drop the old field once the new one is definitely populated.
  const willHaveId = hasNew || !!patch.idNumber;
  if (data.passportNumber !== undefined && willHaveId) patch.passportNumber = FieldValue.delete();

  if (!legacy && !hasNew) {
    // Pre-existing rows from before the ID field existed: tag the type, leave the
    // number empty, and let the admin pages render it as "—".
    noId++;
  }

  if (!Object.keys(patch).length) { alreadyDone++; continue; }
  await write(doc.ref, patch);
  const shown = Object.keys(patch).map((k) => (k === 'passportNumber' ? '-passportNumber' : k));
  console.log(`update reg  ${doc.id} → ${shown.join(', ')}`);
  regChanges++;
}

console.log(
  `\nDone${DRY ? ' (dry run)' : ''}. ` +
  `Tours: ${tourChanges} updated, ${tours.size - tourChanges} already correct. ` +
  `Registrations: ${regChanges} updated, ${alreadyDone} already correct` +
  `${noId ? `, ${noId} have no ID number on record` : ''}.`
);
