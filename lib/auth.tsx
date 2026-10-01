'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { Admin } from './types';

interface AuthState { user: User | null; admin: Admin | null; loading: boolean }
const AuthContext = createContext<AuthState>({ user: null, admin: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, admin: null, loading: true });

  useEffect(() => {
    let stopAdmin: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopAdmin?.();
      stopAdmin = undefined;
      if (!user) return setState({ user: null, admin: null, loading: false });
      setState({ user, admin: null, loading: true });
      // Live, so a role change or removal by the PO takes effect immediately.
      stopAdmin = onSnapshot(
        doc(db, 'admins', user.uid),
        (snap) => setState({
          user,
          admin: snap.exists() ? ({ ...snap.data(), uid: user.uid } as Admin) : null,
          loading: false,
        }),
        // Rules deny reading admins/{uid} when the account has no role yet.
        () => setState({ user, admin: null, loading: false })
      );
    });
    return () => { stopAdmin?.(); stopAuth(); };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
