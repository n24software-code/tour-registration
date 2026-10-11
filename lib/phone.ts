/**
 * Phone parsing shared by the form and /api/register, on libphonenumber-js's `min`
 * metadata — enough to know whether a number is a valid, dialable mobile/fixed line for
 * a given country, without shipping the full 150 kB dataset.
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import { isCountryCode } from './countries';

export const PHONE_ERROR = 'Enter a valid mobile number for the selected country.';

export interface ParsedPhone {
  /** "+966501234567" — what gets stored. */
  e164: string;
  /** "+966 50 123 4567" — what people read. */
  international: string;
  /** "501234567" — the number without the country code, for searching. */
  national: string;
  country: CountryCode;
}

/**
 * Validates a national number against its country. Returns undefined when the number is
 * not a valid number for that country, which is what both sides treat as an error.
 */
export function parsePhone(national: string, country: string): ParsedPhone | undefined {
  if (!isCountryCode(country)) return undefined;
  const raw = String(national ?? '').trim();
  if (!raw) return undefined;
  const parsed = parsePhoneNumberFromString(raw, country as CountryCode);
  if (!parsed?.isValid()) return undefined;
  // A number typed with another country's prefix must not silently pass as this country.
  if (parsed.country !== country) return undefined;
  return {
    e164: parsed.number,
    international: parsed.formatInternational(),
    national: parsed.nationalNumber,
    country: country as CountryCode,
  };
}

/** Formats a stored E.164 number for reading. Falls back to the raw value. */
export function formatPhone(e164?: string | null) {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(String(e164));
  return parsed?.isValid() ? parsed.formatInternational() : String(e164);
}

/** The national part of a stored number, so Crowd can search without the country code. */
export function nationalDigits(e164?: string | null) {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(String(e164));
  return parsed?.nationalNumber ?? String(e164).replace(/\D/g, '');
}
