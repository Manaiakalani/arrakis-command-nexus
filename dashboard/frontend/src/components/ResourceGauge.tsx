'use client';

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';

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

export function ResourceGauge({ label, value, color, size = 148 }: ResourceGaugeProps) {
  const normalizedValue = clamp(value);
  const gaugeColor = resolveGaugeColor(normalizedValue, color);

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ value: normalizedValue, fill: gaugeColor }]}
            innerRadius="72%"
            outerRadius="100%"
            startAngle={210}
            endAngle={-30}
            barSize={14}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" background={{ fill: 'rgba(148, 163, 184, 0.14)' }} cornerRadius={999} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-slate-50">{normalizedValue.toFixed(0)}%</span>
          <span className="mt-1 text-[11px] uppercase tracking-[0.24em] text-slate-400">{label}</span>
        </div>
      </div>
    </div>
  );
}
