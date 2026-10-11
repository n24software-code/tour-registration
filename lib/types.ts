export type Slot = 'morning' | 'evening';
export type Role = 'po' | 'pm' | 'registration' | 'crowd';
export type Status = 'pending' | 'confirmed' | 'checked_in' | 'boarded' | 'no_show' | 'cancelled';

export interface Tour {
  id: string;
  name: string;
  /**
   * Groups the batches of one destination. Every batch of SABIC shares "sabic", so the
   * public form can show the destination once and offer its departures underneath.
   * Tours that don't run in batches have no destinationId and `batch: null`.
   */
  destinationId?: string | null;
  /** 1, 2, … for a batched tour; null for a tour that runs once. */
  batch?: number | null;
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
  /** Free text, e.g. "15–20 minutes from entering the experience venue". */
  experienceDuration?: string;
  /** Conditions a visitor must read and accept before booking this tour. */
  notices?: string[];
}

/** Saudis give a National ID; everyone else gives a passport number. */
export type IdType = 'national_id' | 'passport';

export const ID_TYPE_LABEL: Record<IdType, string> = {
  national_id: 'National ID',
  passport: 'Passport',
};

/** Delivery state written back onto mail/{id} by the sendBookingConfirmation function. */
export type MailState = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR' | 'RETRY';

export interface Registration {
  id: string; // = confirmation code, e.g. "K7QM2P"
  name: string;
  /** Required — the booking confirmation is sent here. Stored lowercase. */
  email?: string | null;
  /** E.164, e.g. "+966501234567". Render it with formatPhone(). */
  phone: string;
  /** ISO 3166-1 alpha-2 of the dial code the visitor picked. */
  phoneCountry?: string;
  /** Which document the visitor gave. Derived on the server from `nationality`. */
  idType?: IdType;
  /** National ID digits or an uppercase passport number. Admin-only — never public. */
  idNumber?: string;
  /** ISO 3166-1 alpha-2 code; render it with nationalityLabel(). */
  nationality?: string;
  tourId: string;
  tourName: string;
  slot: Slot;
  /** "YYYY-MM-DD" — the day this visitor travels. */
  tourDate?: string;
  /** Copied from the tour at registration time, so a later edit doesn't rewrite history. */
  departureTime?: string;
  /** Which batch of the destination, copied at registration time. */
  batch?: number | null;
  status: Status;
  busNumber?: string | null;
  flag?: string | null; // message from Crowd team to Registration team
  createdAt?: { toDate(): Date } | null;
  updatedAt?: { toDate(): Date } | null;
  updatedBy?: string;
  checkedInAt?: { toDate(): Date } | null;
  boardedAt?: { toDate(): Date } | null;
  /** Set when the visitor accepted a tour's notices. */
  conditionsAcceptedAt?: { toDate(): Date } | null;
  /** The mail/{id} doc holding the booking confirmation, so delivery can be shown. */
  mailId?: string | null;
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
