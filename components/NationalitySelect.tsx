'use client';
import { useMemo } from 'react';
import { NATIONALITIES } from '@/lib/nationalities';
import { Combobox } from './Combobox';

/** Type-to-search nationality picker over all 249 demonyms, Saudi pinned first. */
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
  const items = useMemo(
    () => NATIONALITIES.map((n) => ({ value: n.code, label: n.label })),
    []
  );
  return (
    <Combobox
      id={id}
      name="nationality"
      listLabel="Nationality options"
      placeholder="Start typing, e.g. Saudi"
      items={items}
      value={value}
      onChange={onChange}
      invalid={invalid}
      describedBy={describedBy}
    />
  );
}
