'use client';

import { Activity, Clock3, Database, RefreshCcw, Server, ShieldCheck, Users } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { NetworkSparkline } from '@/components/NetworkSparkline';
import { ResourceGauge } from '@/components/ResourceGauge';
import { StatusCard } from '@/components/StatusCard';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

const readinessStyles = {
  ok: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  fail: 'border-red-500/20 bg-red-500/10 text-red-300',
};

function formatUptime(seconds = 0) {
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
}

export default function OverviewPage() {
  const status = useApi(() => apiClient.getStatus(), { refreshInterval: 15000 });
  const readiness = useApi(() => apiClient.getReady(), { refreshInterval: 20000 });
  const maps = useApi(() => apiClient.getMaps(), { refreshInterval: 20000 });
  const metrics = useApi(() => apiClient.getSystemMetrics(), { refreshInterval: 10000 });
  const resourceHistory = useApi(() => apiClient.getSystemHistory('1h'), { refreshInterval: 15000, initialData: { range: '1h', points: [] } });
  const uptime = useApi(() => apiClient.getUptimeData('24h'), {
    refreshInterval: 30000,
    initialData: { range: '24h', availabilityPercent: 0, totalUpSeconds: 0, totalDownSeconds: 0, events: [] },
  });

  const serviceSummary = useMemo(() => status.data?.services ?? [], [status.data?.services]);

  const handleRestartAll = useCallback(async () => {
    const currentMaps = maps.data ?? [];
    await Promise.all(currentMaps.filter((map) => map.status === 'running').map((map) => apiClient.restartMap(map.name)));
    await maps.refetch();
  }, [maps]);

  const handleBackupNow = useCallback(async () => {
    await apiClient.createBackup('full');
  }, []);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={Server} title="Server status" value={status.data?.status ?? 'loading'} subtitle={status.data?.serverName ?? 'Contacting cluster'} variant="default" />
        <StatusCard icon={Users} title="Players online" value={status.data?.playersOnline ?? 0} subtitle="Across active maps" variant="success">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
              <span>Network pulse</span>
              <span>{(metrics.data?.networkInMbps ?? 0).toFixed(2)} / {(metrics.data?.networkOutMbps ?? 0).toFixed(2)} Mbps</span>
            </div>
            <NetworkSparkline history={resourceHistory.data?.points ?? []} height={52} />
          </div>
        </StatusCard>
        <StatusCard icon={Activity} title="Resource overview" value={`${(metrics.data?.cpuPercent ?? 0).toFixed(0)}% / ${(metrics.data?.memoryPercent ?? 0).toFixed(0)}%`} subtitle="CPU / RAM live host load" variant="warning">
          <div className="grid grid-cols-3 gap-2">
            <ResourceGauge label="CPU" value={metrics.data?.cpuPercent ?? 0} size={76} />
            <ResourceGauge label="RAM" value={metrics.data?.memoryPercent ?? 0} size={76} />
            <ResourceGauge label="Disk" value={metrics.data?.diskPercent ?? 0} size={76} />
          </div>
        </StatusCard>
        <StatusCard icon={Clock3} title="Uptime" value={formatUptime(status.data?.uptimeSeconds)} subtitle="Gateway process">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.22em] text-amber-200/80">24h availability</span>
              <span className="text-lg font-semibold tabular-nums text-amber-100">{(uptime.data?.availabilityPercent ?? 0).toFixed(1)}%</span>
            </div>
            <p className="mt-2 text-slate-300">{uptime.data?.events.filter((event) => event.status !== 'up').length ?? 0} recent impacted windows</p>
          </div>
        </StatusCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="glass-panel p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="section-title">Service health matrix</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-50">Operational services</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleRestartAll()} className="dune-button-muted">
                <RefreshCcw className="mr-2 h-4 w-4" /> Restart all
              </button>
              <button type="button" onClick={() => void handleBackupNow()} className="dune-button">
                <Database className="mr-2 h-4 w-4" /> Backup now
              </button>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {serviceSummary.map((service) => (
              <div key={service.name} className="rounded-3xl border border-slate-800/80 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-100">{service.label ?? service.name}</h3>
                    <p className="mt-1 text-sm text-slate-400">{service.message ?? 'Monitoring in progress'}</p>
                  </div>
                  <span className={cn('h-3 w-3 rounded-full', service.status === 'healthy' ? 'bg-emerald-400' : service.status === 'completed' ? 'bg-sky-300' : service.status === 'degraded' ? 'bg-amber-400' : service.status === 'stopped' ? 'bg-slate-500' : 'bg-red-500')} />
                </div>
                <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
                  <span>Latency</span>
                  <span className="tabular-nums">{service.latencyMs ?? 0} ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className={cn('glass-panel p-5', readinessStyles[readiness.data?.status ?? 'warn'])}>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-950/40 p-3">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <p className="section-title">Readiness</p>
                <h2 className="mt-1 text-2xl font-semibold uppercase">{readiness.data?.status ?? 'warn'}</h2>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              {(readiness.data?.checks ?? []).map((check) => (
                <div key={check.name} className="flex items-start justify-between gap-3 rounded-2xl border border-white/5 bg-slate-950/25 px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-50">{check.name}</p>
                    {check.message ? <p className="mt-1 text-slate-300">{check.message}</p> : null}
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.18em]">{check.status}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-panel p-5">
            <p className="section-title">Fleet summary</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-50">Map deployment</h2>
            <div className="mt-5 space-y-3">
              {(maps.data ?? []).map((map) => (
                <div key={map.name} className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-900/50 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-100">{map.name}</p>
                    <p className="text-slate-400">{map.players} players • {map.memoryUsedMb} MB</p>
                  </div>
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">{map.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
