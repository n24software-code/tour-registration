'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  collection, onSnapshot, orderBy, query,
  type DocumentData, type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Admin, Registration, Tour } from './types';

type Mapper<T> = (d: QueryDocumentSnapshot<DocumentData>) => T;
const withId = <T,>(d: QueryDocumentSnapshot<DocumentData>) => ({ ...d.data(), id: d.id }) as T;

/** Real-time subscription — this is what keeps the Registration and Crowd teams in sync. */
function useLive<T>(path: string, constraints: QueryConstraint[], key: string, map: Mapper<T>, enabled = true) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) { setData([]); setLoading(false); return; }
    setLoading(true); setError('');
    return onSnapshot(
      query(collection(db, path), ...constraints),
      (s) => { setData(s.docs.map(map)); setLoading(false); },
      (e) => { console.error(e); setError('Live updates stopped. Check your connection and reload the page.'); setLoading(false); }
    );
    // `key` captures everything the constraints depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);
  return { data, loading, error };
}

export function useTours() {
  const r = useLive<Tour>('tours', [], 'all', withId<Tour>);
  return { ...r, data: [...r.data].sort((a, b) => a.order - b.order || a.departureTime.localeCompare(b.departureTime)) };
}

export const useRegistrations = () =>
  useLive<Registration>('registrations', [orderBy('createdAt', 'desc')], 'all', withId<Registration>);

export const useAdmins = () =>
  useLive<Admin>('admins', [], 'all', (d) => ({ ...d.data(), uid: d.id }) as Admin);

/** Runs an admin action, tracking which item is busy and surfacing failures in plain words. */
export function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const run = useCallback(async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setError('');
    try { await fn(); }
    catch (e) {
      console.error(e);
      const code = (e as { code?: string }).code;
      setError(code === 'permission-denied'
        ? 'Your role is not allowed to make that change.'
        : (e as Error).message || 'That change could not be saved. Try again.');
    } finally { setBusy(null); }
  }, []);
  return { run, busy, error, clearError: () => setError('') };
}
