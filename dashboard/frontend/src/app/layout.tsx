import type { Metadata } from 'next';
import { ReactNode } from 'react';

import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'Dune Awakening Dashboard',
  description: 'Self-hosted control center for the Dune Awakening server fleet.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
