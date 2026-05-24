'use client';

import { Cpu, Download, HardDrive, Network, Waves } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';

import { Skeleton } from '@/components/Skeleton';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

const MetricsChart = dynamic(() => import('@/components/MetricsChart').then((mod) => mod.MetricsChart), {
  ssr: false,
  loading: () => <div className="h-80 animate-pulse rounded-xl bg-th-surface/50" />,
});

const NetworkSparkline = dynamic(() => import('@/components/NetworkSparkline').then((mod) => mod.NetworkSparkline), {
  ssr: false,
  loading: () => <div className="h-16 animate-pulse rounded-xl bg-th-surface/50" />,
});

const ResourceGauge = dynamic(() => import('@/components/ResourceGauge').then((mod) => mod.ResourceGauge), {
  ssr: false,
  loading: () => <div className="h-[116px] w-[116px] animate-pulse rounded-full bg-th-surface/50" />,
});

const UptimeChart = dynamic(() => import('@/components/UptimeChart').then((mod) => mod.UptimeChart), {
  ssr: false,
  loading: () => <div className="h-80 animate-pulse rounded-xl bg-th-surface/50" />,
});

const widgetOptions = [
  { value: 'all', label: 'All widgets' },
  { value: 'cpu', label: 'CPU load' },
  { value: 'memory', label: 'Memory pressure' },
  { value: 'disk', label: 'Disk usage' },
  { value: 'network', label: 'Network pulse' },
];

const exportFormats = ['csv', 'json'] as const;
const cpuSeries = [{ key: 'cpuPercent', label: 'CPU', color: '#f59e0b', unit: '%' }] as const;
const memorySeries = [{ key: 'memoryPercent', label: 'Memory', color: '#fb923c', unit: '%' }] as const;
const diskSeries = [{ key: 'diskPercent', label: 'Disk', color: '#fbbf24', unit: '%' }] as const;
const networkSeries = [
  { key: 'networkInMbps', label: 'Inbound', color: '#f59e0b', unit: 'Mbps' },
  { key: 'networkOutMbps', label: 'Outbound', color: '#fdba74', unit: 'Mbps' },
] as const;

function formatPercent(value?: number) {
  return `${(value ?? 0).toFixed(1)}%`;
}

function formatGb(used?: number, total?: number) {
  return `${(used ?? 0).toFixed(1)} / ${(total ?? 0).toFixed(1)} GB`;
}

function formatMbps(value?: number) {
  return `${(value ?? 0).toFixed(2)} Mbps`;
}

