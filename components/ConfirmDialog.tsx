'use client';
import { useEffect, useRef } from 'react';

/**
 * A real modal dialog, not window.confirm: it can carry the full detail of what is about
 * to happen, and it is reachable for keyboard and screen-reader users.
 *
 * Focus moves to the cancel button on open and is trapped inside the dialog, Escape
 * closes it, and whatever had focus before is focused again on the way out.
 */
export function ConfirmDialog({
  open, title, description, details, confirmLabel, cancelLabel = 'Keep it',
  onConfirm, onCancel, busy = false,
}: {
  open: boolean;
  title: string;
  description: string;
  /** Label/value pairs shown above the message, so the user can check what they picked. */
  details?: [string, string][];
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember who opened it, and start on the safe choice.
    opener.current = document.activeElement as HTMLElement | null;
    cancelBtn.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      opener.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      {/* A click outside is the same as "Keep it". */}
      <div className="absolute inset-0" onClick={onCancel} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        className="relative w-full max-w-md rounded-md border border-ink/10 bg-white p-5 shadow-xl sm:p-6"
      >
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>

        {details && details.length > 0 && (
          <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 rounded-md bg-paper px-4 py-3 text-sm">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink/70">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <p id="confirm-description" className="mt-4 text-sm text-ink/75">{description}</p>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={cancelBtn} type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="btn-danger-solid" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
