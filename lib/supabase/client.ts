'use client';
/**
 * The browser client. Uses the publishable key, so every query it makes is subject to
 * row level security — this key is safe to ship.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

let cached: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function supabaseBrowser() {
  cached ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  return cached;
}
