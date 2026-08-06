import type { Metadata } from 'next';
import { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Sign in - Arrakis Command Nexus',
  description: 'Dashboard sign-in',
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
