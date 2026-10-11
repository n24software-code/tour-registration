'use client';
/**
 * Live view of the Trigger Email extension's delivery state. The extension writes
 * `delivery.state` back onto each `mail/{id}` document; registrations keep the id in
 * `mailId`, which is what links the two.
 *
 * Nothing here assumes the extension is installed: until it is, documents simply have
 * no `delivery` field and the UI says "Queued".
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { MailState } from './types';

export interface MailStatus {
  state: MailState | 'QUEUED';
  error?: string | null;
}

export const MAIL_LABEL: Record<MailStatus['state'], string> = {
  QUEUED: 'Queued',
  PENDING: 'Pending',
  PROCESSING: 'Pending',
  SUCCESS: 'Sent',
  ERROR: 'Error',
  RETRY: 'Pending',
};

export const MAIL_STYLE: Record<MailStatus['state'], string> = {
  QUEUED: 'bg-ink/10 text-ink/70',
  PENDING: 'bg-sun/25 text-[#6b4409]',
  PROCESSING: 'bg-sun/25 text-[#6b4409]',
  SUCCESS: 'bg-palm/15 text-palm',
  ERROR: 'bg-clay/15 text-clay',
  RETRY: 'bg-sun/25 text-[#6b4409]',
};

/** mailId → delivery state, live. */
export function useMailStatuses() {
  const [map, setMap] = useState<Map<string, MailStatus>>(new Map());
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'mail'),
        (snap) => {
          const next = new Map<string, MailStatus>();
          for (const d of snap.docs) {
            const delivery = d.data().delivery as { state?: MailState; error?: string } | undefined;
            next.set(d.id, { state: delivery?.state ?? 'QUEUED', error: delivery?.error ?? null });
          }
          setMap(next);
        },
        // Reading `mail` is a PO/PM-only privilege; for everyone else this just stays empty.
        () => setMap(new Map())
      ),
    []
  );
  return map;
}
