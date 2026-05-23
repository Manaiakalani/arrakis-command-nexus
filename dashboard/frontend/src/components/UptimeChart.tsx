'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

const ranges = ['1h', '6h', '24h', '7d', '30d'];
const statusMeta = {
  up: { color: '#fb923c', label: 'Up', value: 100 },
  degraded: { color: '#f59e0b', label: 'Degraded', value: 65 },
  down: { color: '#ef4444', label: 'Down', value: 10 },
};

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(Math.floor(totalSeconds), 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

function formatTick(timestamp: string, range: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  if (range === '7d' || range === '30d') {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function UptimeChart() {
  const [range, setRange] = useState('24h');
  const uptime = useApi(() => apiClient.getUptimeData(range), {
    refreshInterval: 30000,
    initialData: { range, availabilityPercent: 0, totalUpSeconds: 0, totalDownSeconds: 0, events: [] },
  });

  const chartData = useMemo(
    () =>
      (uptime.data?.events ?? []).map((event) => ({
        ...event,
        label: formatTick(event.timestamp, range),
        value: statusMeta[event.status].value,
        statusLabel: statusMeta[event.status].label,
        fill: statusMeta[event.status].color,
      })),
    [range, uptime.data?.events],
  );

  const incidents = useMemo(
    () => [...(uptime.data?.events ?? [])].filter((event) => event.status !== 'up').reverse(),
    [uptime.data?.events],
  );

  return (
    <div className="glass-panel p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="section-title">Availability</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <h3 className="text-3xl font-semibold text-slate-50 tabular-nums">{(uptime.data?.availabilityPercent ?? 0).toFixed(1)}% uptime</h3>
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-amber-200">{range}</span>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            {formatDuration(uptime.data?.totalUpSeconds ?? 0)} available • {formatDuration(uptime.data?.totalDownSeconds ?? 0)} impacted
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ranges.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={range === option ? 'dune-button px-3 py-2 text-xs' : 'dune-button-muted px-3 py-2 text-xs'}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 h-56 w-full">
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="label" stroke="#64748b" tickLine={false} axisLine={false} minTickGap={20} />
            <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(value: number) => `${value}%`} stroke="#64748b" tickLine={false} axisLine={false} width={54} />
            <Tooltip
              labelFormatter={(label, payload) => String(payload?.[0]?.payload?.timestamp ?? label)}
              formatter={(value, _name, item) => [`${item.payload.statusLabel} • ${formatDuration(item.payload.durationSeconds)}`, 'Status']}
              contentStyle={{
                backgroundColor: 'rgba(15, 23, 42, 0.96)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: '16px',
                color: '#f8fafc',
              }}
            />
            <Bar dataKey="value" radius={[8, 8, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={`${entry.timestamp}-${entry.status}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {[
          { label: 'Available', value: formatDuration(uptime.data?.totalUpSeconds ?? 0), tone: 'text-amber-200' },
          { label: 'Impacted', value: formatDuration(uptime.data?.totalDownSeconds ?? 0), tone: 'text-red-300' },
          { label: 'Incidents', value: incidents.length, tone: 'text-slate-100' },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-800/80 bg-slate-900/50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
            <p className={`mt-2 text-lg font-semibold tabular-nums ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Recent incidents</h4>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#fb923c]" />Up</span>
            <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />Degraded</span>
            <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />Down</span>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {incidents.length > 0 ? (
            incidents.slice(0, 6).map((event) => (
              <div key={`${event.timestamp}-${event.status}`} className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-900/50 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-100">{statusMeta[event.status].label} event</p>
                  <p className="mt-1 text-slate-400">{new Date(event.timestamp).toLocaleString()}</p>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-200">{formatDuration(event.durationSeconds)}</span>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">No downtime or degraded events recorded in this window.</div>
          )}
        </div>
      </div>
    </div>
  );
}
