import type { Metadata } from 'next';
import { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Server Status - Dune Awakening',
  description: 'Public server status page',
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
