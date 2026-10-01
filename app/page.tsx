'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Slot, Tour } from '@/lib/types';
import { SLOT_LABEL } from '@/lib/types';
import { normalize, validate, type RegistrationInput } from '@/lib/validation';
import { SlotMark, formatDate, seatsLeft } from '@/components/ui';

type Field = keyof RegistrationInput;

export default function RegisterPage() {
  const router = useRouter();
  const [tours, setTours] = useState<Tour[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<RegistrationInput>({ name: '', email: '', phone: '', tourId: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

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

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };

  function focusFirst(errs: Partial<Record<Field, string>>) {
    const first = (['tourId', 'name', 'email', 'phone'] as Field[]).find((f) => errs[f]);
    if (first) document.getElementById(first === 'tourId' ? 'tours' : first)?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const clientErrors = validate(normalize(form));
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
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-5 sm:py-16">
      <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">
        Choose your tour.<br />We&rsquo;ll meet you at the bus.
      </h1>
      <p className="mt-4 max-w-xl text-ink/75">
        Register below and you&rsquo;ll get a confirmation code. Show it at the pickup area and our team will
        get you on the right bus.
      </p>

      <form onSubmit={submit} className="mt-10 space-y-10" noValidate>
        <fieldset id="tours" tabIndex={-1} {...aria('tourId')} className="focus:outline-none">
          <legend className="text-lg font-semibold">Destination</legend>
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
                      const unavailable = !t.active || left === 0;
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
                            checked={selected}
                            onChange={() => { setForm({ ...form, tourId: t.id }); setErrors({ ...errors, tourId: undefined }); }}
                          />
                          <span className="block font-medium">{t.name}</span>
                          <span className="mt-1 block text-sm text-ink/70">
                            Bus leaves {t.departureTime}{t.date ? `, ${formatDate(t.date)}` : ''} from {t.pickupPoint}
                          </span>
                          <span className={`mt-2 block text-xs font-medium ${unavailable ? 'text-clay' : left <= 10 ? 'text-[#6b4409]' : 'text-ink/60'}`}>
                            {!t.active ? 'Registration closed' : left === 0 ? 'Full' : `${left} ${left === 1 ? 'seat' : 'seats'} left`}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {err('tourId')}
        </fieldset>

        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="mb-4 text-lg font-semibold">Your details</legend>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" className="input" value={form.name} onChange={set('name')} autoComplete="name" {...aria('name')} />
            {err('name')}
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" inputMode="email" className="input" value={form.email} onChange={set('email')}
              autoComplete="email" {...aria('email')} />
            {err('email')}
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone number</label>
            <input id="phone" type="tel" inputMode="tel" className="input" placeholder="05X XXX XXXX or +966 5X XXX XXXX"
              value={form.phone} onChange={set('phone')} autoComplete="tel" {...aria('phone')} />
            {err('phone')}
          </div>
        </fieldset>

        {message && <p role="alert" className="rounded-md bg-clay/10 px-4 py-3 text-sm text-clay">{message}</p>}
        <button type="submit" className="btn-primary w-full py-3 text-base sm:w-auto sm:px-8" disabled={saving}>
          {saving ? 'Registering…' : 'Register for this tour'}
        </button>
      </form>
    </main>
  );
}
