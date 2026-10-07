'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { NATIONALITIES, nationalityLabel } from '@/lib/nationalities';

/**
 * Type-to-search nationality picker. It is a real combobox (text input + listbox) rather
 * than a <select>, because the list is 249 entries long and people know their demonym,
 * not where it falls alphabetically. The chosen ISO code is mirrored into a hidden input
 * so the surrounding form still has a plain value.
 */
export function NationalitySelect({
  id, value, onChange, invalid, describedBy,
}: {
  id: string;
  /** ISO 3166-1 alpha-2 code, or '' for nothing chosen yet. */
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selectedLabel = value ? nationalityLabel(value) : '';
  // While the list is open the input holds the search text; otherwise it shows the choice.
  const text = open ? query : selectedLabel;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!open || !q) return NATIONALITIES;
    const starts = NATIONALITIES.filter((n) => n.label.toLowerCase().startsWith(q));
    const contains = NATIONALITIES.filter(
      (n) => !n.label.toLowerCase().startsWith(q)
        && (n.label.toLowerCase().includes(q) || n.code.toLowerCase() === q)
    );
    return [...starts, ...contains];
  }, [query, open]);

  useEffect(() => { setActive(0); }, [query]);

  // Close when the focus or the pointer leaves the whole control.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open]);

  function choose(code: string) {
    onChange(code);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + matches.length) % Math.max(1, matches.length));
    } else if (e.key === 'Enter') {
      if (open && matches[active]) { e.preventDefault(); choose(matches[active].code); }
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); setQuery(''); }
    }
  }

  const activeId = open && matches[active] ? `${listId}-${matches[active].code}` : undefined;

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        className="input"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        placeholder="Start typing, e.g. Saudi"
        value={text}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {/* A plain value for anything reading the form, and for assistive tech summaries. */}
      <input type="hidden" name="nationality" value={value} />

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Nationality options"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-ink/25 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink/70">No nationality matches that.</li>
          )}
          {matches.map((n, i) => (
            <li
              key={n.code}
              id={`${listId}-${n.code}`}
              role="option"
              aria-selected={n.code === value}
              className={`cursor-pointer px-3 py-2 text-[15px] ${
                i === active ? 'bg-ink text-white' : n.code === value ? 'bg-sun/20' : ''
              }`}
              onMouseEnter={() => setActive(i)}
              // mousedown, so the choice lands before the input loses focus.
              onMouseDown={(e) => { e.preventDefault(); choose(n.code); }}
            >
              {n.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
