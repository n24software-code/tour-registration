import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, adminDb, isTestEmail } from './helpers';
import { SNAPSHOT_PATH } from './global-setup';

/** Throwaway team logins the Team spec creates. */
const MEMBER_PREFIX = 'e2e-member-';

/**
 * Removes ONLY the suite's own data:
 *   - registrations whose email looks like e2e+<ts>@tour.test
 *   - auditLogs rows pointing at those registration codes
 *   - tours added by the Tours test (name starts with "E2E ")
 * Then restores each surviving tour's capacity / registeredCount / active / pickup / time / date.
 */
export default async function globalTeardown() {
  const db = adminDb();

  // --- test registrations -------------------------------------------------
  const regs = await db.collection('registrations').get();
  const testCodes = regs.docs.filter((d) => isTestEmail(String(d.data().email ?? ''))).map((d) => d.id);

  let deletedRegs = 0;
  for (const chunk of batches(testCodes, 400)) {
    const b = db.batch();
    chunk.forEach((code) => b.delete(db.collection('registrations').doc(code)));
    await b.commit();
    deletedRegs += chunk.length;
  }

  // --- their audit logs ---------------------------------------------------
  let deletedLogs = 0;
  for (const chunk of batches(testCodes, 10)) { // `in` supports <= 30 values
    const snap = await db.collection('auditLogs').where('regId', 'in', chunk).get();
    if (snap.empty) continue;
    const b = db.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    deletedLogs += snap.size;
  }

  // --- throwaway team logins -------------------------------------------
  // Done here rather than at the end of the test body, so a mid-test failure
  // cannot leak an Auth user.
  const auth = getAuth(adminApp());
  let deletedMembers = 0;
  const users = await auth.listUsers(1000);
  for (const u of users.users) {
    if (!(u.email ?? '').startsWith(MEMBER_PREFIX)) continue;
    await adminDb().collection('admins').doc(u.uid).delete().catch(() => {});
    await auth.deleteUser(u.uid).catch(() => {});
    deletedMembers++;
  }

  // ...and the audit rows naming them.
  let deletedMemberLogs = 0;
  const teamLogs = await db.collection('auditLogs').get();
  for (const d of teamLogs.docs) {
    if (String(d.data().detail ?? '').includes(MEMBER_PREFIX)) {
      await d.ref.delete();
      deletedMemberLogs++;
    }
  }

  // --- tours the suite created ------------------------------------------
  const tours = await db.collection('tours').get();
  let deletedTours = 0;
  for (const d of tours.docs) {
    if (String(d.data().name ?? '').startsWith('E2E ')) { await d.ref.delete(); deletedTours++; }
  }

  // --- restore the pre-test tour state -----------------------------------
  let restored = 0;
  if (existsSync(SNAPSHOT_PATH)) {
    const saved = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Array<Record<string, unknown>>;
    for (const t of saved) {
      const ref = db.collection('tours').doc(t.id as string);
      if (!(await ref.get()).exists) continue;
      await ref.update({
        capacity: t.capacity, registeredCount: t.registeredCount, active: t.active,
        pickupPoint: t.pickupPoint, departureTime: t.departureTime, date: t.date, name: t.name,
      });
      restored++;
    }
    unlinkSync(SNAPSHOT_PATH);
  }

  console.log(
    `[global-teardown] deleted ${deletedRegs} registrations, ${deletedLogs + deletedMemberLogs} audit rows, ` +
    `${deletedTours} e2e tours, ${deletedMembers} throwaway logins; restored ${restored} tours`
  );
}

function* batches<T>(arr: T[], size: number) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
