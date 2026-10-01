export type Slot = 'morning' | 'evening';
export type Role = 'po' | 'pm' | 'registration' | 'crowd';
export type Status = 'pending' | 'confirmed' | 'checked_in' | 'boarded' | 'no_show' | 'cancelled';

export interface Tour {
  id: string;
  name: string;
  slot: Slot;
  pickupPoint: string;
  departureTime: string; // "08:00"
  date?: string;         // "2026-10-15", optional
  capacity: number;
  registeredCount: number;
  active: boolean;
  order: number;
}

export interface Registration {
  id: string; // = confirmation code, e.g. "K7QM2P"
  name: string;
  email: string;
  phone: string;
  tourId: string;
  tourName: string;
  slot: Slot;
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
