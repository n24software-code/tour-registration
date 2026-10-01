import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['po', 'pm', 'registration', 'crowd'];

/** PO only: creates (or reuses) a login for a team member and assigns a role. */
export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return NextResponse.json({ message: 'Sign in again, then retry.' }, { status: 401 });

  try {
    const auth = adminAuth();
    const db = adminDb();

    let callerUid: string;
    try { callerUid = (await auth.verifyIdToken(token)).uid; }
    catch { return NextResponse.json({ message: 'Your session expired. Sign in again, then retry.' }, { status: 401 }); }

    const callerDoc = await db.collection('admins').doc(callerUid).get();
    if (callerDoc.data()?.role !== 'po')
      return NextResponse.json({ message: 'Only the Product Owner can add team members.' }, { status: 403 });

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

    let existed = true;
    const user = await auth.getUserByEmail(email).catch(async (e: { code?: string }) => {
      if (e.code !== 'auth/user-not-found') throw e;
      existed = false;
      return auth.createUser({ email, password, displayName: name });
    });

    await db.collection('admins').doc(user.uid).set({ email, name, role });
    await db.collection('auditLogs').add({
      action: 'team:add', regId: null, detail: `${email} as ${role}${existed ? ' (existing login)' : ''}`,
      byUid: callerUid, byEmail: callerDoc.data()?.email ?? null, byRole: 'po', at: new Date(),
    });
    return NextResponse.json({ uid: user.uid, existed }, { status: 201 });
  } catch (e) {
    console.error('add admin failed', e);
    return NextResponse.json({ message: (e as Error).message || 'Could not add this team member. Try again.' }, { status: 500 });
  }
}
