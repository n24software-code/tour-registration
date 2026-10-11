'use client';
import {
  addDoc, collection, deleteDoc, doc, getDoc, increment, runTransaction, serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { buildMailDoc } from './mail';
import { nationalityLabel } from './nationalities';
import { ID_TYPE_LABEL, type Admin, type Registration, type Role, type Status, type Tour } from './types';

/** Allowed moves in the pipeline. Cancelling has its own action (it releases the seat). */
const NEXT: Record<Status, Status[]> = {
  pending: ['confirmed'],
  confirmed: ['checked_in', 'no_show'],
  checked_in: ['boarded', 'confirmed'], // confirmed = Undo
  no_show: ['confirmed'],               // Undo
  boarded: [],
  cancelled: [],
};

async function log(admin: Admin, action: string, regId: string | null, detail?: string) {
  await addDoc(collection(db, 'auditLogs'), {
    action, regId, detail: detail ?? null,
    byUid: admin.uid, byEmail: admin.email, byRole: admin.role,
    at: serverTimestamp(),
  });
}

/** Moves a registration through the pipeline. Used by both teams. */
export async function setStatus(reg: Registration, status: Status, admin: Admin, busNumber?: string) {
  if (!NEXT[reg.status].includes(status))
    throw new Error(`Can't move a visitor from "${reg.status}" to "${status}". Refresh and try again.`);
  if (status === 'boarded' && !busNumber?.trim()) throw new Error('Enter the bus number first.');

  const patch: Record<string, unknown> = { status, updatedAt: serverTimestamp(), updatedBy: admin.email };
  if (status === 'checked_in') patch.checkedInAt = serverTimestamp();
  if (status === 'boarded') { patch.boardedAt = serverTimestamp(); patch.busNumber = busNumber!.trim(); }
  await updateDoc(doc(db, 'registrations', reg.id), patch);

  const undo = status === 'confirmed' && reg.status !== 'pending';
  await log(admin, undo ? `undo:${reg.status}` : `status:${status}`, reg.id,
    status === 'boarded' ? `bus ${busNumber!.trim()}` : undefined);
}

/** Cancels and gives the seat back to the tour, atomically. */
export async function cancelRegistration(reg: Registration, admin: Admin) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'registrations', reg.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('This registration no longer exists.');
    const status = snap.data().status as Status;
    if (status === 'cancelled') return;
    if (status === 'boarded') throw new Error('This visitor is already on the bus and can\'t be cancelled.');
    tx.update(ref, { status: 'cancelled', updatedAt: serverTimestamp(), updatedBy: admin.email });
    tx.update(doc(db, 'tours', snap.data().tourId), { registeredCount: increment(-1) });
  });
  await log(admin, 'status:cancelled', reg.id, `was ${reg.status}`);
}

/**
 * PO only (lib/roles.ts `deleteRegistrations`, and firestore.rules). Erases the record
 * for good and hands the seat back, unless the registration was already cancelled —
 * cancelling already returned it, so decrementing again would lose a seat.
 */
export async function deleteRegistration(reg: Registration, admin: Admin) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'registrations', reg.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('This registration no longer exists.');
    const data = snap.data();
    tx.delete(ref);
    if (data.status !== 'cancelled')
      tx.update(doc(db, 'tours', data.tourId), { registeredCount: increment(-1) });
  });
  const idLabel = reg.idType ? ID_TYPE_LABEL[reg.idType] : 'ID';
  await log(admin, 'registration:delete', reg.id,
    `${reg.name} · ${idLabel} ${reg.idNumber ?? '—'} · ${reg.tourName} · ${reg.tourDate || 'no date'}`);
}

/**
 * Queues a fresh booking confirmation for a registration whose first one never arrived.
 *
 * A new `mail/{id}` document is written rather than the old one being reset, so the
 * delivery history is not overwritten and the Cloud Function — which skips anything
 * already SUCCESS — has something new to pick up. The registration then points at the
 * new document, which is what the Sent / Pending / Error badge follows.
 */
