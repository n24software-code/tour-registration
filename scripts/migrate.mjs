// One-off: backfills `restrictedNationalities` on every tour.
//
//   npm run migrate
//
// SABIC gets ["IQ","YE","LB","SY"] (Iraqi, Yemeni, Lebanese, Syrian); every other tour
// gets []. Safe to re-run — it only writes tours whose value differs.
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: '.env.local' });
dotenv.config();

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

const RESTRICTIONS = {
  'sabic-home-of-innovation': ['IQ', 'YE', 'LB', 'SY'],
};

const same = (a = [], b = []) => a.length === b.length && a.every((v, i) => v === b[i]);

const tours = await db.collection('tours').get();
if (tours.empty) {
  console.log('No tours found — run `npm run seed` first.');
  process.exit(0);
}

let changed = 0;
for (const doc of tours.docs) {
  const want = RESTRICTIONS[doc.id] ?? [];
  const have = doc.data().restrictedNationalities;
  if (Array.isArray(have) && same(have, want)) {
    console.log(`skip   ${doc.id} (already ${want.length ? want.join(', ') : 'unrestricted'})`);
    continue;
  }
  await doc.ref.update({ restrictedNationalities: want });
  console.log(`set    ${doc.id} → ${want.length ? want.join(', ') : '[] (open to everyone)'}`);
  changed++;
}
console.log(`\nDone. ${changed} tour${changed === 1 ? '' : 's'} updated, ${tours.size - changed} already correct.`);
