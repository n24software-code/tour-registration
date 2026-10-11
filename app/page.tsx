'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Slot, Tour } from '@/lib/types';
import { SLOT_LABEL } from '@/lib/types';
import {
  FIELD_ORDER, ID_HINT, ID_LABEL, idTypeFor, isRestricted, needsConditions, normalize,
  restrictionMessage, todayISO, validate,
  type Field, type FieldErrors, type RegistrationInput,
} from '@/lib/validation';
import { DEFAULT_COUNTRY, countryForNationality } from '@/lib/countries';
import { SlotMark, formatDate, seatsLeft } from '@/components/ui';
import { LogoBand } from '@/components/Logos';
import { NationalitySelect } from '@/components/NationalitySelect';
import { PhoneField } from '@/components/PhoneField';
import { TourNotices, hasTripInfo } from '@/components/TourNotices';

const EMPTY: RegistrationInput = {
  name: '', phone: '', phoneCountry: DEFAULT_COUNTRY, idNumber: '', nationality: '',
  tourId: '', tourDate: '', email: '', acceptedConditions: false,
};

export default function RegisterPage() {
  const router = useRouter();
  const [tours, setTours] = useState<Tour[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<RegistrationInput>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const today = useMemo(() => todayISO(), []);
  // Once the visitor picks a country themselves, the nationality stops overriding it.
  const countryTouched = useRef(false);

  // Live, so seats left stays accurate while the visitor fills in the form.
  useEffect(
    () =>
      onSnapshot(
        collection(db, 'tours'),
        (s) => setTours(s.docs.map((d) => ({ ...d.data(), id: d.id }) as Tour).sort((a, b) => a.order - b.order)),
        () => setLoadError('Tours could not be loaded. Check your connection and reload the page.')
      ),
    []
  );

  const chosen = tours?.find((t) => t.id === form.tourId);
  const idType = form.nationality ? idTypeFor(form.nationality) : undefined;
  const showConditions = needsConditions(chosen);

  // Picking a restricted nationality takes the tour away again, with the reason shown.
  useEffect(() => {
    if (chosen && isRestricted(chosen, form.nationality)) {
      setForm((f) => ({ ...f, tourId: '', tourDate: '', acceptedConditions: false }));
      setErrors((e) => ({ ...e, tourId: restrictionMessage(chosen) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.nationality, chosen?.id]);

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };

  /**
   * The nationality drives two other fields: it suggests the dial code (until the
   * visitor overrides it) and it decides whether we ask for a National ID or a passport.
   * Switching between the two clears the value, because they are different documents.
   */
  function chooseNationality(code: string) {
    setForm((f) => {
      const wasType = f.nationality ? idTypeFor(f.nationality) : undefined;
      const nowType = code ? idTypeFor(code) : undefined;
      const suggested = countryForNationality(code);
      return {
        ...f,
        nationality: code,
        idNumber: wasType === nowType ? f.idNumber : '',
        phoneCountry: !countryTouched.current && suggested ? suggested : f.phoneCountry,
      };
    });
    setErrors((e) => ({ ...e, nationality: undefined, idNumber: undefined }));
  }

  /** Choosing a tour fills in its fixed date, or clears the date so it can be picked. */
  function chooseTour(t: Tour) {
    setForm({
      ...form,
      tourId: t.id,
      tourDate: t.date ? t.date : form.tourDate,
      // Consent belongs to the tour you consented to, so it never carries across.
      acceptedConditions: false,
    });
    setErrors({ ...errors, tourId: undefined, tourDate: undefined, acceptedConditions: undefined });
  }

  function focusFirst(errs: FieldErrors) {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (!first) return;
    const target = first === 'tourId' ? 'tours' : first === 'phoneCountry' ? 'phone' : first;
    document.getElementById(target)?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const clientErrors = validate(normalize(form), chosen);
    if (Object.keys(clientErrors).length) { setErrors(clientErrors); focusFirst(clientErrors); return; }

    setSaving(true); setErrors({});
    try {
      const res = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.code) return router.push(`/registered/${data.code}`);
      if (data.errors) { setErrors(data.errors); focusFirst(data.errors); }
      setMessage(data.message ?? (data.errors ? '' : 'Registration could not be saved. Try again in a moment.'));
    } catch {
      setMessage('No connection. Check your internet and try again.');
    }
    setSaving(false);
  }

  const err = (f: Field) =>
    errors[f] ? <p id={`${f}-error`} className="field-error">{errors[f]}</p> : null;
  const aria = (f: Field) => ({ 'aria-invalid': !!errors[f], 'aria-describedby': errors[f] ? `${f}-error` : undefined });

  return (
    <>
      <LogoBand />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-5 sm:py-16">
        <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">
          Choose your tour.<br />We&rsquo;ll meet you at the bus.
        </h1>
        <p className="mt-4 max-w-xl text-ink/75">
          Register below and you&rsquo;ll get a confirmation code. Show it at the pickup area and our team will
          get you on the right bus.
        </p>

        <form onSubmit={submit} className="mt-10 space-y-10" noValidate>
          <fieldset className="grid gap-5 sm:grid-cols-2">
            <legend className="mb-4 text-lg font-semibold">Your details</legend>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="name">Full name</label>
              <input id="name" className="input" value={form.name} onChange={set('name')} autoComplete="name" {...aria('name')} />
              {err('name')}
            </div>

            <div className="sm:col-span-2">
              <span className="label block" id="phone-label">Mobile number</span>
              <PhoneField
                countryId="phoneCountry"
                numberId="phone"
                country={form.phoneCountry}
                number={form.phone}
                onCountryChange={(code) => {
                  countryTouched.current = true;
                  setForm((f) => ({ ...f, phoneCountry: code }));
                  setErrors((e) => ({ ...e, phone: undefined }));
                }}
                onNumberChange={(value) => {
                  setForm((f) => ({ ...f, phone: value }));
                  setErrors((e) => ({ ...e, phone: undefined }));
                }}
                invalid={!!errors.phone}
                describedBy={errors.phone ? 'phone-error' : undefined}
              />
              {err('phone')}
            </div>

            <div>
              <label className="label" htmlFor="nationality">Nationality</label>
              <NationalitySelect
                id="nationality"
                value={form.nationality}
                invalid={!!errors.nationality}
                describedBy={errors.nationality ? 'nationality-error' : undefined}
                onChange={chooseNationality}
              />
              {err('nationality')}
            </div>

            <div>
              <label className="label" htmlFor="idNumber">
                {idType ? ID_LABEL[idType] : 'National ID or passport number'}
              </label>
              <input
                id="idNumber"
                className={`input ${idType === 'passport' ? 'uppercase' : ''}`}
                autoComplete="off"
                autoCapitalize={idType === 'passport' ? 'characters' : 'none'}
                inputMode={idType === 'national_id' ? 'numeric' : 'text'}
                maxLength={idType === 'national_id' ? 10 : 20}
                disabled={!idType}
                value={form.idNumber}
                onChange={set('idNumber')}
                {...aria('idNumber')}
              />
              {/* Announced so a screen-reader user hears the field change with the nationality. */}
              <p className="mt-1 text-xs text-ink/60" aria-live="polite">
                {idType ? ID_HINT[idType] : 'Choose your nationality first'}
              </p>
              {err('idNumber')}
            </div>
          </fieldset>

          <fieldset id="tours" tabIndex={-1} {...aria('tourId')} className="focus:outline-none">
            <legend className="text-lg font-semibold">Tour / Destination</legend>
            {!tours && !loadError && <p className="mt-3 text-ink/70">Loading tours…</p>}
            {loadError && <p role="alert" className="mt-3 text-clay">{loadError}</p>}
            {tours?.length === 0 && <p className="mt-3 text-ink/70">No tours are listed yet. Please check back soon.</p>}
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              {(['morning', 'evening'] as Slot[]).map((slot) => {
                const list = tours?.filter((t) => t.slot === slot) ?? [];
                if (!list.length) return null;
                return (
                  <div key={slot} role="radiogroup" aria-labelledby={`${slot}-heading`}>
                    <h2 id={`${slot}-heading`} className="mb-2 flex items-center gap-2 text-sm font-medium text-ink/75">
                      <SlotMark slot={slot} /> {SLOT_LABEL[slot]}
                    </h2>
                    <div className="space-y-2">
                      {list.map((t) => {
                        const left = seatsLeft(t);
                        const blocked = isRestricted(t, form.nationality);
                        const unavailable = !t.active || left === 0 || blocked;
                        const selected = form.tourId === t.id;
                        return (
                          <label
                            key={t.id}
                            className={`block rounded-md border bg-white p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-sun ${
                              selected
                                ? slot === 'morning' ? 'border-sun ring-2 ring-sun/50' : 'border-dusk ring-2 ring-dusk/40'
                                : 'border-ink/20 hover:border-ink/50'
                            } ${unavailable ? 'cursor-not-allowed bg-ink/[0.03] opacity-60' : 'cursor-pointer'}`}
                          >
                            <input
                              type="radio" name="tour" value={t.id} className="sr-only" disabled={unavailable}
                              checked={selected} onChange={() => chooseTour(t)}
                            />
                            <span className="block font-medium">{t.name}</span>
                            <span className="mt-1 block text-sm text-ink/70">
                              Bus leaves {t.departureTime}{t.date ? `, ${formatDate(t.date)}` : ''} from {t.pickupPoint}
                            </span>
                            {blocked ? (
                              <span className="mt-2 block text-xs font-medium text-clay">{restrictionMessage(t)}</span>
                            ) : (
                              <span className={`mt-2 block text-xs font-medium ${unavailable ? 'text-clay' : left <= 10 ? 'text-[#6b4409]' : 'text-ink/60'}`}>
                                {!t.active ? 'Registration closed' : left === 0 ? 'Full' : `${left} ${left === 1 ? 'seat' : 'seats'} left`}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {err('tourId')}

            {/* Shown only while a tour that carries this information is selected. */}
            <div aria-live="polite" className="mt-6 empty:mt-0">
              {chosen && hasTripInfo(chosen) && (
                <>
                  <TourNotices tour={chosen} id="trip-info" />
                  {showConditions && (
                    <div className="mt-4">
                      <label className="flex cursor-pointer items-start gap-3 text-sm">
                        <input
                          id="acceptedConditions"
                          type="checkbox"
                          className="mt-0.5 h-5 w-5 shrink-0 accent-ink"
                          checked={form.acceptedConditions}
                          aria-invalid={!!errors.acceptedConditions}
                          aria-describedby={errors.acceptedConditions ? 'acceptedConditions-error' : 'trip-info'}
                          onChange={(e) => {
                            setForm((f) => ({ ...f, acceptedConditions: e.target.checked }));
                            setErrors((er) => ({ ...er, acceptedConditions: undefined }));
                          }}
                        />
                        <span>I have read these conditions and confirm they don&rsquo;t apply to me.</span>
                      </label>
                      {err('acceptedConditions')}
                    </div>
                  )}
                </>
              )}
            </div>
          </fieldset>

          <fieldset className="grid gap-5 sm:grid-cols-2">
            <legend className="mb-4 text-lg font-semibold">Date and contact</legend>
            <div>
              <label className="label" htmlFor="tourDate">Date</label>
              <input
                id="tourDate" type="date" className="input"
                min={today}
                readOnly={!!chosen?.date}
                value={form.tourDate}
                onChange={set('tourDate')}
                {...aria('tourDate')}
              />
              <p className="mt-1 text-xs text-ink/60">
                {chosen?.date
                  ? `${chosen.name} runs on this date only.`
                  : 'Pick the day you want to travel — today or later.'}
              </p>
              {err('tourDate')}
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" inputMode="email" className="input" value={form.email} onChange={set('email')}
                autoComplete="email" {...aria('email')} />
              <p className="mt-1 text-xs text-ink/60">We&rsquo;ll send your booking confirmation here.</p>
              {err('email')}
            </div>
          </fieldset>

          {message && <p role="alert" className="rounded-md bg-clay/10 px-4 py-3 text-sm text-clay">{message}</p>}
          <button type="submit" className="btn-primary w-full py-3 text-base sm:w-auto sm:px-8" disabled={saving}>
            {saving ? 'Registering…' : 'Register for this tour'}
          </button>
        </form>
      </main>
    </>
  );
}
