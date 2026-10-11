import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { adminDb } from '@/lib/firebase-admin';
import { SlotMark, formatDate } from '@/components/ui';
import { LogoBand } from '@/components/Logos';
import { TourNotices } from '@/components/TourNotices';
import type { Slot } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'You’re registered', robots: { index: false } };

export default async function RegisteredPage({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) notFound();

  const db = adminDb();
  const snap = await db.collection('registrations').doc(code).get();
  if (!snap.exists) notFound();
  const reg = snap.data()!;
  const tour = (await db.collection('tours').doc(reg.tourId).get()).data();
  const firstName = String(reg.name).split(' ')[0]; // public URL: show the first name only
  const slot = reg.slot as Slot;
  // This page is reachable by anyone with the code, so it never shows the ID number.
  const date: string = reg.tourDate || tour?.date || '';
  const departureTime: string = reg.departureTime || tour?.departureTime || '';
  const batch: number | null = reg.batch ?? tour?.batch ?? null;
  const trip = {
    experienceDuration: tour?.experienceDuration as string | undefined,
    notices: tour?.notices as string[] | undefined,
  };

  return (
    <>
      <LogoBand />
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-5 sm:py-16">
        <p className="flex items-center gap-2 text-ink/75">
          <SlotMark slot={slot} /> You&rsquo;re registered, {firstName}.
        </p>
        <h1 className="mt-3 text-3xl font-semibold">{reg.tourName}</h1>
        {batch && (
          <p className="mt-1 text-ink/75">Batch {batch} · departs {departureTime}</p>
        )}

        <div className="mt-8 rounded-md border-2 border-dashed border-ink/30 bg-white p-6 text-center">
          <p className="text-sm text-ink/70">Your code — show it at the pickup area</p>
          <p className="mt-2 font-mono text-5xl font-semibold tracking-[0.2em] sm:text-6xl" aria-label={`Code ${code.split('').join(' ')}`}>
            {code}
          </p>
        </div>

        <dl className="mt-8 grid grid-cols-[auto,1fr] gap-x-6 gap-y-3 text-[15px]">
          <dt className="text-ink/70">Date</dt>
          <dd className="font-medium">{date ? formatDate(date) : 'To be confirmed'}</dd>
          {tour && <>
            <dt className="text-ink/70">Pickup point</dt><dd className="font-medium">{tour.pickupPoint}</dd>
          </>}
          {departureTime && <>
            <dt className="text-ink/70">Bus leaves</dt><dd className="font-medium">{departureTime}</dd>
          </>}
        </dl>

        <p className={`mt-6 rounded-md px-4 py-3 font-medium ${slot === 'morning' ? 'bg-sun/20' : 'bg-dusk/10'}`}>
          Arrive 15 minutes before departure.
        </p>

        <div className="mt-6">
          <TourNotices tour={trip} heading="Before you go" />
        </div>
        <p className="mt-6 text-sm text-ink/70">
          Take a screenshot of this page. Our registration team will review your registration and may contact you to confirm your seat.
        </p>
        <Link href="/" className="mt-8 inline-block text-sm underline">Register someone else</Link>
      </main>
    </>
  );
}
