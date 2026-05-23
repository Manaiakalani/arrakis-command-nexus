'use client';

import { AlertTriangle, RefreshCcw, WifiOff } from 'lucide-react';

import { cn } from '@/lib/utils';

interface ApiErrorProps {
  error: Error | null;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

export function ApiError({ error, onRetry, compact, className }: ApiErrorProps) {
  if (!error) return null;

  const isNetworkError = /fetch|network|ECONNREFUSED/i.test(error.message);
  const Icon = isNetworkError ? WifiOff : AlertTriangle;
  const message = isNetworkError
    ? 'Unable to reach the server'
    : error.message || 'Something went wrong';

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300', className)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{message}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="ml-auto shrink-0 rounded p-0.5 hover:bg-red-500/20">
            <RefreshCcw className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('glass-panel border-red-500/20 p-6 text-center', className)}>
      <Icon className="mx-auto h-8 w-8 text-red-400" />
      <p className="mt-3 text-sm font-medium text-slate-200">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="dune-button-muted mt-4">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  );
}
