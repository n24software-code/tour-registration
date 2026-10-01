// Shared by the public form (client) and /api/register (server).

export interface RegistrationInput { name: string; email: string; phone: string; tourId: string }

export function normalize(input: Partial<Record<keyof RegistrationInput, unknown>>): RegistrationInput {
  return {
    name: String(input.name ?? '').trim().replace(/\s+/g, ' '),
    email: String(input.email ?? '').trim().toLowerCase(),
    // Keep a leading + and digits only: "+966 50-123 4567" → "+966501234567"
    phone: String(input.phone ?? '').trim().replace(/(?!^\+)[^\d]/g, ''),
    tourId: String(input.tourId ?? '').trim(),
  };
}

/** Returns field → message for every invalid field (empty object when valid). */
export function validate(v: RegistrationInput): Partial<Record<keyof RegistrationInput, string>> {
  const errors: Partial<Record<keyof RegistrationInput, string>> = {};
  if (v.name.length < 2) errors.name = 'Enter your full name (at least 2 characters).';
  else if (v.name.length > 100) errors.name = 'Name is too long. Use 100 characters or fewer.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email) || v.email.length > 254)
    errors.email = 'Enter a valid email address, like name@example.com.';
  // Saudi (+9665…, 05…) and international numbers: 8–15 digits, optional leading +.
  if (!/^\+?\d{8,15}$/.test(v.phone))
    errors.phone = 'Enter a phone number with 8–15 digits, like 05X XXX XXXX or +966 5X XXX XXXX.';
  if (!v.tourId) errors.tourId = 'Choose a tour above.';
  return errors;
}
