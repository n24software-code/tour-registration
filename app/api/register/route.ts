import { NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { normalize, validate } from '@/lib/validation';

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
  const errors = validate(input);
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });
  const { name, email, phone, tourId } = input;

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
      if ((tour.registeredCount ?? 0) >= tour.capacity)
        throw new HttpError(409, 'This tour is full. Choose another tour.', 'tourId');

      const existing = await tx.get(regs.where('email', '==', email).where('tourId', '==', tourId));
      if (existing.docs.some((d) => d.data().status !== 'cancelled'))
        throw new HttpError(409, 'This email is already registered for this tour. Check your inbox for your code, or choose another tour.', 'email');

      let code = newCode();
      for (let i = 0; (await tx.get(regs.doc(code))).exists; i++) {
        if (i > 10) throw new Error('Could not generate a unique code');
        code = newCode();
      }

      // --- writes ---
      tx.create(regs.doc(code), {
        name, email, phone, tourId,
        tourName: tour.name, slot: tour.slot,
        status: 'pending', busNumber: null, flag: null,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'visitor',
      });
      tx.update(tourRef, { registeredCount: FieldValue.increment(1) });

      if (process.env.ENABLE_CONFIRMATION_EMAIL === 'true') {
        const when = `${tour.departureTime}${tour.date ? ` on ${tour.date}` : ''}`;
        tx.set(db.collection('mail').doc(), {
          to: email,
          message: {
            subject: `Your tour code ${code} – ${tour.name}`,
            text:
              `Hi ${name.split(' ')[0]},\n\nYou're registered for ${tour.name}.\n\n` +
              `Your code: ${code}\nPickup point: ${tour.pickupPoint}\nBus leaves: ${when}\n\n` +
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
