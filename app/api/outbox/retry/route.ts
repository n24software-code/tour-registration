import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { MAX_ATTEMPTS, sendOutboxRow } from '@/lib/mailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Retries confirmations that never went out — rows left `pending` because the request
 * died after the booking committed, and rows that failed transiently.
 *
 * Two ways in, because it serves both a person and a scheduler:
 *   • a signed-in admin with manageRegistrations (the button on the Registrations page)
 *   • a cron caller presenting CRON_SECRET as a bearer token
 *
 * Vercel Cron: add to vercel.json
 *   { "crons": [{ "path": "/api/outbox/retry", "schedule": "*\/10 * * * *" }] }
 * and set CRON_SECRET; Vercel sends it as `Authorization: Bearer <CRON_SECRET>`.
 */
async function authorise(req: Request): Promise<string | null> {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (secret && bearer === secret) return 'cron';

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('admins').select('role').eq('user_id', user.id).maybeSingle();
  const role = data?.role;
  return role && ['po', 'pm', 'registration'].includes(role) ? role : null;
}

export async function POST(req: Request) {
  const who = await authorise(req);
  if (!who) return NextResponse.json({ message: 'Not allowed.' }, { status: 403 });

  const db = supabaseAdmin();
  const { data: rows, error } = await db
    .from('email_outbox')
    .select('id')
    .in('status', ['pending', 'error'])
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const outcome = await sendOutboxRow(row.id);
    if (outcome.status === 'sent') sent++;
    else if (outcome.status === 'failed') failed++;
  }

  return NextResponse.json({ considered: rows?.length ?? 0, sent, failed });
}

// Vercel Cron issues GET by default; same work, same guard.
export const GET = POST;
