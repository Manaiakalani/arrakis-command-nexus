'use client';

import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { useEffect } from 'react';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertTriangle className="h-8 w-8 text-red-500" />
        </div>
        <h2 className="text-xl font-semibold text-th-text">Something went wrong</h2>
        <p className="mt-2 text-sm text-th-text-m">{error.message || 'An unexpected error occurred.'}</p>
        <button type="button" className="dune-button mt-6" onClick={reset}>
          <RefreshCcw className="mr-2 h-4 w-4" /> Try again
        </button>
      </div>
    </div>
  );
}
