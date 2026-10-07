// Shared by the public form (client) and /api/register (server).
import { isNationalityCode, nationalityList } from './nationalities';

export interface RegistrationInput {
  name: string;
  /** Optional. Validated only when the visitor fills it in. */
  email: string;
  phone: string;
  passportNumber: string;
  /** ISO 3166-1 alpha-2 code. */
  nationality: string;
  tourId: string;
  /** "YYYY-MM-DD" */
  tourDate: string;
}

export type Field = keyof RegistrationInput;
export type FieldErrors = Partial<Record<Field, string>>;

/** The order the form shows the fields in — used to focus the first thing that's wrong. */
export const FIELD_ORDER: Field[] = [
  'name', 'phone', 'passportNumber', 'nationality', 'tourId', 'tourDate', 'email',
];

/** Only the parts of a tour the shared rules need, so this file stays free of Firestore. */
export interface TourRules {
  name?: string;
  date?: string;
  restrictedNationalities?: string[] | null;
}

export const PASSPORT_ERROR =
  'Enter your passport number as shown in your passport (letters and numbers only).';

/** Today in Riyadh, so the client and the server agree on what "past" means. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** "SABIC - Home of Innovation" → "SABIC", so the restriction message reads naturally. */
export const shortTourName = (name: string) => name.split(/\s+[-–—]\s+/)[0].trim() || name;

export function restrictionMessage(tour: TourRules) {
  const codes = tour.restrictedNationalities ?? [];
  return `Visitors with ${nationalityList(codes)} nationality can't join the ` +
    `${shortTourName(tour.name ?? 'this')} tour. Please choose another tour.`;
}

export const isRestricted = (tour: TourRules | undefined, nationality: string) =>
  !!nationality && !!tour?.restrictedNationalities?.includes(nationality);

export function normalize(input: Partial<Record<Field, unknown>>): RegistrationInput {
  return {
    name: String(input.name ?? '').trim().replace(/\s+/g, ' '),
    email: String(input.email ?? '').trim().toLowerCase(),
    // Keep a leading + and digits only: "+966 50-123 4567" → "+966501234567"
    phone: String(input.phone ?? '').trim().replace(/(?!^\+)[^\d]/g, ''),
    // Passports are often written with spaces; strip them so duplicates match reliably.
    passportNumber: String(input.passportNumber ?? '').trim().toUpperCase().replace(/\s+/g, ''),
    nationality: String(input.nationality ?? '').trim().toUpperCase(),
    tourId: String(input.tourId ?? '').trim(),
    tourDate: String(input.tourDate ?? '').trim(),
  };
}

/**
 * Returns field → message for every invalid field (empty object when valid).
 * Pass the chosen tour to also check its fixed date and nationality restriction —
 * the server always does, and the client does too once the tours have loaded.
 */
export function validate(v: RegistrationInput, tour?: TourRules): FieldErrors {
  const errors: FieldErrors = {};

  if (v.name.length < 2) errors.name = 'Enter your full name (at least 2 characters).';
  else if (v.name.length > 100) errors.name = 'Name is too long. Use 100 characters or fewer.';

  // Saudi (+9665…, 05…) and international numbers: 8–15 digits, optional leading +.
  if (!/^\+?\d{8,15}$/.test(v.phone))
    errors.phone = 'Enter a phone number with 8–15 digits, like 05X XXX XXXX or +966 5X XXX XXXX.';

  if (!/^[A-Z0-9]{5,20}$/.test(v.passportNumber)) errors.passportNumber = PASSPORT_ERROR;

  if (!v.nationality) errors.nationality = 'Choose your nationality.';
  else if (!isNationalityCode(v.nationality)) errors.nationality = 'Choose a nationality from the list.';
  else if (isRestricted(tour, v.nationality)) errors.nationality = restrictionMessage(tour!);

  if (!v.tourId) errors.tourId = 'Choose a tour above.';

  if (!v.tourDate) errors.tourDate = 'Choose the date of your tour.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.tourDate) || Number.isNaN(Date.parse(`${v.tourDate}T00:00:00Z`)))
    errors.tourDate = 'Enter the date as YYYY-MM-DD.';
  else if (v.tourDate < todayISO()) errors.tourDate = 'That date has passed. Choose today or a later date.';
  else if (tour?.date && v.tourDate !== tour.date)
    errors.tourDate = `This tour runs on ${tour.date}. Choose that date.`;

  // Email is optional; only checked when there is something to check.
  if (v.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email) || v.email.length > 254))
    errors.email = 'Enter a valid email address, like name@example.com.';

  return errors;
}
