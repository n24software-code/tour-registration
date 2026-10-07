import { NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { isRestricted, normalize, restrictionMessage, validate, type TourRules } from '@/lib/validation';

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
  const { name, email, phone, passportNumber, nationality, tourId, tourDate } = input;

  try {
    const db = adminDb();
    const code = await db.runTransaction(async (tx) => {
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
      };
      if (isRestricted(rules, nationality))
        throw new HttpError(409, restrictionMessage(rules), 'nationality');

      if (tour.date && tourDate !== tour.date)
        throw new HttpError(409, `This tour runs on ${tour.date}. Choose that date.`, 'tourDate');

      if ((tour.registeredCount ?? 0) >= tour.capacity)
        throw new HttpError(409, 'This tour is full. Choose another tour.', 'tourId');

      // One passport per tour per day — a cancelled registration frees it up again.
      const existing = await tx.get(
        regs.where('passportNumber', '==', passportNumber)
          .where('tourId', '==', tourId)
          .where('tourDate', '==', tourDate)
      );
      if (existing.docs.some((d) => d.data().status !== 'cancelled'))
        throw new HttpError(409, 'This passport is already registered for this tour on this date.', 'passportNumber');

      let code = newCode();
      for (let i = 0; (await tx.get(regs.doc(code))).exists; i++) {
        if (i > 10) throw new Error('Could not generate a unique code');
        code = newCode();
      }

      // --- writes ---
      tx.create(regs.doc(code), {
        name, email: email || null, phone, passportNumber, nationality,
        tourId, tourName: tour.name, slot: tour.slot,
        tourDate, departureTime: tour.departureTime,
        status: 'pending', busNumber: null, flag: null,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'visitor',
      });
      tx.update(tourRef, { registeredCount: FieldValue.increment(1) });

      // No email address, no email.
      if (email && process.env.ENABLE_CONFIRMATION_EMAIL === 'true') {
        tx.set(db.collection('mail').doc(), {
          to: email,
          message: {
            subject: `Your tour code ${code} – ${tour.name}`,
            text:
              `Hi ${name.split(' ')[0]},\n\nYou're registered for ${tour.name}.\n\n` +
              `Your code: ${code}\nPickup point: ${tour.pickupPoint}\n` +
              `Bus leaves: ${tour.departureTime} on ${tourDate}\n\n` +
              `Arrive 15 minutes before departure and show this code to our team.\n`,
          },
        });
      }
      return code;
    });

    return NextResponse.json({ code }, { status: 201 });
  } catch (e) {
    if (e instanceof HttpError) {
      const payload = e.field ? { message: e.message, errors: { [e.field]: e.message } } : { message: e.message };
      return NextResponse.json(payload, { status: e.status });
    }
    console.error('register failed', e);
    return NextResponse.json({ message: 'Registration could not be saved. Try again in a moment.' }, { status: 500 });
  }
}
