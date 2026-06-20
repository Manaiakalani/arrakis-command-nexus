import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns Recharts-compatible tooltip styles that respect the current theme. */
export function getTooltipStyles(): {
  contentStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  itemStyle: React.CSSProperties;
} {
  return {
    contentStyle: {
      backgroundColor: 'var(--tooltip-bg)',
      border: '1px solid var(--tooltip-border)',
      borderRadius: '16px',
      color: 'var(--tooltip-text)',
    },
    labelStyle: { color: 'var(--tooltip-label)' },
    itemStyle: { color: 'var(--tooltip-text)' },
  };
}

/** Returns CSS variable value for chart grid stroke. */
export const CHART_GRID_STROKE = 'var(--chart-grid)';
export const CHART_AXIS_STROKE = 'var(--chart-axis)';
export const GAUGE_TRACK_STROKE = 'var(--gauge-track)';
