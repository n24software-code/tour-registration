import { NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
  CONDITIONS_ERROR, idTypeFor, isRestricted, needsConditions, normalize,
  restrictionMessage, validate, type TourRules,
} from '@/lib/validation';
import { parsePhone } from '@/lib/phone';
import { buildMailDoc } from '@/lib/mail';

export const dynamic = 'force-dynamic';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to read aloud
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

class HttpError extends Error {
  constructor(public status: number, message: string, public field?: string) { super(message); }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object')
    return NextResponse.json({ message: 'The form could not be read. Reload the page and try again.' }, { status: 400 });

  const input = normalize(body);
  // Everything that doesn't need the tour: required fields, formats, dates in the past.
  const errors = validate(input);
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });
  const { name, email, nationality, tourId, tourDate, acceptedConditions } = input;

  // The server decides which document was asked for; whatever the client claimed is
  // ignored, so a passport can never be filed as a National ID or the other way round.
  const idType = idTypeFor(nationality);
  const idNumber = input.idNumber;

  // validate() already proved this parses, so the non-null assertion is safe.
  const phone = parsePhone(input.phone, input.phoneCountry)!;

  try {
    const db = adminDb();
    const result = await db.runTransaction(async (tx) => {
      const tourRef = db.collection('tours').doc(tourId);
      const regs = db.collection('registrations');

      // --- reads (all reads must happen before writes) ---
      const tourSnap = await tx.get(tourRef);
      const tour = tourSnap.data();
      if (!tour) throw new HttpError(404, 'This tour no longer exists. Choose another tour.', 'tourId');
      if (!tour.active) throw new HttpError(409, 'Registration for this tour is closed. Choose another tour.', 'tourId');

      // The nationality restriction is enforced here, not only in the browser.
      const rules: TourRules = {
        name: tour.name,
        date: tour.date,
        restrictedNationalities: tour.restrictedNationalities ?? [],
        notices: tour.notices ?? [],
      };
      if (isRestricted(rules, nationality))
        throw new HttpError(409, restrictionMessage(rules), 'nationality');

      // A tour with conditions cannot be booked without accepting them.
      if (needsConditions(rules) && !acceptedConditions)
        throw new HttpError(400, CONDITIONS_ERROR, 'acceptedConditions');

      if (tour.date && tourDate !== tour.date)
        throw new HttpError(409, `This tour runs on ${tour.date}. Choose that date.`, 'tourDate');

      if ((tour.registeredCount ?? 0) >= tour.capacity)
        throw new HttpError(409, 'This tour is full. Choose another tour.', 'tourId');

      // One identity document per tour per day — a cancelled registration frees it up.
      const existing = await tx.get(
        regs.where('idType', '==', idType)
          .where('idNumber', '==', idNumber)
          .where('tourId', '==', tourId)
          .where('tourDate', '==', tourDate)
      );
      if (existing.docs.some((d) => d.data().status !== 'cancelled')) {
        const what = idType === 'national_id' ? 'National ID' : 'passport';
        throw new HttpError(409, `This ${what} is already registered for this tour on this date.`, 'idNumber');
      }

      let code = newCode();
      for (let i = 0; (await tx.get(regs.doc(code))).exists; i++) {
        if (i > 10) throw new Error('Could not generate a unique code');
        code = newCode();
      }

      // --- writes ---
      // The confirmation is written in the same transaction, so a registration can
      // never exist without its email queued, nor an email without its registration.
      const mailRef = db.collection('mail').doc();
      tx.create(regs.doc(code), {
        name, email, phone: phone.e164, phoneCountry: phone.country,
        idType, idNumber, nationality,
        tourId, tourName: tour.name, slot: tour.slot,
        tourDate, departureTime: tour.departureTime, batch: tour.batch ?? null,
        status: 'pending', busNumber: null, flag: null,
        conditionsAcceptedAt: needsConditions(rules) ? FieldValue.serverTimestamp() : null,
        mailId: mailRef.id,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'visitor',
      });
      tx.update(tourRef, { registeredCount: FieldValue.increment(1) });

      tx.set(mailRef, buildMailDoc({
        to: email,
        code,
        name,
        tourName: tour.name,
        batch: tour.batch ?? null,
        tourDate,
        departureTime: tour.departureTime,
        pickupPoint: tour.pickupPoint,
        experienceDuration: tour.experienceDuration ?? null,
        notices: tour.notices ?? null,
      }));

      return code;
    });

    return NextResponse.json({ code: result }, { status: 201 });
  } catch (e) {
    if (e instanceof HttpError) {
      const payload = e.field ? { message: e.message, errors: { [e.field]: e.message } } : { message: e.message };
      return NextResponse.json(payload, { status: e.status });
    }
    console.error('register failed', e);
    return NextResponse.json({ message: 'Registration could not be saved. Try again in a moment.' }, { status: 500 });
  }
}
