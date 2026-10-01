import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">We couldn&rsquo;t find that page</h1>
      <p className="mt-2 text-ink/70">If you typed a registration code, check it and try again. Codes have 6 letters and numbers.</p>
      <Link href="/" className="btn-primary mt-6">Go to tour registration</Link>
    </main>
  );
}
