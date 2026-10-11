import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { sendOutboxRow } from '@/lib/mailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Re-queues and re-sends a booking confirmation.
 *
 * The role check happens in Postgres: queue_resend runs as the signed-in user, and
 * require_role('po','pm','registration') inside it is what refuses anyone else.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? '').trim().toUpperCase();
  if (!code) return NextResponse.json({ message: 'Which registration?' }, { status: 400 });

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Sign in again, then retry.' }, { status: 401 });

  const { data: outboxId, error } = await supabase.rpc('queue_resend' as never, { p_code: code } as never);
  if (error) {
    const forbidden = error.code === '42501' || /forbidden/i.test(error.message);
    return NextResponse.json(
      { message: forbidden ? 'Your role is not allowed to re-send confirmations.' : error.message },
      { status: forbidden ? 403 : 400 }
    );
  }

  const outcome = await sendOutboxRow(String(outboxId));
  if (outcome.status === 'failed') {
    // The row is queued and recorded as an error; a retry can still pick it up.
    return NextResponse.json(
      { outboxId, sent: false, message: `Queued, but sending failed: ${outcome.error}` },
      { status: 202 }
    );
  }
  return NextResponse.json({ outboxId, sent: outcome.status === 'sent' }, { status: 200 });
}
