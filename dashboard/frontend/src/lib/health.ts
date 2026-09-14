import type { HealthState } from '@/lib/types';

export type DisplayHealth = HealthState | 'unknown';

export const healthDotClass: Record<DisplayHealth, string> = {
  unknown: 'bg-stone-400 dark:bg-slate-500',
  healthy: 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.85)]',
  degraded: 'bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.85)]',
  offline: 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.75)]',
  starting: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.75)]',
  stopped: 'bg-stone-400 dark:bg-slate-500',
  completed: 'bg-sky-300 shadow-[0_0_8px_rgba(125,211,252,0.5)]',
};

export const healthPillClass: Record<DisplayHealth, string> = {
  unknown: 'border-th-border/80 bg-th-surface-s/70 text-th-text-s',
  healthy: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  degraded: 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  offline: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
  starting: 'border-sky-500/20 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  stopped: 'border-th-border/80 bg-th-surface-s/70 text-th-text-s',
  completed: 'border-sky-500/20 bg-sky-500/10 text-sky-800 dark:text-sky-200',
};

export const healthLabel: Record<DisplayHealth, string> = {
  unknown: 'Checking…',
  healthy: 'healthy',
  degraded: 'degraded',
  offline: 'offline',
  starting: 'starting',
  stopped: 'stopped',
  completed: 'completed',
};

export function asDisplayHealth(value: HealthState | undefined | null): DisplayHealth {
  return value ?? 'unknown';
}
