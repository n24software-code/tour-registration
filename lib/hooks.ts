'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase/client';
import {
  toAdmin, toRegistration, toTour,
  type AdminRow, type RegistrationRow, type TourRow,
} from './supabase/types';
import type { Admin, Registration, Tour } from './types';

/**
 * An initial select plus a Realtime subscription, merged into one list.
 *
 * This is what keeps the Registration and Crowd teams in step. Row level security
 * applies to Realtime too, so a subscriber only ever receives rows its own policies
 * would have let it select.
 */
/** The tables the admin pages subscribe to. */
type LiveTable = 'tours' | 'registrations' | 'admins';

function useLive<Row extends object, T>(
  table: LiveTable,
  pk: keyof Row & string,
  map: (row: Row) => T
) {
  const [rows, setRows] = useState<Map<string, Row>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;

    async function sync() {
      const { data, error: err } = await supabase.from(table).select('*');
      if (!active) return;
      if (err) {
        console.error(err);
        setError('Live updates stopped. Check your connection and reload the page.');
        setLoading(false);
        return;
      }
      setError('');
      setRows(new Map((data as Row[]).map((r) => [String(r[pk]), r])));
      setLoading(false);
    }

    void sync();

    const channel = supabase
      .channel(`live:${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload: RealtimePostgresChangesPayload<Row>) => {
          if (!active) return;
          setRows((prev) => {
            const next = new Map(prev);
            if (payload.eventType === 'DELETE') {
              const old = payload.old as Partial<Row>;
              const key = old?.[pk];
              if (key !== undefined) next.delete(String(key));
            } else {
              const row = payload.new as Row;
              const key = row?.[pk];
              if (key !== undefined) next.set(String(key), row);
            }
            return next;
          });
        }
      )
      .subscribe((status) => {
        // A dropped socket can miss changes, so re-read the table on reconnect.
        if (status === 'SUBSCRIBED') void sync();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Live updates stopped. Check your connection and reload the page.');
        }
      });

    return () => { active = false; void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, pk]);

  const data = useMemo(() => [...rows.values()].map(map), [rows, map]);
  return { data, loading, error };
}

const mapTour = (r: TourRow) => toTour(r);
const mapReg = (r: RegistrationRow) => toRegistration(r);
const mapAdmin = (r: AdminRow) => toAdmin(r);

export function useTours() {
  const r = useLive<TourRow, Tour>('tours', 'id', mapTour);
  return {
    ...r,
    data: [...r.data].sort(
      (a, b) => a.order - b.order || a.departureTime.localeCompare(b.departureTime)
    ),
  };
}

export function useRegistrations() {
  const r = useLive<RegistrationRow, Registration>('registrations', 'code', mapReg);
  return {
    ...r,
    // Newest first, as the admin lists have always shown them.
    data: [...r.data].sort((a, b) => {
      const at = a.createdAt?.toDate().getTime() ?? 0;
      const bt = b.createdAt?.toDate().getTime() ?? 0;
      return bt - at;
    }),
  };
}

export const useAdmins = () => useLive<AdminRow, Admin>('admins', 'user_id', mapAdmin);

/** Runs an admin action, tracking which item is busy and surfacing failures in plain words. */
export function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const run = useCallback(async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setError('');
    try { await fn(); }
    catch (e) {
      console.error(e);
      setError((e as Error).message || 'That change could not be saved. Try again.');
    } finally { setBusy(null); }
  }, []);
  return { run, busy, error, clearError: () => setError('') };
}
