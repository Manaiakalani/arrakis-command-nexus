'use client';

import { Activity, AlertTriangle, Check, Clock3, Cpu, Database, HardDrive, LayoutDashboard, Map, Play, RefreshCcw, Server, ShieldCheck, Square, Users, Zap } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';

import { ResourceGauge } from '@/components/ResourceGauge';
import { StatusCard } from '@/components/StatusCard';
import { useToast } from '@/components/ToastProvider';
import useSWR from 'swr';
import { useDashboardSSE } from '@/hooks/useDashboardSSE';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

const readinessStyles = {
  ok: 'border-emerald-500/20 bg-emerald-500/10 text-th-accent-success',
  warn: 'border-amber-500/20 bg-amber-500/10 text-th-accent',
  fail: 'border-red-500/20 bg-red-500/10 text-th-accent-danger',
};

const emptySystemHistory = { range: '1h', points: [] };
const emptyUptimeData = { range: '24h', availabilityPercent: 0, totalUpSeconds: 0, totalDownSeconds: 0, events: [] };

const NetworkSparkline = dynamic(() => import('@/components/NetworkSparkline').then((mod) => mod.NetworkSparkline), {
  ssr: false,
  loading: () => <div className="h-14 animate-pulse rounded-xl bg-th-surface/50" />,
});

