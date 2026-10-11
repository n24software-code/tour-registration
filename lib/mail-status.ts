'use client';
/**
 * Live delivery state for each registration's booking confirmation.
 *
 * `registration_mail_status` is a view over email_outbox that keeps only the newest
 * row per registration, so a resend simply supersedes the previous attempt. RLS limits
 * it to admins; for anyone else the subscription just stays empty.
 */
import { useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase/client';

export type OutboxState = 'pending' | 'sent' | 'error';

export interface MailStatus {
  state: OutboxState;
  error?: string | null;
  attempts: number;
}

export const MAIL_LABEL: Record<OutboxState, string> = {
  pending: 'Pending',
  sent: 'Sent',
  error: 'Error',
};

export const MAIL_STYLE: Record<OutboxState, string> = {
  pending: 'bg-sun/25 text-[#6b4409]',
  sent: 'bg-palm/15 text-palm',
  error: 'bg-clay/15 text-clay',
};

/** registration code → delivery state, live. */
export function useMailStatuses() {
  const [map, setMap] = useState<Map<string, MailStatus>>(new Map());

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;

    async function sync() {
      const { data, error } = await supabase
        .from('registration_mail_status')
        .select('reg_code, status, error, attempts');
      if (!active || error) return;
      setMap(new Map(
        (data ?? []).map((r) => [
          String(r.reg_code),
          { state: r.status as OutboxState, error: r.error, attempts: r.attempts },
        ])
      ));
    }

    void sync();
    // The view isn't itself replicated, so changes to the underlying table drive it.
    const channel = supabase
      .channel('live:email_outbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_outbox' }, () => {
        void sync();
      })
      .subscribe();

    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);

  return map;
}
