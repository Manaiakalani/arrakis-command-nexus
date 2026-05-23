'use client';

import { memo } from 'react';

import { cn, GAUGE_TRACK_STROKE } from '@/lib/utils';

interface ResourceGaugeProps {
  label: string;
  value: number;
  color?: string;
  size?: number;
}

function clamp(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 100);
}

function resolveGaugeColor(value: number, color?: string) {
  if (color) {
    return color;
  }

  if (value >= 85) {
    return '#ef4444';
  }
  if (value >= 60) {
    return '#f59e0b';
  }
  return '#22c55e';
}

const STROKE_WIDTH = 5;
const VIEWBOX = 36;
const RADIUS = (VIEWBOX - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export const ResourceGauge = memo(function ResourceGauge({ label, value, color, size = 148 }: ResourceGaugeProps) {
  const normalizedValue = clamp(value);
  const gaugeColor = resolveGaugeColor(normalizedValue, color);
  const offset = CIRCUMFERENCE - (normalizedValue / 100) * CIRCUMFERENCE;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          className="h-full w-full -rotate-90"
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={RADIUS}
            fill="none"
            stroke={GAUGE_TRACK_STROKE}
            strokeWidth={STROKE_WIDTH}
          />
          {/* Value arc */}
          <circle
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={RADIUS}
            fill="none"
            stroke={gaugeColor}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset,stroke] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-lg font-semibold tabular-nums leading-none"
            style={{ color: gaugeColor }}
          >
            {normalizedValue.toFixed(0)}%
          </span>
        </div>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-th-text-m">
        {label}
      </span>
    </div>
  );
});
