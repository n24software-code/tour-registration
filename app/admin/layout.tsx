'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { can, ROLE_LABEL, type Permission } from '@/lib/roles';
import { Logos } from '@/components/Logos';

const NAV: { href: string; label: string; perm: Permission }[] = [
  { href: '/admin', label: 'Overview', perm: 'viewOverview' },
  { href: '/admin/registrations', label: 'Registrations', perm: 'manageRegistrations' },
  { href: '/admin/crowd', label: 'Pickup & boarding', perm: 'operatePickup' },
  { href: '/admin/tours', label: 'Tours', perm: 'manageTours' },
  { href: '/admin/team', label: 'Team', perm: 'manageTeam' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, admin, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);

  if (loading || !user) return <p className="p-8 text-ink/70" role="status">Loading…</p>;
  if (!admin)
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">No team role yet</h1>
        <p className="mt-2 text-ink/75">
          You&rsquo;re signed in as {user.email}, but this account hasn&rsquo;t been given a role.
          Ask the Product Owner to add you on the Team page, then sign in again.
        </p>
        <button className="btn-ghost mt-6" onClick={() => signOut(auth)}>Sign out</button>
      </main>
    );

  const items = NAV.filter((n) => can(admin.role, n.perm));
  const current = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => pathname.startsWith(n.href));
  const blocked = current && !can(admin.role, current.perm);

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-5">
          <Link href="/admin" className="flex items-center gap-3">
            <Logos size="small" className="hidden md:flex" />
            <span className="font-semibold">Tour operations</span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm sm:order-last">
            <span className="text-ink/70"><span className="font-medium text-ink">{admin.name}</span> · {ROLE_LABEL[admin.role]}</span>
            <button className="btn-ghost btn-sm" onClick={() => signOut(auth)}>Sign out</button>
          </div>
          <nav aria-label="Admin" className="-mx-1 flex w-full gap-1 overflow-x-auto sm:w-auto">
            {items.map((n) => (
              <Link key={n.href} href={n.href} aria-current={current?.href === n.href ? 'page' : undefined}
                className={`whitespace-nowrap rounded px-3 py-2 text-sm ${current?.href === n.href ? 'bg-ink text-white' : 'hover:bg-ink/5'}`}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
        {blocked ? (
          <div>
            <h1 className="text-xl font-semibold">This page isn&rsquo;t available to your role</h1>
            <p className="mt-2 text-ink/75">{ROLE_LABEL[admin.role]} accounts can&rsquo;t open {current.label}. Use the menu above to pick a page you can use.</p>
          </div>
        ) : children}
      </main>
    </div>
  );
}
