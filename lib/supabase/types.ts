/**
 * The database as PostgREST sees it (snake_case), plus the mappers to and from the
 * camelCase shapes in lib/types.ts that the whole app already speaks. Keeping the
 * translation in one place is what let the UI stay untouched by the migration.
 */
import type { Admin, IdType, Registration, Role, Slot, Status, Tour } from '../types';

export type TourRow = {
  id: string;
  destination_id: string;
  batch: number | null;
  name: string;
  slot: Slot;
  pickup_point: string;
  departure_time: string;        // "08:00:00"
  tour_date: string | null;      // "2026-10-15"
  capacity: number;
  registered_count: number;
  active: boolean;
  sort_order: number;
  restricted_nationalities: string[];
  experience_duration: string | null;
  notices: string[];
}

export type RegistrationRow = {
  code: string;
  name: string;
  email: string;
  phone: string;
  phone_country: string;
  id_type: IdType;
  id_number: string;
  nationality: string;
  tour_id: string;
  tour_name: string;
  slot: Slot;
  departure_time: string | null;
  batch: number | null;
  tour_date: string;
  status: Status;
  bus_number: string | null;
  flag: string | null;
  accepted_conditions: boolean;
  conditions_accepted_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  checked_in_at: string | null;
  boarded_at: string | null;
}

export type AdminRow = {
  user_id: string;
  email: string;
  name: string;
  role: Role;
}

export type OutboxRow = {
  id: string;
  reg_code: string | null;
  to_email: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  status: 'pending' | 'sent' | 'error';
  attempts: number;
  error: string | null;
  message_id: string | null;
  created_at: string;
  sent_at: string | null;
}

export type AuditRow = {
  id: number;
  action: string;
  reg_code: string | null;
  detail: string | null;
  by_uid: string | null;
  by_email: string | null;
  by_role: string | null;
  at: string;
}

/** The newest outbox row per registration — what the delivery badge reads. */
export type MailStatusRow = {
  reg_code: string;
  outbox_id: string;
  status: 'pending' | 'sent' | 'error';
  attempts: number;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

/**
 * Minimal typing for the supabase-js generic; the app uses the mappers below.
 *
 * Every section must list its members explicitly. An index signature such as
 * `Record<string, never>` makes *every* name resolve in that section, and the client's
 * table lookup then collapses to `never` for perfectly valid tables.
 */
type Empty = { [_ in never]: never };

export interface Database {
  public: {
    Tables: {
      tours: { Row: TourRow; Insert: Partial<TourRow>; Update: Partial<TourRow>; Relationships: [] };
      registrations: { Row: RegistrationRow; Insert: Partial<RegistrationRow>; Update: Partial<RegistrationRow>; Relationships: [] };
      admins: { Row: AdminRow; Insert: Partial<AdminRow>; Update: Partial<AdminRow>; Relationships: [] };
      email_outbox: { Row: OutboxRow; Insert: Partial<OutboxRow>; Update: Partial<OutboxRow>; Relationships: [] };
      audit_logs: { Row: AuditRow; Insert: Partial<AuditRow>; Update: Partial<AuditRow>; Relationships: [] };
    };
    Views: {
      registration_mail_status: { Row: MailStatusRow; Relationships: [] };
    };
    Functions: Empty;
    Enums: Empty;
    CompositeTypes: Empty;
  };
}

// ---------------------------------------------------------------- mappers

/** Postgres `time` comes back as "08:00:00"; the app has always used "08:00". */
export const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '');

export const toTour = (r: TourRow): Tour => ({
  id: r.id,
  destinationId: r.destination_id,
  batch: r.batch,
  name: r.name,
  slot: r.slot,
  pickupPoint: r.pickup_point,
  departureTime: hhmm(r.departure_time),
  date: r.tour_date ?? '',
  capacity: r.capacity,
  registeredCount: r.registered_count,
  active: r.active,
  order: r.sort_order,
  restrictedNationalities: r.restricted_nationalities ?? [],
  experienceDuration: r.experience_duration ?? '',
  notices: r.notices ?? [],
});

/** The app's timestamp fields expose `.toDate()`, which the UI already calls. */
const stamp = (iso: string | null) => (iso ? { toDate: () => new Date(iso) } : null);

export const toRegistration = (r: RegistrationRow): Registration => ({
  id: r.code,
  name: r.name,
  email: r.email,
  phone: r.phone,
  phoneCountry: r.phone_country,
  idType: r.id_type,
  idNumber: r.id_number,
  nationality: r.nationality,
  tourId: r.tour_id,
  tourName: r.tour_name,
  slot: r.slot,
  tourDate: r.tour_date ?? '',
  departureTime: hhmm(r.departure_time),
  batch: r.batch,
  status: r.status,
  busNumber: r.bus_number,
  flag: r.flag,
  createdAt: stamp(r.created_at),
  updatedAt: stamp(r.updated_at),
  updatedBy: r.updated_by ?? undefined,
  checkedInAt: stamp(r.checked_in_at),
  boardedAt: stamp(r.boarded_at),
  conditionsAcceptedAt: stamp(r.conditions_accepted_at),
  mailId: null,
});

export const toAdmin = (r: AdminRow): Admin => ({
  uid: r.user_id,
  email: r.email,
  name: r.name,
  role: r.role,
});
