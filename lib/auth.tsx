'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase/client';
import { toAdmin, type AdminRow } from './supabase/types';
import type { Admin } from './types';

interface AuthState { user: User | null; admin: Admin | null; loading: boolean }
const AuthContext = createContext<AuthState>({ user: null, admin: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, admin: null, loading: true });

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;

    /** Resolves the signed-in user's role, or null when they have none yet. */
    async function load(session: Session | null) {
      if (!session?.user) {
        if (active) setState({ user: null, admin: null, loading: false });
        return;
      }
      const user = session.user;
      if (active) setState({ user, admin: null, loading: true });

      const { data } = await supabase
        .from('admins').select('*').eq('user_id', user.id).maybeSingle();
      if (!active) return;
      setState({ user, admin: data ? toAdmin(data as AdminRow) : null, loading: false });
    }

    supabase.auth.getSession().then(({ data }) => load(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { void load(session); });

    // A role change or removal by the PO should take effect without a reload.
    const channel = supabase
      .channel('admins-self')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admins' }, () => {
        void supabase.auth.getSession().then(({ data }) => load(data.session));
      })
      .subscribe();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
