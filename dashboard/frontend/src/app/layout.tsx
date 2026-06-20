import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ReactNode } from 'react';

import '@/app/globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastProvider } from '@/components/ToastProvider';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Arrakis Command Nexus',
    template: '%s | Arrakis Command Nexus',
  },
  description: 'Self-hosted control center for the Dune Awakening server fleet.',
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.svg',
  },
  openGraph: {
    title: 'Arrakis Command Nexus',
    description: 'Self-hosted control center for the Dune Awakening server fleet.',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1440, height: 900, alt: 'Arrakis Command Nexus Dashboard' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
