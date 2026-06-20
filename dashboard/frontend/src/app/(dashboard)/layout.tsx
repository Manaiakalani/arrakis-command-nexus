import { ReactNode } from 'react';

import { DashboardShell } from '@/components/DashboardShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardShell>
      <ErrorBoundary>{children}</ErrorBoundary>
    </DashboardShell>
  );
}
