'use client';

import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'default';
}

export function ConfirmDialog({ open, onConfirm, onCancel, title, message, confirmLabel = 'Confirm', variant = 'default' }: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const timer = window.setTimeout(() => {
      const firstButton = panelRef.current?.querySelector<HTMLButtonElement>('button');
      firstButton?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-th-bg/80 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        className="glass-panel w-full max-w-md p-6 animate-in zoom-in-95 slide-in-from-bottom-2 duration-150"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'rounded-2xl p-3',
              variant === 'danger'
                ? 'bg-red-500/15 text-red-600 dark:text-red-300'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
            )}
          >
            <AlertTriangle aria-hidden="true" className="h-5 w-5" />
          </div>
          <h3 className="text-xl font-semibold text-th-text" id="confirm-dialog-title">
            {title}
          </h3>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-th-text-m">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="dune-button-muted" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={cn(
              variant === 'danger'
                ? 'flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-300 dune-focus'
                : 'dune-button',
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}