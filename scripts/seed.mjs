// Usage: npm run seed -- owner@example.com "Owner Name" "TempPassword123"
// Creates the 5 tours (skips any that exist) and the first Product Owner account.
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: '.env.local' });
dotenv.config(); // fall back to .env

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY
  || FIREBASE_CLIENT_EMAIL === 'REPLACE_ME' || FIREBASE_PRIVATE_KEY === 'REPLACE_ME') {
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
const auth = getAuth();

// SABIC cannot host these nationalities, so the tour document carries the rule and
// /api/register enforces it. Every other tour is open to everyone.
const SABIC_RESTRICTED = ['IQ', 'YE', 'LB', 'SY'];

// Boulevard City's experience carries conditions a visitor has to read and accept.
// Keep this in step with scripts/migrate.mjs, which backfills an existing database.
const BOULEVARD_INFO = {
  experienceDuration: '15–20 minutes from entering the experience venue',
  notices: [
    'Photography is strictly prohibited inside the experience.',
    'Pregnant women are not allowed to participate.',
    'Visitors with heart conditions or high blood pressure are not allowed to participate.',
    'Visitors who have recently undergone surgery are not allowed to participate.',
  ],
};

// SABIC and Saudi Aramco each run two departures, modelled as one tour document per
// batch so capacity, counts, Crowd lists and exports all work per batch. Keep this in
// step with scripts/migrate-batches.mjs, which splits an existing database.
const TOURS = [
  { id: 'kapsarc-black-gold', name: 'KAPSARC & Black Gold Museum', slot: 'morning', departureTime: '08:00' },

  { id: 'sabic-home-of-innovation', name: 'SABIC - Home of Innovation', slot: 'morning',
    destinationId: 'sabic', batch: 1, departureTime: '08:00', capacity: 20,
    restrictedNationalities: SABIC_RESTRICTED },
  { id: 'sabic-home-of-innovation-b2', name: 'SABIC - Home of Innovation', slot: 'morning',
    destinationId: 'sabic', batch: 2, departureTime: '09:00', capacity: 20,
    restrictedNationalities: SABIC_RESTRICTED },

  { id: 'aramco-kafd', name: 'Saudi Aramco - KAFD', slot: 'morning',
    destinationId: 'aramco-kafd', batch: 1, departureTime: '09:00', capacity: 10 },
  { id: 'aramco-kafd-b2', name: 'Saudi Aramco - KAFD', slot: 'morning',
    destinationId: 'aramco-kafd', batch: 2, departureTime: '10:00', capacity: 10 },

  { id: 'diriyah-heritage-trail', name: 'Heritage Trail - Diriyah', slot: 'evening', departureTime: '16:30' },
  { id: 'downtown-national-history', name: 'Downtown & National History', slot: 'evening', departureTime: '17:00' },
  { id: 'boulevard-city', name: 'Boulevard City', slot: 'evening', departureTime: '16:00', ...BOULEVARD_INFO },
];

/**
 * A tour already added through the admin UI has a different id but the same name.
 * Batched tours share a name, so they are matched on name + batch together.
 */
async function tourExists(id, name, batch) {
  if ((await db.collection('tours').doc(id).get()).exists) return true;
  const sameName = await db.collection('tours').where('name', '==', name).get();
  return sameName.docs.some((d) => (d.data().batch ?? null) === (batch ?? null));
}

for (const [i, t] of TOURS.entries()) {
  const {
    id, restrictedNationalities = [], experienceDuration = '', notices = [],
    capacity = 50, destinationId = id, batch = null, ...data
  } = t;
  const label = batch ? `${t.name} (batch ${batch})` : t.name;
  if (await tourExists(id, t.name, batch)) { console.log(`skip   ${label} (already exists)`); continue; }
  await db.collection('tours').doc(id).set({
    ...data, pickupPoint: 'Main pickup area', date: '',
    capacity, registeredCount: 0, active: true, order: i + 1,
    destinationId, batch,
    restrictedNationalities, experienceDuration, notices,
  });
  console.log(`added  ${label}`);
}

const [rawEmail, name = 'Product Owner', password] = process.argv.slice(2);
if (!rawEmail) {
  console.log('\nNo Product Owner created. Run: npm run seed -- you@example.com "Your Name" "TempPassword123"');
  process.exit(0);
}
const email = rawEmail.trim().toLowerCase();

let user;
try {
  user = await auth.getUserByEmail(email);
  console.log(`\nReusing existing login for ${email} (password unchanged).`);
} catch (e) {
  if (e.code !== 'auth/user-not-found') throw e;
  if (!password || password.length < 8) {
    console.error('Pass a temporary password of at least 8 characters as the third argument.');
    process.exit(1);
  }
  user = await auth.createUser({ email, password, displayName: name });
  console.log(`\nCreated login for ${email}.`);
}
await db.collection('admins').doc(user.uid).set({ email, name, role: 'po' });
console.log(`${name} is now Product Owner. Sign in at /login.`);
