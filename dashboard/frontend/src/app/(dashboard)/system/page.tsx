'use client';

import { Cpu, HardDrive, Network, Waves } from 'lucide-react';
import { useState } from 'react';

import { MetricsChart } from '@/components/MetricsChart';
import { NetworkSparkline } from '@/components/NetworkSparkline';
import { ResourceGauge } from '@/components/ResourceGauge';
import { UptimeChart } from '@/components/UptimeChart';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

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
  const metrics = useApi(() => apiClient.getSystemMetrics(), { refreshInterval: 10000 });
  const history = useApi(() => apiClient.getSystemHistory(range), { refreshInterval: 15000, initialData: { range, points: [] } });

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Resource</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-50">CPU load</h3>
              <p className="mt-2 text-sm text-slate-400">Current processor saturation across the host.</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-3 text-amber-300 shadow-dune">
              <Cpu className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <ResourceGauge label="CPU" value={metrics.data?.cpuPercent ?? 0} size={116} />
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums text-slate-50">{formatPercent(metrics.data?.cpuPercent)}</p>
              <p className="mt-2 text-sm text-slate-400">Real-time processor load</p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Resource</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-50">Memory pressure</h3>
              <p className="mt-2 text-sm text-slate-400">Resident RAM usage on the dashboard host.</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-3 text-orange-300 shadow-dune">
              <Waves className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <ResourceGauge label="RAM" value={metrics.data?.memoryPercent ?? 0} size={116} />
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums text-slate-50">{formatPercent(metrics.data?.memoryPercent)}</p>
              <p className="mt-2 text-sm text-slate-400">{formatGb(metrics.data?.memoryUsedGb, metrics.data?.memoryTotalGb)}</p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Resource</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-50">Disk usage</h3>
              <p className="mt-2 text-sm text-slate-400">Persistent storage utilisation on the host volume.</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-3 text-amber-200 shadow-dune">
              <HardDrive className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <ResourceGauge label="Disk" value={metrics.data?.diskPercent ?? 0} size={116} />
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums text-slate-50">{formatPercent(metrics.data?.diskPercent)}</p>
              <p className="mt-2 text-sm text-slate-400">{formatGb(metrics.data?.diskUsedGb, metrics.data?.diskTotalGb)}</p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-title">Throughput</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-50">Network pulse</h3>
              <p className="mt-2 text-sm text-slate-400">Live ingress and egress throughput over the selected window.</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-3 text-amber-300 shadow-dune">
              <Network className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Inbound</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-slate-50">{formatMbps(metrics.data?.networkInMbps)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Outbound</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-slate-50">{formatMbps(metrics.data?.networkOutMbps)}</p>
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
          series={[{ key: 'cpuPercent', label: 'CPU', color: '#f59e0b', unit: '%' }]}
        />
        <MetricsChart
          title="Memory pressure"
          description="Resident memory usage of the dashboard host."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="area"
          series={[{ key: 'memoryPercent', label: 'Memory', color: '#fb923c', unit: '%' }]}
        />
        <MetricsChart
          title="Disk activity"
          description="Persistent storage utilisation over the selected window."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="area"
          series={[{ key: 'diskPercent', label: 'Disk', color: '#fbbf24', unit: '%' }]}
        />
        <MetricsChart
          title="Network throughput"
          description="Inbound and outbound traffic through the gateway."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="line"
          series={[
            { key: 'networkInMbps', label: 'Inbound', color: '#f59e0b', unit: 'Mbps' },
            { key: 'networkOutMbps', label: 'Outbound', color: '#fdba74', unit: 'Mbps' },
          ]}
        />
      </section>
    </div>
  );
}
