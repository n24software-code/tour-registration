import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { adminDb, isTestEmail, isTestPassport } from './helpers';
import { SNAPSHOT_PATH } from './global-setup';

/** Throwaway team logins the Team spec creates. */
const MEMBER_PREFIX = 'e2e-member-';

/**
 * Removes ONLY the suite's own data:
 *   - registrations with an e2e+…@tour.test address or an E2E… id number
 *   - their outbox rows and audit entries
 *   - tours the Tours spec added (name starts with "E2E ")
 *   - throwaway Auth logins
 * Then restores every tour from the snapshot — capacity above all.
 */
export default async function globalTeardown() {
  const db = adminDb();

  // --- tours first: the raised capacity is the damaging leftover ---------
  let restored = 0;
  if (existsSync(SNAPSHOT_PATH)) {
    const { tours } = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
      tours: Record<string, unknown>[];
    };
    for (const t of tours) {
      const { error } = await db.from('tours').update(t).eq('id', t.id as string);
      if (!error) restored++;
    }
  }

  // --- the suite's registrations ----------------------------------------
  const { data: regs } = await db.from('registrations').select('code, email, id_number');
  const codes = (regs ?? [])
    .filter((r) => isTestEmail(String(r.email ?? '')) || isTestPassport(String(r.id_number ?? '')))
    .map((r) => r.code as string);

  let outbox = 0;
  if (codes.length) {
    const { count } = await db
      .from('email_outbox').delete({ count: 'exact' }).in('reg_code', codes);
    outbox = count ?? 0;
    await db.from('audit_logs').delete().in('reg_code', codes);
    await db.from('registrations').delete().in('code', codes);
  }

  // Outbox rows addressed to an e2e visitor whose registration is already gone.
  const { data: strays } = await db.from('email_outbox').select('id, to_email');
  const strayIds = (strays ?? [])
    .filter((r) => isTestEmail(String(r.to_email ?? '')))
    .map((r) => r.id as string);
  if (strayIds.length) {
    await db.from('email_outbox').delete().in('id', strayIds);
    outbox += strayIds.length;
  }

  // --- tours the suite created ------------------------------------------
  const { data: extra } = await db.from('tours').select('id, name').like('name', 'E2E %');
  let deletedTours = 0;
  for (const t of extra ?? []) {
    const { error } = await db.from('tours').delete().eq('id', t.id as string);
    if (!error) deletedTours++;
  }

  // --- throwaway logins --------------------------------------------------
  let members = 0;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data.users) {
      if (!(u.email ?? '').startsWith(MEMBER_PREFIX)) continue;
      await db.from('admins').delete().eq('user_id', u.id);
      await db.auth.admin.deleteUser(u.id);
      members++;
    }
    if (data.users.length < 200) break;
  }

  if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH);
  console.log(
    `[global-teardown] deleted ${codes.length} registrations, ${outbox} outbox rows, ` +
    `${deletedTours} e2e tours, ${members} throwaway logins; restored ${restored} tours`
  );
}
