'use client';

import { Cpu, HardDrive, Network, Waves } from 'lucide-react';
import { useState } from 'react';

import { MetricsChart } from '@/components/MetricsChart';
import { StatusCard } from '@/components/StatusCard';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

export default function SystemPage() {
  const [range, setRange] = useState('1h');
  const metrics = useApi(() => apiClient.getSystemMetrics(), { refreshInterval: 10000 });
  const history = useApi(() => apiClient.getSystemHistory(range), { refreshInterval: 15000, initialData: { range, points: [] } });

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={Cpu} title="CPU" value={`${metrics.data?.cpuPercent ?? 0}%`} subtitle="Current processor load" variant="warning" />
        <StatusCard icon={Waves} title="RAM" value={`${metrics.data?.memoryPercent ?? 0}%`} subtitle={`${metrics.data?.memoryUsedGb ?? 0} / ${metrics.data?.memoryTotalGb ?? 0} GB`} variant="default" />
        <StatusCard icon={HardDrive} title="Disk" value={`${metrics.data?.diskPercent ?? 0}%`} subtitle={`${metrics.data?.diskUsedGb ?? 0} / ${metrics.data?.diskTotalGb ?? 0} GB`} variant="default" />
        <StatusCard icon={Network} title="Network" value={`${metrics.data?.networkInMbps ?? 0}/${metrics.data?.networkOutMbps ?? 0}`} subtitle="In / Out Mbps" variant="success" />
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <MetricsChart title="CPU load" description="Real-time compute pressure across the host." history={history.data?.points ?? []} selectedRange={range} onRangeChange={setRange} series={[{ key: 'cpuPercent', label: 'CPU', color: '#f59e0b', unit: '%' }]} />
        <MetricsChart title="Memory pressure" description="Resident memory usage of the dashboard host." history={history.data?.points ?? []} selectedRange={range} onRangeChange={setRange} series={[{ key: 'memoryPercent', label: 'Memory', color: '#fb923c', unit: '%' }]} />
        <MetricsChart title="Disk activity" description="Persistent storage utilisation over the selected window." history={history.data?.points ?? []} selectedRange={range} onRangeChange={setRange} series={[{ key: 'diskPercent', label: 'Disk', color: '#fbbf24', unit: '%' }]} />
        <MetricsChart title="Network throughput" description="Inbound and outbound traffic through the gateway." history={history.data?.points ?? []} selectedRange={range} onRangeChange={setRange} series={[{ key: 'networkInMbps', label: 'Inbound', color: '#f59e0b', unit: 'Mbps' }, { key: 'networkOutMbps', label: 'Outbound', color: '#fdba74', unit: 'Mbps' }]} />
      </section>
    </div>
  );
}
