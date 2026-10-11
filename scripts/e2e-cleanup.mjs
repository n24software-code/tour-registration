// Undoes an e2e run that was interrupted before global-teardown could finish.
//
//   npm run e2e:cleanup
//
// Removes only the suite's own data — registrations with an e2e+…@tour.test address or
// an E2E… ID number, their mail documents and audit rows, and tours named "E2E …" —
// then restores every tour from e2e/.tours-snapshot.json (capacity above all, which the
// suite raises for the duration of a run).
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: '.env.local' });
dotenv.config();

const SNAPSHOT = 'e2e/.tours-snapshot.json';
const isTestEmail = (e) => String(e ?? '').startsWith('e2e+') && String(e).endsWith('@tour.test');
const isTestId = (v) => String(v ?? '').startsWith('E2E');

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore();

// --- tours first: the capacity the suite raised is the damaging leftover -----
let restored = 0;
if (existsSync(SNAPSHOT)) {
  const { tours } = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  for (const t of tours) {
    await db.collection('tours').doc(t.id).update({
      capacity: t.capacity, registeredCount: t.registeredCount, active: t.active,
      pickupPoint: t.pickupPoint, departureTime: t.departureTime, date: t.date, name: t.name,
      restrictedNationalities: t.restrictedNationalities,
      experienceDuration: t.experienceDuration, notices: t.notices,
    }).catch((e) => console.warn(`  could not restore ${t.id}: ${e.message}`));
    restored++;
  }
  console.log(`restored ${restored} tours from the snapshot`);
} else {
  console.log(`no ${SNAPSHOT} — tours left as they are`);
}

// --- then the documents the suite created ------------------------------------
const regs = await db.collection('registrations').get();
const codes = regs.docs
  .filter((d) => isTestEmail(d.data().email) || isTestId(d.data().idNumber))
  .map((d) => d.id);
for (const code of codes) await db.collection('registrations').doc(code).delete();

const mail = await db.collection('mail').get();
let mails = 0;
for (const d of mail.docs) if (isTestEmail(d.data().to)) { await d.ref.delete(); mails++; }

const logs = await db.collection('auditLogs').get();
let rows = 0;
for (const d of logs.docs) {
  const x = d.data();
  if (codes.includes(x.regId) || isTestId(String(x.detail ?? '').match(/E2E\w*/)?.[0])) {
    await d.ref.delete();
    rows++;
  }
}

const tours = await db.collection('tours').get();
let extraTours = 0;
for (const d of tours.docs) {
  if (String(d.data().name ?? '').startsWith('E2E ')) { await d.ref.delete(); extraTours++; }
}

if (existsSync(SNAPSHOT)) unlinkSync(SNAPSHOT);
console.log(
  `deleted ${codes.length} registrations, ${mails} mail docs, ${rows} audit rows, ${extraTours} e2e tours`
);
