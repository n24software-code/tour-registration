'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useAdmins, useRunner } from '@/lib/hooks';
import { removeAdmin, setAdminRole } from '@/lib/actions';
import { ROLE_LABEL } from '@/lib/roles';
import type { Role } from '@/lib/types';
import { ErrorNote } from '@/components/ui';

const ROLES = Object.keys(ROLE_LABEL) as Role[];
const empty = { name: '', email: '', role: 'registration' as Role, password: '' };
type Field = keyof typeof empty;

export default function TeamPage() {
  const { user, admin } = useAuth();
  const { data: admins, loading, error } = useAdmins();
  const { run, busy, error: actionError, clearError } = useRunner();
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (!admin || !user) return null;

  async function add(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const errs: Partial<Record<Field, string>> = {};
    if (form.name.trim().length < 2) errs.name = 'Enter their name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) errs.email = 'Enter a valid email address.';
    if (form.password.length < 8) errs.password = 'Use at least 8 characters.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const res = await fetch('/api/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user!.getIdToken()}` },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({
          ok: true,
          text: data.existed
            ? `${form.name} already had a login, so their existing password still works. They now have the ${ROLE_LABEL[form.role]} role.`
            : `${form.name} added. Share the temporary password with them in person and ask them to sign in at /login.`,
        });
        setForm(empty);
      } else {
        if (data.errors) setErrors(data.errors);
        setMsg({ ok: false, text: data.message ?? 'Fix the highlighted fields and try again.' });
      }
    } catch {
      setMsg({ ok: false, text: 'No connection. Check your internet and try again.' });
    }
    setSaving(false);
  }

  const input = (f: Field, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`m-${f}`} className="label">{label}</label>
      <input id={`m-${f}`} className="input" value={form[f]} aria-invalid={!!errors[f]}
        aria-describedby={errors[f] ? `m-${f}-err` : undefined}
        onChange={(e) => setForm({ ...form, [f]: e.target.value })} {...props} />
      {errors[f] && <p id={`m-${f}-err`} className="field-error">{errors[f]}</p>}
    </div>
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Team</h1>
      <p className="mt-1 text-sm text-ink/70">Everyone here signs in at /login. What they can see and do depends on their role.</p>
      <ErrorNote message={error} />
      <ErrorNote message={actionError} onClose={clearError} />

      <div className="mt-6 overflow-x-auto rounded-md border border-ink/10 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="table-head"><tr>
            <th className="cell">Name</th><th className="cell">Email</th><th className="cell">Role</th>
            <th className="cell"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {[...admins].sort((a, b) => a.name.localeCompare(b.name)).map((a) => {
              const self = a.uid === admin.uid;
              return (
                <tr key={a.uid} className="border-b border-ink/5 last:border-0">
                  <td className="cell font-medium">{a.name}{self && <span className="ml-2 text-xs text-ink/60">(you)</span>}</td>
                  <td className="cell">{a.email}</td>
                  <td className="cell">
                    <label htmlFor={`role-${a.uid}`} className="sr-only">Role for {a.name}</label>
                    <select id={`role-${a.uid}`} className="input max-w-[14rem]" value={a.role} disabled={self || busy === a.uid}
                      title={self ? 'You can’t change your own role' : undefined}
                      onChange={(e) => run(a.uid, () => setAdminRole(a, e.target.value as Role, admin))}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  <td className="cell text-right">
                    {!self && (
                      <button className="btn-danger btn-sm" disabled={busy === a.uid}
                        onClick={() => confirm(`Remove ${a.name}'s access? They will no longer be able to open the admin pages.`)
                          && run(a.uid, () => removeAdmin(a, admin))}>
                        Remove access
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <p className="p-4 text-ink/70" role="status">Loading…</p>}
      </div>

      <form onSubmit={add} className="mt-8 rounded-md border border-ink/10 bg-white p-4" noValidate>
        <h2 className="font-semibold">Add a team member</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {input('name', 'Name', { autoComplete: 'off' })}
          {input('email', 'Email', { type: 'email', autoComplete: 'off' })}
          <div>
            <label htmlFor="m-role" className="label">Role</label>
            <select id="m-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          {input('password', 'Temporary password', { type: 'text', autoComplete: 'new-password', minLength: 8 })}
        </div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${msg.ok ? 'text-palm' : 'text-clay'}`}>{msg.text}</p>}
        <button className="btn-primary mt-4" disabled={saving}>{saving ? 'Adding…' : 'Add member'}</button>
      </form>
    </>
  );
}