function formatUptime(seconds = 0) {
  const totalMins = Math.floor(seconds / 60);
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${totalMins}m`;
}

export default function OverviewPage() {
  const { toast } = useToast();
  const { data: overviewData, error: overviewError, isLoading: overviewLoading, mutate: overviewMutate } = useSWR('api/overview', () => apiClient.getOverview(), { refreshInterval: 30_000 });
  // SSE real-time updates — merges into overview state, polling is fallback
  const handleSSEUpdate = useCallback(
    (patch: Partial<NonNullable<typeof overviewData>>) => {
      void overviewMutate((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (patch.status) {
          next.status = { ...prev.status, ...patch.status };
        }
        if (patch.maps) next.maps = patch.maps;
        if (patch.metrics) next.metrics = patch.metrics;
        if (patch.readiness) next.readiness = patch.readiness;
        return next;
      }, { revalidate: false });
    },
    [overviewMutate],
  );

  const sseToken = typeof window !== 'undefined'
    ? document.cookie.match(/admin[_-]?token=([^;]+)/)?.[1]
      ?? (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_ADMIN_TOKEN : undefined)
      ?? ''
    : '';

  const { sseStatus } = useDashboardSSE({
    enabled: !!overviewData,
    token: sseToken,
    onUpdate: handleSSEUpdate,
  });


  const refetchOverview = useCallback(async () => { await overviewMutate(); }, [overviewMutate]);
  const status = useMemo(() => ({ data: overviewData?.status, loading: overviewLoading, error: overviewError, refetch: refetchOverview }), [overviewData?.status, overviewLoading, overviewError, refetchOverview]);
  const readiness = useMemo(() => ({ data: overviewData?.readiness }), [overviewData?.readiness]);
  const maps = useMemo(() => ({ data: overviewData?.maps, refetch: refetchOverview }), [overviewData?.maps, refetchOverview]);
  const metrics = useMemo(() => ({ data: overviewData?.metrics }), [overviewData?.metrics]);
  const resourceHistory = useMemo(() => ({ data: overviewData?.systemHistory ?? emptySystemHistory }), [overviewData?.systemHistory]);
  const uptime = useMemo(() => ({ data: overviewData?.uptime ?? emptyUptimeData }), [overviewData?.uptime]);
  const backups = useMemo(() => ({ data: overviewData?.backups ?? [] }), [overviewData?.backups]);

  const serviceSummary = useMemo(() => status.data?.services ?? [], [status.data?.services]);

  const [busyService, setBusyService] = useState<string | null>(null);

  const handleServiceAction = useCallback(async (name: string, action: 'start' | 'stop' | 'restart') => {
    setBusyService(name);
    try {
      if (action === 'start') await apiClient.startService(name);
      else if (action === 'stop') await apiClient.stopService(name);
      else await apiClient.restartServiceDirect(name);
      await status.refetch();
      toast(`${name}: ${action} successful`, 'success');
    } catch (err) {
      toast(`${name}: ${action} failed${err instanceof Error ? ` - ${err.message}` : ''}`, 'error');
    } finally {
      setBusyService(null);
    }
  }, [status, toast]);

  const handleDirectorNudge = useCallback(async () => {
    // The backend only accepts real container names (e.g. "dune-awakening-director-1"),
    // not the short role key "director", so resolve it from the loaded service list —
    // the same way the per-service action buttons below do via `service.name`.
    const directorService = serviceSummary.find((service) => service.name.toLowerCase().includes('director'));
    if (!directorService) {
      toast('Director nudge failed - director container not found', 'error');
      return;
    }
    try {
      await apiClient.restartServiceDirect(directorService.name);
      await status.refetch();
      toast('Director restarted — FLS declarations will re-fire within 60 s', 'success');
    } catch (err) {
      toast(`Director nudge failed${err instanceof Error ? ` - ${err.message}` : ''}`, 'error');
    }
  }, [serviceSummary, status, toast]);

  const handleRestartAll = useCallback(async () => {
    try {
      const currentMaps = maps.data ?? [];
      await Promise.all(currentMaps.filter((map) => map.status === 'running').map((map) => apiClient.restartMap(map.name)));
      await maps.refetch();
      toast('All shards restarting', 'success');
    } catch (err) {
      toast(`Restart all failed${err instanceof Error ? ` - ${err.message}` : ''}`, 'error');
    }
  }, [maps, toast]);

  const handleBackupNow = useCallback(async () => {
    try {
      await apiClient.createBackup('full');
      toast('Backup started', 'success');
    } catch (err) {
      toast(`Backup failed${err instanceof Error ? ` - ${err.message}` : ''}`, 'error');
    }
  }, [toast]);

  return (
    <div className="space-y-6">
      {overviewError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-th-accent-danger">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <h3 className="font-semibold">Failed to load overview data</h3>
              <p className="text-sm opacity-90">{overviewError.message}</p>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-amber-500/15 p-3 text-th-accent">
          <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="section-title">Overview</p>
          <h1 className="mt-1 text-2xl font-semibold text-th-text">Dashboard overview</h1>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={Server} title="Server status" value={status.data?.status ?? 'Loading…'} subtitle={status.data?.serverName ?? 'Contacting cluster'} variant="default" />
        <StatusCard icon={Users} title="Players online" value={status.data?.playersOnline ?? 0} subtitle="Across active maps" variant="success">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-th-text-m">
              <span>Network pulse</span>
              <span>{(metrics.data?.networkInMbps ?? 0).toFixed(2)} / {(metrics.data?.networkOutMbps ?? 0).toFixed(2)} Mbps</span>
            </div>
            <NetworkSparkline history={resourceHistory.data?.points ?? []} height={52} />
          </div>
        </StatusCard>
        <StatusCard icon={Activity} title="Resource overview" value="Live host load" subtitle="CPU, memory, and disk utilization" variant="warning">
          <div className="grid grid-cols-3 gap-4">
            <ResourceGauge label="CPU" value={metrics.data?.cpuPercent ?? 0} size={88} />
            <ResourceGauge label="RAM" value={metrics.data?.memoryPercent ?? 0} size={88} />
            <ResourceGauge label="Disk" value={metrics.data?.diskPercent ?? 0} size={88} />
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-th-border/30 dark:border-white/5 bg-th-bg/30 px-3 py-2 text-xs text-th-text-m">
            <span>{(metrics.data?.memoryUsedGb ?? 0).toFixed(1)} / {(metrics.data?.memoryTotalGb ?? 0).toFixed(0)} GB RAM</span>
            <span>{(metrics.data?.diskUsedGb ?? 0).toFixed(0)} / {(metrics.data?.diskTotalGb ?? 0).toFixed(0)} GB disk</span>
          </div>
        </StatusCard>
        <StatusCard icon={Clock3} title="Stack uptime" value={formatUptime(status.data?.uptimeSeconds)} subtitle="Since earliest game-server start">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.22em] text-amber-600/80 dark:text-amber-200/80">24h availability</span>
              <span className="text-lg font-semibold tabular-nums text-amber-800 dark:text-amber-100">{(uptime.data?.availabilityPercent ?? 0).toFixed(1)}%</span>
            </div>
            <p className="mt-2 text-th-text-s">{uptime.data?.events.filter((event) => event.status !== 'up').length ?? 0} recent impacted windows</p>
          </div>
        </StatusCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="glass-panel p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="section-title">Service health matrix</p>
              <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Activity aria-hidden="true" className="h-5 w-5 text-th-accent" /> Operational services</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleDirectorNudge()}
                title="Restart only the Director to force FLS re-declaration. Use if the server is not appearing in the in-game Experimental browser."
                className="dune-button-muted"
              >
                <Zap aria-hidden="true" className="mr-2 h-4 w-4" /> Director nudge
              </button>
              <button type="button" onClick={() => void handleRestartAll()} className="dune-button-muted">
                <RefreshCcw aria-hidden="true" className="mr-2 h-4 w-4" /> Restart all
              </button>
              <button type="button" onClick={() => void handleBackupNow()} className="dune-button">
                <Database aria-hidden="true" className="mr-2 h-4 w-4" /> Backup now
              </button>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {serviceSummary.map((service) => {
              const isRunning = service.status === 'healthy';
              const isCompleted = service.status === 'completed';
              const isInit = !!service.isInit;
              const isBusy = busyService === service.name;
              const hasLatency = (service.latencyMs ?? 0) > 0;
              const showCheck = isRunning || (isCompleted && isInit);

              const borderClass = showCheck
                ? 'border-emerald-500/15'
                : service.status === 'degraded'
                  ? 'border-amber-500/15'
                  : service.status === 'offline'
                    ? 'border-red-500/15'
                    : 'border-th-border-m/80';

              const dotClass = isRunning
                ? 'bg-emerald-400'
                : service.status === 'degraded'
                  ? 'bg-amber-400'
                  : service.status === 'stopped'
                    ? 'bg-slate-500'
                    : 'bg-red-500';

              return (
                <div key={service.name} className={cn('rounded-3xl border bg-th-surface-s/50 p-4', borderClass)}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-th-text">{service.label ?? service.name}</h3>
                      <p className="mt-1 text-sm text-th-text-m">{service.message ?? 'Monitoring in progress'}</p>
                    </div>
                    {showCheck ? (
                      <span className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                        <Check aria-hidden="true" className="h-3 w-3 text-emerald-400" />
                      </span>
                    ) : (
                      <span className={cn('ml-2 h-3 w-3 shrink-0 rounded-full', dotClass)} />
                    )}
                  </div>
                  {isCompleted && isInit ? (
                    <p className="mt-3 text-xs text-emerald-400/70">One-shot task, no actions needed</p>
                  ) : (
                    <>
                      {hasLatency && (
                        <div className="mt-3 flex items-center justify-between text-sm text-th-text-m">
                          <span>Health check</span>
                          <span className="tabular-nums">{service.latencyMs} ms</span>
                        </div>
                      )}
                      <div className={cn('flex items-center gap-2', hasLatency ? 'mt-3 border-t border-th-border-m/60 pt-3' : 'mt-3')}>
                        {isRunning ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleServiceAction(service.name, 'restart')}
                              aria-label={`Restart ${service.label ?? service.name}`}
                              className="dune-focus flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-th-border/60 bg-th-surface/60 px-2.5 py-1.5 text-xs text-th-text-s transition hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-200 disabled:opacity-40"
                            >
                              <RefreshCcw aria-hidden="true" className={cn('h-3 w-3', isBusy && 'animate-spin')} /> Restart
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleServiceAction(service.name, 'stop')}
                              aria-label={`Stop ${service.label ?? service.name}`}
                              className="dune-focus flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-th-border/60 bg-th-surface/60 px-2.5 py-1.5 text-xs text-th-text-s transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-40"
                            >
                              <Square aria-hidden="true" className="h-3 w-3" /> Stop
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleServiceAction(service.name, 'start')}
                            aria-label={`Start ${service.label ?? service.name}`}
                            className="dune-focus flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-th-border/60 bg-th-surface/60 px-2.5 py-1.5 text-xs text-th-text-s transition hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-40"
                          >
                            <Play aria-hidden="true" className="h-3 w-3" /> Start
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className={cn('glass-panel p-5', readinessStyles[readiness.data?.status ?? 'warn'])}>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-th-bg/40 p-3">
                <ShieldCheck aria-hidden="true" className="h-6 w-6" />
              </div>
              <div>
                <p className="section-title">Readiness</p>
                <h2 className="mt-1 text-2xl font-semibold uppercase">{readiness.data?.status ?? 'warn'}</h2>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              {(readiness.data?.checks ?? []).map((check) => (
                <div key={check.name} className="flex items-start justify-between gap-3 rounded-2xl border border-th-border/30 dark:border-white/5 bg-th-bg/25 px-4 py-3">
                  <div>
                    <p className="font-medium text-th-text">{check.name}</p>
                    {check.message ? <p className="mt-1 text-th-text-s">{check.message}</p> : null}
                  </div>
                  <span className="rounded-full border border-th-border/40 dark:border-white/10 px-3 py-1 text-xs uppercase tracking-[0.18em]">{check.status}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-panel p-5">
            <p className="section-title">Fleet summary</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Map aria-hidden="true" className="h-5 w-5 text-th-accent" /> Map deployment</h2>
            <div className="mt-5 space-y-3">
              {(maps.data ?? []).map((map) => (
                <div key={map.name} className="flex items-center justify-between rounded-2xl border border-th-border-m/80 bg-th-surface-s/50 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-th-text">{map.name}</p>
                    <p className="text-th-text-m">{map.players} players • {map.memoryUsedMb} MB</p>
                  </div>
                  <span className="rounded-full border border-th-border px-3 py-1 text-xs uppercase tracking-[0.18em] text-th-text-s">{map.status}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-panel p-5">
            <p className="section-title">Data protection</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Database aria-hidden="true" className="h-5 w-5 text-th-accent" /> Last Backup</h2>
            {(() => {
              const lastBackup = (backups.data ?? []).filter((b) => b.status === 'ready').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
              if (!lastBackup) {
                return <p className="mt-3 text-sm text-th-text-m">No backups recorded yet.</p>;
              }
              const age = Date.now() - new Date(lastBackup.createdAt).getTime();
              const hoursAgo = Math.floor(age / 3600000);
              const isStale = hoursAgo > 24;
              return (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-th-text-m">Status</span>
                    <span className={cn('rounded-full border px-3 py-0.5 text-xs font-semibold uppercase', isStale ? 'border-amber-500/30 bg-amber-500/10 text-th-accent' : 'border-emerald-500/30 bg-emerald-500/10 text-th-accent-success')}>
                      {isStale ? 'Stale' : 'Current'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-th-text-m">Scope</span>
                    <span className="text-th-text">{lastBackup.scope}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-th-text-m">Created</span>
                    <span className="text-th-text">{hoursAgo < 1 ? 'Just now' : `${hoursAgo}h ago`}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-th-text-m">Size</span>
                    <span className="tabular-nums text-th-text">{(lastBackup.sizeBytes / 1048576).toFixed(1)} MB</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* Per-shard monitoring */}
      <section className="glass-panel p-5">
        <p className="section-title">Map telemetry</p>
        <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><HardDrive aria-hidden="true" className="h-5 w-5 text-th-accent" /> Map Servers</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(maps.data ?? []).map((map) => {
            const memPercent = map.memoryLimitMb > 0 ? Math.round((map.memoryUsedMb / map.memoryLimitMb) * 100) : 0;
            const isRunning = map.status === 'running';
            return (
              <div key={map.name} className={cn('rounded-2xl border p-4', isRunning ? 'border-emerald-500/15 bg-th-surface-s/50' : 'border-th-border-m/80 bg-th-surface-s/30')}>
                <div className="flex items-center justify-between">
                  <h3 className="truncate font-semibold text-th-text">{map.name}</h3>
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', isRunning ? 'bg-emerald-400' : 'bg-slate-500')} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="flex items-center justify-center gap-1 text-th-text-m">
                      <Cpu aria-hidden="true" className="h-3 w-3" />
                      <span className="text-[10px] uppercase tracking-wider">CPU</span>
                    </div>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-th-text">{(map.cpuPercent ?? 0).toFixed(0)}%</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1 text-th-text-m">
                      <Server aria-hidden="true" className="h-3 w-3" />
                      <span className="text-[10px] uppercase tracking-wider">RAM</span>
                    </div>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-th-text">{memPercent}%</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1 text-th-text-m">
                      <Clock3 aria-hidden="true" className="h-3 w-3" />
                      <span className="text-[10px] uppercase tracking-wider">Up</span>
                    </div>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-th-text">{formatUptime(map.uptimeSeconds)}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-th-text-m">
                    <span>{map.memoryUsedMb} MB / {map.memoryLimitMb} MB</span>
                    <span>{map.players} players</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-th-surface-s/80">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400" style={{ width: `${Math.min(memPercent, 100)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
