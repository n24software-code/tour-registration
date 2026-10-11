'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxItem {
  /** Stored value, e.g. "SA". */
  value: string;
  /** What the input shows once chosen, and the option's accessible name. */
  label: string;
  /** Extra text the search should match, e.g. a dial code. */
  keywords?: string;
  /** Optional richer rendering for the option row. */
  render?: React.ReactNode;
}

/**
 * Type-to-search picker: a real combobox (text input + listbox) rather than a <select>,
 * because these lists run to hundreds of entries and people know the name they want,
 * not where it falls alphabetically. The chosen value is mirrored into a hidden input so
 * the surrounding form still has a plain value.
 */
export function Combobox({
  id, name, items, value, onChange, placeholder, invalid, describedBy, listLabel,
}: {
  id: string;
  name?: string;
  items: ComboboxItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Names the popup for screen readers. Must not repeat the field's own label. */
  listLabel: string;
}) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = useMemo(() => items.find((i) => i.value === value), [items, value]);
  // While the list is open the input holds the search text; otherwise it shows the choice.
  const text = open ? query : selected?.label ?? '';

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!open || !q) return items;
    const hay = (i: ComboboxItem) => `${i.label} ${i.keywords ?? ''} ${i.value}`.toLowerCase();
    const starts = items.filter((i) => i.label.toLowerCase().startsWith(q));
    const rest = items.filter((i) => !i.label.toLowerCase().startsWith(q) && hay(i).includes(q));
    return [...starts, ...rest];
  }, [query, open, items]);

  useEffect(() => { setActive(0); }, [query]);

  // Close when the focus or the pointer leaves the whole control.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open]);

  function choose(v: string) {
    onChange(v);
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
      if (open && matches[active]) { e.preventDefault(); choose(matches[active].value); }
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); setQuery(''); }
    }
  }

  const activeId = open && matches[active] ? `${listId}-${matches[active].value}` : undefined;

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
        placeholder={placeholder}
        value={text}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {/* A plain value for anything reading the form, and for assistive tech summaries. */}
      {name && <input type="hidden" name={name} value={value} />}

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="absolute z-20 mt-1 max-h-64 w-full min-w-[15rem] overflow-y-auto rounded-md border border-ink/25 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink/70">Nothing matches that.</li>
          )}
          {matches.map((item, i) => (
            <li
              key={item.value}
              id={`${listId}-${item.value}`}
              role="option"
              data-value={item.value}
              aria-selected={item.value === value}
              className={`cursor-pointer px-3 py-2 text-[15px] ${
                i === active ? 'bg-ink text-white' : item.value === value ? 'bg-sun/20' : ''
              }`}
              onMouseEnter={() => setActive(i)}
              // mousedown, so the choice lands before the input loses focus.
              onMouseDown={(e) => { e.preventDefault(); choose(item.value); }}
            >
              {item.render ?? item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
