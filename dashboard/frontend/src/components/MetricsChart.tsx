'use client';

import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
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
  chartType?: 'line' | 'area';
}

const ranges = ['15m', '1h', '6h', '24h', '7d', '30d'];

function formatMetricValue(value: number, unit?: string) {
  if (!Number.isFinite(value)) {
    return unit ? `0 ${unit}` : '0';
  }

  const absoluteValue = Math.abs(value);
  const decimals = unit === '%' ? 1 : absoluteValue >= 100 ? 0 : absoluteValue >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
}

function formatTickLabel(timestamp: string, range: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  if (range === '7d' || range === '30d') {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  if (range === '24h') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTooltipLabel(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MetricsChart({
  title,
  description,
  history,
  selectedRange,
  onRangeChange,
  series,
  chartType = 'area',
}: MetricsChartProps) {
  const gradientPrefix = useId().replace(/:/g, '');
  const data = useMemo(
    () =>
      history.map((point) => ({
        ...point,
        time: formatTickLabel(point.timestamp, selectedRange),
      })),
    [history, selectedRange],
  );
  const primaryUnit = series[0]?.unit;

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
          {chartType === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="4 4" />
              <XAxis dataKey="time" stroke="#64748b" tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis
                stroke="#64748b"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatMetricValue(value, primaryUnit)}
                width={80}
              />
              <Tooltip
                labelFormatter={(label, payload) => formatTooltipLabel(String(payload?.[0]?.payload?.timestamp ?? label))}
                formatter={(value, _name, item) => {
                  const config = series.find((entry) => String(entry.key) === String(item.dataKey));
                  return [formatMetricValue(Number(value), config?.unit), config?.label ?? String(item.dataKey)];
                }}
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
          ) : (
            <AreaChart data={data}>
              <defs>
                {series.map((entry) => (
                  <linearGradient key={String(entry.key)} id={`${gradientPrefix}-${String(entry.key)}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={entry.color} stopOpacity={0.45} />
                    <stop offset="95%" stopColor={entry.color} stopOpacity={0.04} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="4 4" />
              <XAxis dataKey="time" stroke="#64748b" tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis
                stroke="#64748b"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatMetricValue(value, primaryUnit)}
                width={80}
              />
              <Tooltip
                labelFormatter={(label, payload) => formatTooltipLabel(String(payload?.[0]?.payload?.timestamp ?? label))}
                formatter={(value, _name, item) => {
                  const config = series.find((entry) => String(entry.key) === String(item.dataKey));
                  return [formatMetricValue(Number(value), config?.unit), config?.label ?? String(item.dataKey)];
                }}
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.96)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  borderRadius: '16px',
                  color: '#f8fafc',
                }}
              />
              {series.map((entry) => (
                <Area
                  key={String(entry.key)}
                  type="monotone"
                  dataKey={String(entry.key)}
                  stroke={entry.color}
                  fill={`url(#${gradientPrefix}-${String(entry.key)})`}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  dot={false}
                  activeDot={{ r: 5, stroke: '#0f172a', strokeWidth: 2 }}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