export async function resendConfirmation(reg: Registration, admin: Admin) {
  if (!reg.email) throw new Error('This registration has no email address to send to.');

  const tourSnap = await getDoc(doc(db, 'tours', reg.tourId));
  const tour = tourSnap.data();

  const mailRef = await addDoc(collection(db, 'mail'), buildMailDoc({
    to: reg.email,
    code: reg.id,
    name: reg.name,
    tourName: reg.tourName,
    batch: reg.batch ?? tour?.batch ?? null,
    tourDate: reg.tourDate ?? '',
    departureTime: reg.departureTime ?? tour?.departureTime ?? '',
    pickupPoint: tour?.pickupPoint ?? '',
    experienceDuration: tour?.experienceDuration ?? null,
    notices: tour?.notices ?? null,
  }));

  await updateDoc(doc(db, 'registrations', reg.id), {
    mailId: mailRef.id, updatedAt: serverTimestamp(), updatedBy: admin.email,
  });
  await log(admin, 'registration:resend', reg.id, `${reg.email} · mail ${mailRef.id}`);
  return mailRef.id;
}

/**
 * Records that someone downloaded a participant list. Anyone with `manageRegistrations`
 * may export, so the trail is how we know who took which trip's data, and when.
 */
export async function logRegistrationsExport(admin: Admin, detail: string) {
  await log(admin, 'registrations:export', null, detail);
}

/** Crowd team → Registration team handoff note. Pass null to mark it resolved. */
export async function setFlag(reg: Registration, message: string | null, admin: Admin) {
  await updateDoc(doc(db, 'registrations', reg.id), {
    flag: message, updatedAt: serverTimestamp(), updatedBy: admin.email,
  });
  await log(admin, message ? 'flag:raised' : 'flag:resolved', reg.id, message ?? reg.flag ?? undefined);
}

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

/** Blank notice lines are dropped, so an empty editor row never becomes a bullet. */
const cleanTour = (t: TourFields): TourFields => ({
  ...t,
  name: t.name.trim(),
  destinationId: t.destinationId.trim(),
  pickupPoint: t.pickupPoint.trim(),
  experienceDuration: t.experienceDuration.trim(),
  notices: t.notices.map((n) => n.trim()).filter(Boolean),
});

const restrictionDetail = (codes: string[]) =>
  codes.length ? `blocks ${codes.map(nationalityLabel).join(', ')}` : 'no nationality restriction';

/** PO/PM: edit a tour. Capacity can't drop below the seats already taken. */
export async function saveTour(tourId: string, fields: TourFields, admin: Admin) {
  checkTour(fields);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'tours', tourId);
    const snap = await tx.get(ref);
    const taken = (snap.data()?.registeredCount as number) ?? 0;
    if (fields.capacity < taken)
      throw new Error(`Capacity can't be lower than the ${taken} people already registered.`);
    tx.update(ref, cleanTour(fields));
  });
  await log(admin, 'tour:update', null,
    `${tourId}: ${fields.name} · ${restrictionDetail(fields.restrictedNationalities)}`);
}

export async function addTour(fields: TourFields, order: number, admin: Admin) {
  checkTour(fields);
  const clean = cleanTour(fields);
  const ref = await addDoc(collection(db, 'tours'), {
    ...clean, registeredCount: 0, order,
  });
  // A standalone tour is its own destination; only batches share an explicit id.
  if (!clean.destinationId) await updateDoc(ref, { destinationId: ref.id });
  await log(admin, 'tour:add', null,
    `${ref.id}: ${fields.name}${fields.batch ? ` (batch ${fields.batch})` : ''}`);
}

/** PO only (enforced by rules). */
export async function setAdminRole(member: Admin, role: Role, admin: Admin) {
  if (member.uid === admin.uid) throw new Error('You can\'t change your own role.');
  await updateDoc(doc(db, 'admins', member.uid), { role });
  await log(admin, 'team:role', null, `${member.email}: ${member.role} → ${role}`);
}

export async function removeAdmin(member: Admin, admin: Admin) {
  if (member.uid === admin.uid) throw new Error('You can\'t remove your own access.');
  await deleteDoc(doc(db, 'admins', member.uid));
  await log(admin, 'team:remove', null, member.email);
}