export default function SystemPage() {
  const [range, setRange] = useState('1h');
  const [exportWidget, setExportWidget] = useState('all');
  const [exportFormat, setExportFormat] = useState('csv');
  const metrics = useApi(() => apiClient.getSystemMetrics(), { refreshInterval: 10000 });
  const history = useApi(() => apiClient.getSystemHistory(range), { refreshInterval: 15000, initialData: { range, points: [] } });

  const exportUrl = `/api/system/export?range=${encodeURIComponent(range)}&format=${encodeURIComponent(exportFormat)}${exportWidget !== 'all' ? `&widget=${encodeURIComponent(exportWidget)}` : ''}`;

  const isLoading = metrics.loading && !metrics.data;

  if (isLoading) {
    return <SystemPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="section-title">System telemetry</p>
          <h2 className="mt-1 text-xl font-semibold text-th-text">Resource Overview</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={exportWidget}
            onChange={(e) => setExportWidget(e.target.value)}
            className="dune-input min-w-[160px]"
            aria-label="Export widget filter"
          >
            {widgetOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className="inline-flex overflow-hidden rounded-lg border border-th-border">
            {exportFormats.map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setExportFormat(fmt)}
                className={cn(
                  'px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors dune-focus',
                  exportFormat === fmt
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                    : 'bg-th-surface-s/70 text-th-text-m hover:text-th-text-s',
                )}
              >
                {fmt}
              </button>
            ))}
          </div>
          <a href={exportUrl} download className="dune-button-muted">
            <Download className="mr-2 h-4 w-4" /> Export metrics
          </a>
        </div>
      </div>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Resource</p>
              <h3 className="mt-1 text-lg font-semibold text-th-text">CPU load</h3>
              <p className="mt-2 text-sm text-th-text-m">Current processor saturation across the host.</p>
            </div>
            <div className="rounded-2xl border border-th-border/30 dark:border-white/5 bg-th-bg/40 p-3 text-amber-600 dark:text-amber-300 shadow-dune">
              <Cpu className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <ResourceGauge label="CPU" value={metrics.data?.cpuPercent ?? 0} size={116} />
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums text-th-text">{formatPercent(metrics.data?.cpuPercent)}</p>
              <p className="mt-2 text-sm text-th-text-m">Real-time processor load</p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Resource</p>
              <h3 className="mt-1 text-lg font-semibold text-th-text">Memory pressure</h3>
              <p className="mt-2 text-sm text-th-text-m">Resident RAM usage on the dashboard host.</p>
            </div>
            <div className="rounded-2xl border border-th-border/30 dark:border-white/5 bg-th-bg/40 p-3 text-orange-600 dark:text-orange-300 shadow-dune">
              <Waves className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <ResourceGauge label="RAM" value={metrics.data?.memoryPercent ?? 0} size={116} />
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums text-th-text">{formatPercent(metrics.data?.memoryPercent)}</p>
              <p className="mt-2 text-sm text-th-text-m">{formatGb(metrics.data?.memoryUsedGb, metrics.data?.memoryTotalGb)}</p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Resource</p>
              <h3 className="mt-1 text-lg font-semibold text-th-text">Disk usage</h3>
              <p className="mt-2 text-sm text-th-text-m">Persistent storage utilisation on the host volume.</p>
            </div>
            <div className="rounded-2xl border border-th-border/30 dark:border-white/5 bg-th-bg/40 p-3 text-amber-700 dark:text-amber-200 shadow-dune">
              <HardDrive className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <ResourceGauge label="Disk" value={metrics.data?.diskPercent ?? 0} size={116} />
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums text-th-text">{formatPercent(metrics.data?.diskPercent)}</p>
              <p className="mt-2 text-sm text-th-text-m">{formatGb(metrics.data?.diskUsedGb, metrics.data?.diskTotalGb)}</p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Throughput</p>
              <h3 className="mt-1 text-lg font-semibold text-th-text">Network pulse</h3>
              <p className="mt-2 text-sm text-th-text-m">Live ingress and egress throughput over the selected window.</p>
            </div>
            <div className="rounded-2xl border border-th-border/30 dark:border-white/5 bg-th-bg/40 p-3 text-amber-600 dark:text-amber-300 shadow-dune">
              <Network className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-th-text-m">Inbound</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-th-text">{formatMbps(metrics.data?.networkInMbps)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.22em] text-th-text-m">Outbound</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-th-text">{formatMbps(metrics.data?.networkOutMbps)}</p>
            </div>
          </div>
          <div className="mt-4">
            <NetworkSparkline history={history.data?.points ?? []} />
          </div>
        </div>
      </section>

      <UptimeChart />

      <section className="grid gap-6 xl:grid-cols-2">
        <MetricsChart
          title="CPU load"
          description="Real-time compute pressure across the host."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="area"
          series={[...cpuSeries]}
          yDomain={[0, 100]}
        />
        <MetricsChart
          title="Memory pressure"
          description="Resident memory usage of the dashboard host."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="area"
          series={[...memorySeries]}
          yDomain={[0, 100]}
        />
        <MetricsChart
          title="Disk activity"
          description="Persistent storage utilisation over the selected window."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="area"
          series={[...diskSeries]}
          yDomain={[0, 100]}
        />
        <MetricsChart
          title="Network throughput"
          description="Inbound and outbound traffic through the gateway."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="line"
          series={[...networkSeries]}
        />
      </section>
    </div>
  );
}

function SystemPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-56" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-11 w-40 rounded-xl" />
          <Skeleton className="h-11 w-28 rounded-xl" />
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="glass-panel p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-12 w-12 rounded-2xl" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-28 w-28 rounded-full" />
              <div className="space-y-3 text-right">
                <Skeleton className="ml-auto h-8 w-24" />
                <Skeleton className="ml-auto h-4 w-28" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <div className="glass-panel p-5 space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-72 w-full rounded-3xl" />
      </div>

      <section className="grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="glass-panel p-5 space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-56" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-12 rounded-lg" />
              <Skeleton className="h-9 w-12 rounded-lg" />
              <Skeleton className="h-9 w-12 rounded-lg" />
            </div>
            <Skeleton className="h-64 w-full rounded-3xl" />
          </div>
        ))}
      </section>
    </div>
  );
}
