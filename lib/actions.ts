'use client';
/**
 * Every admin action. These call the security-definer RPCs rather than writing tables
 * directly — row level security gives the browser no write access at all, so the role
 * check and the audit entry happen in one place that can't be bypassed.
 */
import type { PostgrestError } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase/client';
import { nationalityLabel } from './nationalities';
import type { Admin, Registration, Role, Status, Tour } from './types';

/**
 * Turns a Postgres error into the plain words the app has always shown.
 *
 * 42501 is the insufficient-privilege code `require_role` raises; P0001/P0002 carry a
 * message written for the reader, so those pass straight through.
 */
function friendly(error: PostgrestError | null, fallback: string): Error | null {
  if (!error) return null;
  if (error.code === '42501' || /forbidden/i.test(error.message)) {
    return new Error('Your role is not allowed to make that change.');
  }
  if (error.code === 'P0001' || error.code === 'P0002') return new Error(error.message);
  if (error.code === '23505') {
    return new Error('That visitor is already registered for this tour on this date.');
  }
  if (error.code === '23514') {
    return new Error('That change would break a limit on the tour. Refresh and try again.');
  }
  console.error(error);
  return new Error(error.message || fallback);
}

async function rpc(fn: string, args: Record<string, unknown>, fallback: string) {
  const { data, error } = await supabaseBrowser().rpc(fn as never, args as never);
  const err = friendly(error, fallback);
  if (err) throw err;
  return data;
}

/** Moves a registration through the pipeline. Used by both teams. */
export async function setStatus(reg: Registration, status: Status, _admin: Admin, busNumber?: string) {
  await rpc('set_status',
    { p_code: reg.id, p_status: status, p_bus_number: busNumber ?? null },
    'That change could not be saved. Try again.');
}

/** Registration desk: hands the visitor over to the Crowd team. */
export async function confirmRegistration(reg: Registration, _admin: Admin) {
  await rpc('confirm_registration', { p_code: reg.id }, 'The visitor could not be confirmed.');
}

/** Cancels and gives the seat back to the tour, atomically. */
export async function cancelRegistration(reg: Registration, _admin: Admin) {
  await rpc('cancel_registration', { p_code: reg.id }, 'The registration could not be cancelled.');
}

/** PO only. Erases the record and hands the seat back unless it was already cancelled. */
export async function deleteRegistration(reg: Registration, _admin: Admin) {
  await rpc('delete_registration', { p_code: reg.id }, 'The registration could not be deleted.');
}

/** Crowd team → Registration team handoff note. Pass null to mark it resolved. */
export async function setFlag(reg: Registration, message: string | null, _admin: Admin) {
  await rpc('set_flag', { p_code: reg.id, p_message: message }, 'The flag could not be saved.');
}

/**
 * Queues a fresh booking confirmation, then asks the server to send it. A new outbox
 * row supersedes the previous attempt, so the delivery history stays intact.
 */
export async function resendConfirmation(reg: Registration, _admin: Admin) {
  const res = await fetch('/api/resend-confirmation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: reg.id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? 'The confirmation could not be re-sent.');
  return data.outboxId as string;
}

/** Records that someone downloaded a participant list. */
export async function logRegistrationsExport(_admin: Admin, detail: string) {
  await rpc('log_export', { p_detail: detail }, 'The export could not be recorded.');
}

// ---------------------------------------------------------------- tours

export type TourFields =
  Pick<Tour, 'name' | 'slot' | 'pickupPoint' | 'departureTime' | 'date' | 'capacity' | 'active'>
  & {
    restrictedNationalities: string[]; experienceDuration: string; notices: string[];
    /** Groups the batches of one destination; defaults to the tour's own id. */
    destinationId: string;
    /** 1, 2, … for a batched tour; null when it runs once. */
    batch: number | null;
  };

function checkTour(t: TourFields) {
  if (t.name.trim().length < 2) throw new Error('Enter a tour name.');
  if (!t.pickupPoint.trim()) throw new Error('Enter a pickup point.');
  if (!/^\d{2}:\d{2}$/.test(t.departureTime)) throw new Error('Enter a departure time, like 08:00.');
  if (!Number.isInteger(t.capacity) || t.capacity < 1) throw new Error('Capacity must be a whole number of at least 1.');
  if (t.batch !== null && (!Number.isInteger(t.batch) || t.batch < 1))
    throw new Error('Batch must be a whole number of at least 1, or blank.');
}

/** The snake_case payload the save_tour / add_tour RPCs take. */
const tourPayload = (t: TourFields) => ({
  name: t.name.trim(),
  destinationId: t.destinationId.trim(),
  batch: t.batch === null ? '' : String(t.batch),
  slot: t.slot,
  pickupPoint: t.pickupPoint.trim(),
  departureTime: t.departureTime,
  tourDate: t.date ?? '',
  capacity: t.capacity,
  active: t.active,
  restrictedNationalities: t.restrictedNationalities,
  experienceDuration: t.experienceDuration.trim(),
  notices: t.notices.map((n) => n.trim()).filter(Boolean),
});

/** PO/PM: edit a tour. Capacity can't drop below the seats already taken. */
export async function saveTour(tourId: string, fields: TourFields, _admin: Admin) {
  checkTour(fields);
  await rpc('save_tour', { p_id: tourId, p_fields: tourPayload(fields) },
    'The tour could not be saved.');
}

export async function addTour(fields: TourFields, order: number, _admin: Admin) {
  checkTour(fields);
  await rpc('add_tour', { p_fields: tourPayload(fields), p_sort_order: order },
    'The tour could not be added.');
}

// ---------------------------------------------------------------- team

export async function setAdminRole(member: Admin, role: Role, admin: Admin) {
  if (member.uid === admin.uid) throw new Error('You can\'t change your own role.');
  await rpc('set_admin_role', { p_user_id: member.uid, p_role: role },
    'The role could not be changed.');
}

export async function removeAdmin(member: Admin, admin: Admin) {
  if (member.uid === admin.uid) throw new Error('You can\'t remove your own access.');
  await rpc('remove_admin', { p_user_id: member.uid }, 'Their access could not be removed.');
}

/** Kept for the audit-detail wording used by the Tours page. */
export const restrictionDetail = (codes: string[]) =>
  codes.length ? `blocks ${codes.map(nationalityLabel).join(', ')}` : 'no nationality restriction';
