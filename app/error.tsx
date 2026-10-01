'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-ink/70">This page couldn&rsquo;t load. Check your connection and try again. If it keeps happening, contact the tour team.</p>
      <button className="btn-primary mt-6" onClick={reset}>Try again</button>
    </main>
  );
}
