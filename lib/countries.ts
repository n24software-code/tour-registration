/**
 * The country list behind the phone-number country selector: flag, English name and
 * dial code for every country libphonenumber-js knows about.
 *
 * Nothing is hand-maintained. The codes come from libphonenumber's own metadata (so the
 * list can never disagree with the validator), the names from Intl.DisplayNames, and the
 * flag from the two letters themselves — a regional-indicator pair.
 */
import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min';

export interface Country {
  /** ISO 3166-1 alpha-2, e.g. "SA". */
  code: CountryCode;
  /** English name, e.g. "Saudi Arabia". */
  name: string;
  /** Dial code without the plus, e.g. "966". */
  dial: string;
  /** 🇸🇦 */
  flag: string;
}

/** "SA" → 🇸🇦. Regional indicators sit 0x1F1A5 above the ASCII letters. */
export const flagOf = (code: string) =>
  code.length === 2 && /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code].map((c) => c.charCodeAt(0) + 0x1f1a5))
    : '';

/** Saudi Arabia is pinned first; everything else is A–Z by name. */
export const DEFAULT_COUNTRY: CountryCode = 'SA';

const names = new Intl.DisplayNames(['en'], { type: 'region' });
const collator = new Intl.Collator('en', { sensitivity: 'base' });

const ALL: Country[] = getCountries().map((code) => ({
  code,
  name: names.of(code) ?? code,
  dial: getCountryCallingCode(code),
  flag: flagOf(code),
}));

export const COUNTRIES: Country[] = [
  ALL.find((c) => c.code === DEFAULT_COUNTRY)!,
  ...ALL.filter((c) => c.code !== DEFAULT_COUNTRY).sort((a, b) => collator.compare(a.name, b.name)),
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code as string, c]));

export const isCountryCode = (code: string): code is CountryCode => BY_CODE.has(code);
export const countryOf = (code?: string | null) => (code && BY_CODE.get(code)) || undefined;

/** "🇸🇦 Saudi Arabia +966" — what the selector shows and searches. */
export const countryLabel = (c: Country) => `${c.flag} ${c.name} +${c.dial}`;

/**
 * The phone country to suggest for a nationality. Nationality codes are ISO 3166-1
 * alpha-2 too, so most map straight across; the rest keep whatever is already selected.
 */
export const countryForNationality = (nationality?: string | null) =>
  nationality && isCountryCode(nationality) ? (nationality as CountryCode) : undefined;
