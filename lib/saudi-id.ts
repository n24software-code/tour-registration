/**
 * Saudi National ID (رقم الهوية الوطنية): ten digits, the first of which is 1 for a
 * citizen. The tenth is a check digit over the first nine, computed the same way as
 * Luhn but doubling from the left (positions 1, 3, 5, 7, 9).
 *
 * Iqama numbers start with 2 and use the same check digit, but this field is the
 * National ID, so only a leading 1 is accepted.
 */
export const NATIONAL_ID_ERROR = 'Enter your 10-digit National ID number (it starts with 1).';

/** The check digit for the first nine digits of an ID. */
export function nationalIdCheckDigit(firstNine: string): number {
  let total = 0;
  for (let i = 0; i < 9; i++) {
    const digit = Number(firstNine[i]);
    if (i % 2 === 0) {
      const doubled = digit * 2;
      total += doubled > 9 ? doubled - 9 : doubled;
    } else {
      total += digit;
    }
  }
  return (10 - (total % 10)) % 10;
}

export function isValidNationalId(value: string): boolean {
  const id = String(value ?? '').trim();
  if (!/^1\d{9}$/.test(id)) return false;
  return nationalIdCheckDigit(id.slice(0, 9)) === Number(id[9]);
}

/** Completes a nine-digit stem into a valid ID — used by the seed data and the tests. */
export const completeNationalId = (firstNine: string) =>
  `${firstNine}${nationalIdCheckDigit(firstNine)}`;
