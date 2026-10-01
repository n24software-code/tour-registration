import type { Metadata } from 'next';
import { Readex_Pro } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

const readex = Readex_Pro({ subsets: ['latin', 'arabic'], variable: '--font-readex' });

export const metadata: Metadata = {
  title: 'Tour registration',
  description: 'Register for a guided tour and meet us at the bus pickup area.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={readex.variable}>
      <body className="min-h-screen font-sans"><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
