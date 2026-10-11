'use client';
import { useMemo } from 'react';
import { COUNTRIES, countryLabel, countryOf } from '@/lib/countries';
import { Combobox } from './Combobox';

/**
 * Country dial code + national number. The two are stored separately (`phoneCountry`
 * and `phone`) and only joined into E.164 once libphonenumber has confirmed the number
 * is valid for that country.
 */
export function PhoneField({
  countryId, numberId, country, number, onCountryChange, onNumberChange,
  invalid, describedBy,
}: {
  countryId: string;
  numberId: string;
  country: string;
  number: string;
  onCountryChange: (code: string) => void;
  onNumberChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const items = useMemo(
    () => COUNTRIES.map((c) => ({
      value: c.code as string,
      label: countryLabel(c),
      keywords: `${c.name} ${c.dial} +${c.dial} ${c.code}`,
      render: (
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-lg leading-none">{c.flag}</span>
          <span className="flex-1">{c.name}</span>
          <span className="text-ink/60">+{c.dial}</span>
        </span>
      ),
    })),
    []
  );
  const dial = countryOf(country)?.dial;

  return (
    <div className="grid grid-cols-[minmax(0,11rem),1fr] gap-2">
      <div>
        <label htmlFor={countryId} className="sr-only">Country code</label>
        <Combobox
          id={countryId}
          name="phoneCountry"
          listLabel="Country codes"
          placeholder="Country"
          items={items}
          value={country}
          onChange={onCountryChange}
        />
      </div>
      <div>
        <label htmlFor={numberId} className="sr-only">Mobile number</label>
        <div className="flex items-stretch rounded-md border border-ink/25 bg-white focus-within:border-ink aria-[invalid=true]:border-clay"
             aria-invalid={invalid}>
          {dial && (
            <span className="flex select-none items-center pl-3 text-base text-ink/70 sm:text-[15px]" aria-hidden>
              +{dial}
            </span>
          )}
          <input
            id={numberId}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            className="w-full rounded-md bg-transparent px-3 py-2.5 text-base placeholder:text-ink/45 focus:outline-none sm:text-[15px]"
            placeholder="5X XXX XXXX"
            value={number}
            onChange={(e) => onNumberChange(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        </div>
      </div>
    </div>
  );
}
