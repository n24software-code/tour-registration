import 'server-only';
/**
 * The secret-key client. It bypasses row level security, so it must never be imported
 * by anything that reaches the browser — `server-only` makes that a build error.
 *
 * Used for: the register_visitor RPC (revoked from anon/authenticated on purpose),
 * reading a booking on /registered/[code], creating team logins, and the email outbox.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

let cached: ReturnType<typeof createClient<Database>> | undefined;

export function supabaseAdmin() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.'
    );
  }
  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
