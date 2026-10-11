import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['po', 'pm', 'registration', 'crowd'];

/** PO only: creates (or reuses) a login for a team member and assigns a role. */
export async function POST(req: Request) {
  // The caller's own session decides whether they may do this — the secret key is
  // only used afterwards, to reach the Auth admin API.
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Sign in again, then retry.' }, { status: 401 });

  const { data: caller } = await supabase
    .from('admins').select('role, email').eq('user_id', user.id).maybeSingle();
  if (caller?.role !== 'po') {
    return NextResponse.json({ message: 'Only the Product Owner can add team members.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const role = body.role as Role;
  const password = String(body.password ?? '');

  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = 'Enter their name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!ROLES.includes(role)) errors.role = 'Choose a role.';
  if (password.length < 8) errors.password = 'Use at least 8 characters for the temporary password.';
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });

  try {
    const admin = supabaseAdmin();

    // Reuse an existing login rather than failing: the same person may have had a
    // role before, and their password should keep working.
    let userId: string | undefined;
    let existed = false;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
      if (hit) { userId = hit.id; existed = true; }
      if (data.users.length < 200) break;
    }

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name },
      });
      if (error) throw new Error(error.message);
      userId = data.user.id;
    }

    const { error: upErr } = await admin
      .from('admins').upsert({ user_id: userId, email, name, role }, { onConflict: 'user_id' });
    if (upErr) throw new Error(upErr.message);

    await admin.from('audit_logs').insert({
      action: 'team:add', reg_code: null,
      detail: `${email} as ${role}${existed ? ' (existing login)' : ''}`,
      by_uid: user.id, by_email: caller.email, by_role: 'po',
    });

    return NextResponse.json({ uid: userId, existed }, { status: 201 });
  } catch (e) {
    console.error('add admin failed', e);
    return NextResponse.json(
      { message: (e as Error).message || 'Could not add this team member. Try again.' },
      { status: 500 }
    );
  }
}
