/**
 * Server components and route handlers. Reads the session from cookies, so RLS sees the
 * signed-in user — this is what the admin-only API routes check the caller's role with.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

export function supabaseServer() {
  const store = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          // A server component can't set cookies; the middleware/route that can will.
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch { /* read-only context */ }
        },
      },
    }
  );
}
