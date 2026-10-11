'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth';
import { LogoBand } from '@/components/Logos';

/** Supabase phrases these for developers; these are the words staff see. */
function friendly(message: string) {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email or password is incorrect. Check both and try again.';
  if (m.includes('email not confirmed')) return 'This account is not confirmed yet. Ask the Product Owner for help.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a few minutes, then try again.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'No connection. Check your internet and try again.';
  return 'Sign in failed. Try again.';
}

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) router.replace('/admin'); }, [user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (!email || !password) return setError('Enter your email and password.');
    setBusy(true);
    const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInError) { setError(friendly(signInError.message)); setBusy(false); }
  }

  return (
    <>
      <LogoBand />
      <main className="mx-auto flex min-h-[calc(100vh-5.5rem)] max-w-sm flex-col justify-center px-4">
        <h1 className="text-2xl font-semibold">Team sign in</h1>
        <p className="mt-1 text-sm text-ink/70">For registration, crowd and management staff.</p>
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-clay">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </main>
    </>
  );
}
