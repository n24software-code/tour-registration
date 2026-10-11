// Shared by the public form (client) and /api/register (server).
import { isNationalityCode, nationalityList } from './nationalities';
import { DEFAULT_COUNTRY, isCountryCode } from './countries';
import { PHONE_ERROR, parsePhone } from './phone';
import { NATIONAL_ID_ERROR, isValidNationalId } from './saudi-id';
import type { IdType } from './types';

export interface RegistrationInput {
  name: string;
  /** Required — the booking confirmation goes here. */
  email: string;
  /** The national part only; the country code lives in `phoneCountry`. */
  phone: string;
  /** ISO 3166-1 alpha-2 of the chosen dial code. */
  phoneCountry: string;
  /** National ID digits for Saudis, passport number for everyone else. */
  idNumber: string;
  /** ISO 3166-1 alpha-2 code. */
  nationality: string;
  tourId: string;
  /** "YYYY-MM-DD" */
  tourDate: string;
  /** Ticked when the chosen tour carries notices. */
  acceptedConditions: boolean;
}

export type Field = keyof RegistrationInput;
export type FieldErrors = Partial<Record<Field, string>>;

/** The order the form shows the fields in — used to focus the first thing that's wrong. */
export const FIELD_ORDER: Field[] = [
  'name', 'phoneCountry', 'phone', 'nationality', 'idNumber',
  'tourId', 'tourDate', 'email', 'acceptedConditions',
];

/** Only the parts of a tour the shared rules need, so this file stays free of Firestore. */
export interface TourRules {
  name?: string;
  date?: string;
  restrictedNationalities?: string[] | null;
  notices?: string[] | null;
}

export const PASSPORT_ERROR =
  'Enter your passport number as shown in your passport (letters and numbers only).';
export const EMAIL_ERROR =
  "Enter your email address – we'll send your booking confirmation there.";
export const CONDITIONS_ERROR =
  'Confirm you have read the conditions for this tour.';

// ---------------------------------------------------------------- identity

/**
 * Saudis give a National ID, everyone else a passport. The server always re-derives
 * this from the nationality and ignores whatever the client claims, so the two can
 * never disagree.
 */
export const idTypeFor = (nationality: string): IdType =>
  nationality === 'SA' ? 'national_id' : 'passport';

export const ID_LABEL: Record<IdType, string> = {
  national_id: 'National ID number',
  passport: 'Passport number',
};

export const ID_ERROR: Record<IdType, string> = {
  national_id: NATIONAL_ID_ERROR,
  passport: PASSPORT_ERROR,
};

export const ID_HINT: Record<IdType, string> = {
  national_id: '10 digits, starting with 1.',
  passport: 'Letters and numbers only, 5–20 characters.',
};

export function isValidId(idType: IdType, value: string) {
  return idType === 'national_id' ? isValidNationalId(value) : /^[A-Z0-9]{5,20}$/.test(value);
}

/** Normalising differs by type: digits only for an ID, uppercase for a passport. */
export const normalizeId = (idType: IdType, raw: unknown) =>
  idType === 'national_id'
    ? String(raw ?? '').replace(/\D/g, '')
    : String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');

/** Admin lists show the last four characters only until someone needs the full value. */
export const maskId = (value?: string | null) => {
  const v = String(value ?? '').trim();
  if (!v) return '—';
  return v.length <= 4 ? v : `${'•'.repeat(Math.min(6, v.length - 4))}${v.slice(-4)}`;
};

// ---------------------------------------------------------------- tour rules

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

/** A tour only asks for consent when it actually carries notices. */
export const needsConditions = (tour?: TourRules | null) => !!tour?.notices?.length;

// ---------------------------------------------------------------- normalise

export function normalize(input: Partial<Record<Field, unknown>>): RegistrationInput {
  const nationality = String(input.nationality ?? '').trim().toUpperCase();
  const rawCountry = String(input.phoneCountry ?? '').trim().toUpperCase();
  return {
    name: String(input.name ?? '').trim().replace(/\s+/g, ' '),
    email: String(input.email ?? '').trim().toLowerCase(),
    // The national part only — separators and any typed country code are handled by
    // libphonenumber when the two halves are put back together.
    phone: String(input.phone ?? '').trim(),
    phoneCountry: isCountryCode(rawCountry) ? rawCountry : DEFAULT_COUNTRY,
    idNumber: normalizeId(idTypeFor(nationality), input.idNumber),
    nationality,
    tourId: String(input.tourId ?? '').trim(),
    tourDate: String(input.tourDate ?? '').trim(),
    acceptedConditions: input.acceptedConditions === true || input.acceptedConditions === 'true',
  };
}

// ---------------------------------------------------------------- validate

/**
 * Returns field → message for every invalid field (empty object when valid).
 * Pass the chosen tour to also check its fixed date, nationality restriction and
 * notices — the server always does, and the client does once the tours have loaded.
 */
export function validate(v: RegistrationInput, tour?: TourRules): FieldErrors {
  const errors: FieldErrors = {};

  if (v.name.length < 2) errors.name = 'Enter your full name (at least 2 characters).';
  else if (v.name.length > 100) errors.name = 'Name is too long. Use 100 characters or fewer.';

  if (!parsePhone(v.phone, v.phoneCountry)) errors.phone = PHONE_ERROR;

  if (!v.nationality) errors.nationality = 'Choose your nationality.';
  else if (!isNationalityCode(v.nationality)) errors.nationality = 'Choose a nationality from the list.';
  else if (isRestricted(tour, v.nationality)) errors.nationality = restrictionMessage(tour!);

  // The ID rules depend on the nationality, so they are only meaningful once it is set.
  if (v.nationality) {
    const idType = idTypeFor(v.nationality);
    if (!isValidId(idType, v.idNumber)) errors.idNumber = ID_ERROR[idType];
  } else {
    errors.idNumber = 'Choose your nationality first.';
  }

  if (!v.tourId) errors.tourId = 'Choose a tour above.';

  if (!v.tourDate) errors.tourDate = 'Choose the date of your tour.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.tourDate) || Number.isNaN(Date.parse(`${v.tourDate}T00:00:00Z`)))
    errors.tourDate = 'Enter the date as YYYY-MM-DD.';
  else if (v.tourDate < todayISO()) errors.tourDate = 'That date has passed. Choose today or a later date.';
  else if (tour?.date && v.tourDate !== tour.date)
    errors.tourDate = `This tour runs on ${tour.date}. Choose that date.`;

  if (!v.email) errors.email = EMAIL_ERROR;
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email) || v.email.length > 254)
    errors.email = 'Enter a valid email address, like name@example.com.';

  if (needsConditions(tour) && !v.acceptedConditions) errors.acceptedConditions = CONDITIONS_ERROR;

  return errors;
}
