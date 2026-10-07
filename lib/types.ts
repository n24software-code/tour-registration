export type Slot = 'morning' | 'evening';
export type Role = 'po' | 'pm' | 'registration' | 'crowd';
export type Status = 'pending' | 'confirmed' | 'checked_in' | 'boarded' | 'no_show' | 'cancelled';

export interface Tour {
  id: string;
  name: string;
  slot: Slot;
  pickupPoint: string;
  departureTime: string; // "08:00"
  date?: string;         // "2026-10-15" — when set, visitors can only pick this date
  capacity: number;
  registeredCount: number;
  active: boolean;
  order: number;
  /** ISO 3166-1 alpha-2 nationality codes that may NOT join this tour. */
  restrictedNationalities?: string[];
}

export interface Registration {
  id: string; // = confirmation code, e.g. "K7QM2P"
  name: string;
  /** Optional — visitors may register without one, and then get no confirmation email. */
  email?: string | null;
  phone: string;
  /** Uppercase letters and digits, 5–20 chars. Never shown on a public page. */
  passportNumber?: string;
  /** ISO 3166-1 alpha-2 code; render it with nationalityLabel(). */
  nationality?: string;
  tourId: string;
  tourName: string;
  slot: Slot;
  /** "YYYY-MM-DD" — the day this visitor travels. */
  tourDate?: string;
  /** Copied from the tour at registration time, so a later edit doesn't rewrite history. */
  departureTime?: string;
  status: Status;
  busNumber?: string | null;
  flag?: string | null; // message from Crowd team to Registration team
  createdAt?: { toDate(): Date } | null;
  updatedAt?: { toDate(): Date } | null;
  updatedBy?: string;
  checkedInAt?: { toDate(): Date } | null;
  boardedAt?: { toDate(): Date } | null;
}

export interface Admin {
  uid: string;
  email: string;
  name: string;
  role: Role;
}

export const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending review',
  confirmed: 'Confirmed',
  checked_in: 'At pickup',
  boarded: 'On the bus',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

export const SLOT_LABEL: Record<Slot, string> = { morning: 'Morning tours', evening: 'Evening tours' };
export const SLOT_NAME: Record<Slot, string> = { morning: 'Morning', evening: 'Evening' };
