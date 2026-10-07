import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, adminDb, TEST_PASSPORT_PREFIX, isTestReg } from './helpers';
import { SNAPSHOT_PATH } from './global-setup';

/** Throwaway team logins the Team spec creates. */
const MEMBER_PREFIX = 'e2e-member-';

/**
 * Removes ONLY the suite's own data:
 *   - registrations whose email looks like e2e+<ts>@tour.test, or whose passport
 *     starts with E2E (email is optional, so passport is the reliable marker)
 *   - auditLogs rows pointing at those registration codes, plus the two kinds that
 *     have no surviving registration to point at: "registration:delete" (the row is
 *     gone, but its detail names an E2E passport) and "registrations:export" (no regId
 *     at all, so they are matched by action + written-during-this-run)
 *   - tours added by the Tours test (name starts with "E2E ")
 * Then restores each surviving tour's capacity / registeredCount / active / pickup / time / date.
 */
export default async function globalTeardown() {
  const db = adminDb();
  const saved = existsSync(SNAPSHOT_PATH)
    ? (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
        startedAt?: number; tours: Array<Record<string, unknown>>;
      })
    : undefined;
  const startedAt = saved?.startedAt;

  // --- test registrations -------------------------------------------------
  const regs = await db.collection('registrations').get();
  const testCodes = regs.docs.filter((d) => isTestReg(d.data())).map((d) => d.id);

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

  // Rows whose registration the suite deleted on purpose: the code is gone, but the
  // detail still names the E2E passport that only this suite ever invents.
  const deleteLogs = await db.collection('auditLogs').where('action', '==', 'registration:delete').get();
  for (const d of deleteLogs.docs) {
    if (String(d.data().detail ?? '').includes(`passport ${TEST_PASSPORT_PREFIX}`)) {
      await d.ref.delete();
      deletedLogs++;
    }
  }

  // Export rows have no regId, so they are matched by action + this run's start time.
  if (startedAt) {
    const exportLogs = await db.collection('auditLogs').where('action', '==', 'registrations:export').get();
    for (const d of exportLogs.docs) {
      const at = d.data().at?.toMillis?.() ?? 0;
      if (at >= startedAt) { await d.ref.delete(); deletedLogs++; }
    }
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
  if (saved) {
    for (const t of saved.tours) {
      const ref = db.collection('tours').doc(t.id as string);
      if (!(await ref.get()).exists) continue;
      await ref.update({
        capacity: t.capacity, registeredCount: t.registeredCount, active: t.active,
        pickupPoint: t.pickupPoint, departureTime: t.departureTime, date: t.date, name: t.name,
        restrictedNationalities: t.restrictedNationalities,
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
