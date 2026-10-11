/**
 * Row level security, exercised with real Supabase clients as each role.
 * These bypass the UI entirely, so they prove the database itself is the boundary.
 */
import { expect, test } from '@playwright/test';
import {
  TOUR_IDS, adminDb, anonClient, clientAs, dayAfter, testEmail, testNationalId, type Role,
} from './helpers';

/** A registration to poke at, created with the secret key. */
async function seedReg(status = 'pending') {
  const code = `ZZ${Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[01OI]/g, '2')}`;
  const { error } = await adminDb().from('registrations').insert({
    code, name: 'RLS Probe', email: testEmail(), phone: '+966501234567', phone_country: 'SA',
    id_type: 'national_id', id_number: testNationalId(), nationality: 'SA',
    tour_id: TOUR_IDS.kapsarc, tour_name: 'KAPSARC & Black Gold Museum', slot: 'morning',
    departure_time: '08:00', tour_date: dayAfter(200), status,
  });
  if (error) throw new Error(`seedReg: ${error.message}`);
  return code;
}

const cleanup = (code: string) => adminDb().from('registrations').delete().eq('code', code);

test.describe('Row level security', () => {
  test('anon can read tours but nothing else, and can write nothing', async () => {
    const anon = anonClient();

    // The public form needs the tours before anyone signs in.
    const { data: tours, error: toursErr } = await anon.from('tours').select('id').limit(1);
    expect(toursErr).toBeNull();
    expect(tours?.length).toBeGreaterThan(0);

    // Everything else is invisible. RLS returns an empty set rather than an error.
    for (const table of ['registrations', 'admins', 'audit_logs', 'email_outbox'] as const) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      expect(data ?? [], `${table} must be unreadable for anon`).toHaveLength(0);
      if (error) expect(error.code).not.toBe('');
    }

    // And no writes at all.
    const { error: insErr } = await anon.from('tours').insert({
      id: 'anon-invented', destination_id: 'x', name: 'Hacked', slot: 'morning',
      departure_time: '08:00', capacity: 1,
    });
    expect(insErr, 'anon must not insert tours').not.toBeNull();

    const { error: updErr } = await anon
      .from('tours').update({ capacity: 9999 }).eq('id', TOUR_IDS.kapsarc);
    expect(updErr ?? { code: 'no-rows' }).toBeTruthy();
    expect((await adminDb().from('tours').select('capacity').eq('id', TOUR_IDS.kapsarc).single())
      .data?.capacity).not.toBe(9999);
  });

  test('anon cannot call the booking RPC directly', async () => {
    const anon = anonClient();
    const { error } = await anon.rpc('register_visitor', {
      p_name: 'Hacker', p_email: testEmail(), p_phone: '+966501234567', p_phone_country: 'SA',
      p_id_type: 'national_id', p_id_number: testNationalId(), p_nationality: 'SA',
      p_tour_id: TOUR_IDS.kapsarc, p_tour_date: dayAfter(201), p_accepted_conditions: true,
    });
    // Revoked from anon and authenticated: only the secret key may call it.
    expect(error, 'register_visitor must be server-only').not.toBeNull();
  });

  test('crowd cannot confirm, cancel, delete, or edit tours', async () => {
    const code = await seedReg('pending');
    const crowd = await clientAs('crowd');
    try {
      // Pending is the registration desk's to move.
      const { error: confirmErr } = await crowd.rpc('confirm_registration', { p_code: code });
      expect(confirmErr).not.toBeNull();

      const { error: cancelErr } = await crowd.rpc('cancel_registration', { p_code: code });
      expect(cancelErr).not.toBeNull();

      const { error: delErr } = await crowd.rpc('delete_registration', { p_code: code });
      expect(delErr).not.toBeNull();

      const { error: tourErr } = await crowd
        .from('tours').update({ capacity: 999 }).eq('id', TOUR_IDS.kapsarc);
      expect(tourErr ?? { blocked: true }).toBeTruthy();
      expect((await adminDb().from('tours').select('capacity').eq('id', TOUR_IDS.kapsarc).single())
        .data?.capacity).not.toBe(999);

      // A direct write to the table is refused even for the moves they *can* make.
      const { error: directErr } = await crowd
        .from('registrations').update({ status: 'checked_in' }).eq('code', code);
      expect(directErr ?? { blocked: true }).toBeTruthy();
      expect((await adminDb().from('registrations').select('status').eq('code', code).single())
        .data?.status).toBe('pending');
    } finally {
      await cleanup(code);
    }
  });

  test('crowd can make its own pickup moves once the desk has confirmed', async () => {
    const code = await seedReg('confirmed');
    const crowd = await clientAs('crowd');
    try {
      const { error } = await crowd.rpc('set_status', { p_code: code, p_status: 'checked_in' });
      expect(error).toBeNull();
      expect((await adminDb().from('registrations').select('status').eq('code', code).single())
        .data?.status).toBe('checked_in');
    } finally {
      await cleanup(code);
    }
  });

  test('registration cannot delete a booking or edit tours', async () => {
    const code = await seedReg('pending');
    const desk = await clientAs('registration');
    try {
      const { error: delErr } = await desk.rpc('delete_registration', { p_code: code });
      expect(delErr, 'only the PO may delete').not.toBeNull();
      expect(await adminDb().from('registrations').select('code').eq('code', code).maybeSingle())
        .toHaveProperty('data.code', code);

      const { error: tourErr } = await desk
        .from('tours').update({ capacity: 123 }).eq('id', TOUR_IDS.kapsarc);
      expect(tourErr ?? { blocked: true }).toBeTruthy();
      expect((await adminDb().from('tours').select('capacity').eq('id', TOUR_IDS.kapsarc).single())
        .data?.capacity).not.toBe(123);

      // But it may confirm and cancel.
      expect((await desk.rpc('confirm_registration', { p_code: code })).error).toBeNull();
      expect((await desk.rpc('cancel_registration', { p_code: code })).error).toBeNull();
    } finally {
      await cleanup(code);
    }
  });

  test('only the PO can delete a registration or manage the team', async () => {
    const code = await seedReg('pending');
    const po = await clientAs('po');
    const pm = await clientAs('pm');
    try {
      // PM may edit tours but not the team.
      const crowdRow = await adminDb()
        .from('admins').select('user_id').eq('role', 'crowd').single();
      const crowdUid = crowdRow.data!.user_id as string;

      expect((await pm.rpc('set_admin_role', { p_user_id: crowdUid, p_role: 'po' })).error)
        .not.toBeNull();
      expect((await pm.rpc('remove_admin', { p_user_id: crowdUid })).error).not.toBeNull();
      expect((await pm.from('admins').update({ role: 'po' }).eq('user_id', crowdUid)).error
        ?? { blocked: true }).toBeTruthy();
      expect((await adminDb().from('admins').select('role').eq('user_id', crowdUid).single())
        .data?.role).toBe('crowd');

      // The PO can delete a registration.
      expect((await po.rpc('delete_registration', { p_code: code })).error).toBeNull();
      expect((await adminDb().from('registrations').select('code').eq('code', code).maybeSingle())
        .data).toBeNull();

      // Nobody may change their own role, not even the PO.
      const poUid = (await adminDb().from('admins').select('user_id').eq('role', 'po').single())
        .data!.user_id as string;
      expect((await po.rpc('set_admin_role', { p_user_id: poUid, p_role: 'crowd' })).error)
        .not.toBeNull();
    } finally {
      await cleanup(code);
    }
  });

  test('audit_logs are append-only and only PO/PM can read them', async () => {
    const { data: row } = await adminDb()
      .from('audit_logs').insert({ action: 'e2e:probe', detail: 'E2E rls probe' })
      .select('id').single();
    const id = row!.id as number;

    try {
      for (const role of ['po', 'pm'] as Role[]) {
        const c = await clientAs(role);
        const { data } = await c.from('audit_logs').select('id').eq('id', id);
        expect(data ?? [], `${role} should read the trail`).toHaveLength(1);
      }
      for (const role of ['registration', 'crowd'] as Role[]) {
        const c = await clientAs(role);
        const { data } = await c.from('audit_logs').select('id').eq('id', id);
        expect(data ?? [], `${role} must not read the trail`).toHaveLength(0);
      }

      // Nobody can rewrite history.
      const po = await clientAs('po');
      await po.from('audit_logs').update({ action: 'tampered' }).eq('id', id);
      await po.from('audit_logs').delete().eq('id', id);
      const after = await adminDb().from('audit_logs').select('action').eq('id', id).single();
      expect(after.data?.action).toBe('e2e:probe');
    } finally {
      await adminDb().from('audit_logs').delete().eq('id', id);
    }
  });

  test('email_outbox is unreadable for anon and readable for admins', async () => {
    const anon = anonClient();
    const { data: hidden } = await anon.from('email_outbox').select('*').limit(1);
    expect(hidden ?? []).toHaveLength(0);

    const desk = await clientAs('registration');
    const { error } = await desk.from('email_outbox').select('id').limit(1);
    expect(error).toBeNull();
  });
});
