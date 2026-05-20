'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { MetricsPoint } from '@/lib/types';

interface MetricsChartProps {
  title: string;
  description?: string;
  history: MetricsPoint[];
  selectedRange: string;
  onRangeChange?: (range: string) => void;
  series: Array<{ key: keyof MetricsPoint; label: string; color: string; unit?: string }>;
}

const ranges = ['15m', '1h', '6h', '24h'];

export function MetricsChart({ title, description, history, selectedRange, onRangeChange, series }: MetricsChartProps) {
  const data = history.map((point) => ({
    ...point,
    time: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  return (
    <div className="glass-panel p-5">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="section-title">Telemetry</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-50">{title}</h3>
          {description ? <p className="mt-2 text-sm text-slate-400">{description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {ranges.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => onRangeChange?.(range)}
              className={selectedRange === range ? 'dune-button px-3 py-2 text-xs' : 'dune-button-muted px-3 py-2 text-xs'}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="4 4" />
            <XAxis dataKey="time" stroke="#64748b" tickLine={false} axisLine={false} />
            <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(15, 23, 42, 0.96)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: '16px',
                color: '#f8fafc',
              }}
            />
            {series.map((line) => (
              <Line
                key={String(line.key)}
                type="monotone"
                dataKey={String(line.key)}
                stroke={line.color}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, stroke: '#0f172a', strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
