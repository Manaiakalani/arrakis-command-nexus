'use client';

import { AlarmClock, Cpu, Download, HardDrive, Network, Pause, Play, Power, Server, ShieldOff, Waves, Wrench } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Skeleton } from '@/components/Skeleton';
import { ShutdownPanel } from '@/components/ShutdownPanel';
import { useToast } from '@/components/ToastProvider';
import { useApiSWR } from '@/hooks/useApiSWR';
import { apiClient } from '@/lib/api';
import type { RestartSchedule } from '@/lib/types';
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
const restartIntervals = [6, 12, 24, 48] as const;
const manualWarningOptions = [0, 1, 5, 15] as const;
const DEFAULT_RESTART_SCHEDULE: RestartSchedule = {
  enabled: false,
  intervalHours: 24,
  warningMinutes: [15, 5, 1],
  lastRestartAt: null,
  nextRestartAt: null,
};

function formatPercent(value?: number) {
  return `${(value ?? 0).toFixed(1)}%`;
}

function formatGb(used?: number, total?: number) {
  return `${(used ?? 0).toFixed(1)} / ${(total ?? 0).toFixed(1)} GB`;
}

function formatMbps(value?: number) {
  return `${(value ?? 0).toFixed(2)} Mbps`;
}

function formatDate(value?: string | null, fallback = 'Not scheduled') {
  return value ? new Date(value).toLocaleString() : fallback;
}

function formatCountdown(target?: string | null, now = Date.now()) {
  if (!target) {
    return 'Not scheduled';
  }

  const remainingMs = new Date(target).getTime() - now;
  if (remainingMs <= 0) {
    return 'Due now';
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [days > 0 ? `${days}d` : null, hours > 0 || days > 0 ? `${hours}h` : null, `${minutes}m`, `${seconds}s`].filter(Boolean);
  return parts.join(' ');
}

function parseWarningMinutes(value: string) {
  const rawParts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (rawParts.length === 0) {
    return [];
  }

  const parsed = rawParts.map((part) => Number(part));
  if (parsed.some((part) => !Number.isInteger(part) || part <= 0)) {
    throw new Error('Warning minutes must be a comma-separated list of positive whole numbers.');
  }

  return Array.from(new Set(parsed)).sort((left, right) => right - left);
}

export default function SystemPage() {
  const { toast } = useToast();
  const [range, setRange] = useState('1h');
  const [exportWidget, setExportWidget] = useState('all');
  const [exportFormat, setExportFormat] = useState('csv');
  const [schedule, setSchedule] = useState<RestartSchedule>(DEFAULT_RESTART_SCHEDULE);
  const [warningInput, setWarningInput] = useState(DEFAULT_RESTART_SCHEDULE.warningMinutes.join(', '));
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [manualWarningMinutes, setManualWarningMinutes] = useState(0);
  const [restartingNow, setRestartingNow] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ action: () => void; title: string; message: string; variant?: 'danger' | 'default' } | null>(null);
  const [stoppingServer, setStoppingServer] = useState(false);
  const [startingServer, setStartingServer] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceWarning, setMaintenanceWarning] = useState(5);
  const [activatingMaintenance, setActivatingMaintenance] = useState(false);
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const metrics = useApiSWR('api/system/metrics', () => apiClient.getSystemMetrics(), { refreshInterval: 10_000 });
  const history = useApiSWR(`api/system/history/${range}`, () => apiClient.getSystemHistory(range), { refreshInterval: 15_000, initialData: { range, points: [] } });
  const restartScheduleApi = useApiSWR('api/system/restart-schedule', () => apiClient.getRestartSchedule(), { refreshInterval: 15_000, initialData: DEFAULT_RESTART_SCHEDULE });

  useEffect(() => {
    if (!restartScheduleApi.data) {
      return;
    }
    setSchedule(restartScheduleApi.data);
    setWarningInput((restartScheduleApi.data.warningMinutes ?? []).join(', '));
  }, [restartScheduleApi.data]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const warningSummary = useMemo(() => (schedule.warningMinutes.length > 0 ? schedule.warningMinutes.join(', ') : 'No warnings'), [schedule.warningMinutes]);
  const nextRestartCountdown = useMemo(() => formatCountdown(schedule.nextRestartAt, countdownNow), [schedule.nextRestartAt, countdownNow]);
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
          <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Server aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Resource Overview</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={exportWidget}
            onChange={(e) => setExportWidget(e.target.value)}
            className="dune-input w-full sm:min-w-[160px] sm:w-auto"
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
            <Download aria-hidden="true" className="mr-2 h-4 w-4" /> Export metrics
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
              <Cpu aria-hidden="true" className="h-6 w-6" />
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
              <Waves aria-hidden="true" className="h-6 w-6" />
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
              <HardDrive aria-hidden="true" className="h-6 w-6" />
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
              <Network aria-hidden="true" className="h-6 w-6" />
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
          series={cpuSeries}
          yDomain={[0, 100]}
        />
        <MetricsChart
          title="Memory pressure"
          description="Resident memory usage of the dashboard host."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="area"
          series={memorySeries}
          yDomain={[0, 100]}
        />
        <MetricsChart
          title="Disk activity"
          description="Persistent storage utilisation over the selected window."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="area"
          series={diskSeries}
          yDomain={[0, 100]}
        />
        <MetricsChart
          title="Network throughput"
          description="Inbound and outbound traffic through the gateway."
          history={history.data?.points ?? []}
          selectedRange={range}
          onRangeChange={setRange}
          chartType="line"
          series={networkSeries}
        />
      </section>

      <section className="glass-panel p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="section-title">Server control</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Power aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Power management</h2>
            <p className="mt-2 text-sm text-th-text-m">Stop or start all game server containers (maps and infrastructure). The dashboard remains accessible.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <button
            type="button"
            disabled={stoppingServer || startingServer || restartingNow}
            className="flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-300 disabled:cursor-not-allowed disabled:opacity-60 dune-focus"
            onClick={async () => {
              setPendingConfirm({
                title: 'Stop Server',
                message: 'Stop ALL game server containers? Players will be disconnected.',
                variant: 'danger',
                action: async () => {
              setStoppingServer(true);
              try {
                const result = await apiClient.stopServer();
                const msg = result.status === 'ok'
                  ? `Stopped ${result.succeeded.length} services.`
                  : `Stopped ${result.succeeded.length} services with ${result.failed.length} errors.`;
                toast(msg, result.status === 'ok' ? 'success' : 'error');
              } catch (err) {
                toast(`Failed to stop server: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
              } finally {
                setStoppingServer(false);
              }
                },
              });
            }}
          >
            <Pause aria-hidden="true" className="h-4 w-4" />
            {stoppingServer ? 'Stopping…' : 'Stop server'}
          </button>
          <button
            type="button"
            disabled={stoppingServer || startingServer || restartingNow}
            className="flex items-center justify-center gap-2 rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm font-semibold text-green-700 transition-colors hover:bg-green-500/20 dark:text-green-300 disabled:cursor-not-allowed disabled:opacity-60 dune-focus"
            onClick={async () => {
              setPendingConfirm({
                title: 'Start Server',
                message: 'Start ALL game server containers?',
                action: async () => {
              setStartingServer(true);
              try {
                const result = await apiClient.startServer();
                const msg = result.status === 'ok'
                  ? `Started ${result.succeeded.length} services.`
                  : `Started ${result.succeeded.length} services with ${result.failed.length} errors.`;
                toast(msg, result.status === 'ok' ? 'success' : 'error');
              } catch (err) {
                toast(`Failed to start server: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
              } finally {
                setStartingServer(false);
              }
                },
              });
            }}
          >
            <Play aria-hidden="true" className="h-4 w-4" />
            {startingServer ? 'Starting…' : 'Start server'}
          </button>
          <button
            type="button"
            disabled={stoppingServer || startingServer || restartingNow}
            className="dune-button flex items-center justify-center gap-2"
            onClick={async () => {
              setPendingConfirm({
                title: 'Restart Server',
                message: 'Restart ALL game server containers? Players will be briefly disconnected.',
                action: async () => {
              setRestartingNow(true);
              try {
                const result = await apiClient.restartNow(0);
                const msg = result.status === 'failed' ? 'Restart failed.' : 'Server restart triggered.';
                toast(msg, result.status === 'failed' ? 'error' : 'success');
              } catch (err) {
                toast(`Failed to restart: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
              } finally {
                setRestartingNow(false);
              }
                },
              });
            }}
          >
            <Power aria-hidden="true" className="h-4 w-4" />
            {restartingNow ? 'Restarting…' : 'Restart server'}
          </button>
        </div>
      </section>

      {/* Maintenance mode */}
      <section className="glass-panel p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="section-title">Access control</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Wrench aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Maintenance mode</h2>
            <p className="mt-2 text-sm text-th-text-m">
              Send a warning announcement to all players, then gracefully prepare the server for maintenance.
              Uses the shutdown preparation pipeline with configurable warning time.
            </p>
          </div>
          <span className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-semibold uppercase', maintenanceMode ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300')}>
            {maintenanceMode ? 'Maintenance active' : 'Normal operation'}
          </span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-th-text">Warning time before maintenance</span>
            <select value={maintenanceWarning} onChange={(e) => setMaintenanceWarning(Number(e.target.value))} className="dune-input w-full" disabled={activatingMaintenance} aria-label="Maintenance warning minutes">
              <option value={0}>No warning</option>
              <option value={1}>1 minute</option>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
            </select>
          </label>
          <div className="flex items-end">
            {maintenanceMode ? (
              <button
                type="button"
                disabled={activatingMaintenance || startingServer}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 dune-focus"
                onClick={async () => {
                  setActivatingMaintenance(true);
                  try {
                    const result = await apiClient.startServer();
                    setMaintenanceMode(false);
                    toast(`Maintenance ended. Started ${result.succeeded.length} services.`, 'success');
                  } catch (err) {
                    toast(`Failed to exit maintenance: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
                  } finally {
                    setActivatingMaintenance(false);
                  }
                }}
              >
                <Play aria-hidden="true" className="h-4 w-4" />
                {activatingMaintenance ? 'Resuming…' : 'Exit Maintenance'}
              </button>
            ) : (
              <button
                type="button"
                disabled={activatingMaintenance || stoppingServer || restartingNow}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-200 disabled:cursor-not-allowed disabled:opacity-60 dune-focus"
                onClick={async () => {
                  const msg = maintenanceWarning > 0
                    ? `Enter maintenance mode with ${maintenanceWarning}-minute warning? Players will be notified and disconnected.`
                    : 'Enter maintenance mode immediately? Players will be disconnected.';
                  setPendingConfirm({
                    title: 'Maintenance Mode',
                    message: msg,
                    variant: 'danger',
                    action: async () => {
                  setActivatingMaintenance(true);
                  try {
                    await apiClient.prepareShutdown({
                      warning_minutes: maintenanceWarning,
                      skip_backup: false,
                      stop_game_servers: true,
                    });
                    setMaintenanceMode(true);
                    toast(`Maintenance mode activated${maintenanceWarning > 0 ? ` with ${maintenanceWarning}m warning` : ''}.`, 'success');
                  } catch (err) {
                    toast(`Failed to enter maintenance: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
                  } finally {
                    setActivatingMaintenance(false);
                  }
                    },
                  });
                }}
              >
                <ShieldOff aria-hidden="true" className="h-4 w-4" />
                {activatingMaintenance ? 'Activating…' : 'Enter maintenance mode'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="glass-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="section-title">Restart orchestration</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><AlarmClock aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Server restart schedule</h2>
            <p className="mt-2 text-sm text-th-text-m">Schedule automatic shard restarts, send player warnings, and capture a backup before services recycle.</p>
          </div>
          <label className="flex items-center gap-3 rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3 text-sm text-th-text-s">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(event) => {
                setScheduleMessage(null);
                setSchedule((current) => ({ ...current, enabled: event.target.checked }));
              }}
              className="h-4 w-4 rounded border-th-border bg-th-bg text-amber-500 focus:ring-amber-500"
            />
            <span>{schedule.enabled ? 'Automatic restarts enabled' : 'Automatic restarts disabled'}</span>
          </label>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Status</p>
            <p className="mt-2 text-lg font-semibold text-th-text">{schedule.enabled ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Interval</p>
            <p className="mt-2 text-lg font-semibold text-th-text">Every {schedule.intervalHours}h</p>
          </div>
          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Warnings</p>
            <p className="mt-2 text-lg font-semibold text-th-text">{warningSummary}</p>
          </div>
          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Countdown</p>
            <p className="mt-2 text-lg font-semibold text-th-text">{nextRestartCountdown}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.9fr]">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3 text-sm text-th-text-s">
              <span className="mb-2 block text-th-text">Interval (hours)</span>
              <select
                value={schedule.intervalHours}
                onChange={(event) => {
                  setScheduleMessage(null);
                  setSchedule((current) => ({ ...current, intervalHours: Number(event.target.value) }));
                }}
                className="dune-input"
              >
                {restartIntervals.map((interval) => (
                  <option key={interval} value={interval}>{interval} hours</option>
                ))}
              </select>
            </label>
            <label className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3 text-sm text-th-text-s">
              <span className="mb-2 block text-th-text">Warning minutes</span>
              <input
                className="dune-input"
                value={warningInput}
                onChange={(event) => {
                  setScheduleMessage(null);
                  setWarningInput(event.target.value);
                }}
                placeholder="15, 5, 1"
              />
            </label>
            <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s md:col-span-2">
              <div className="flex items-start gap-3">
                <AlarmClock aria-hidden="true" className="mt-0.5 h-5 w-5 text-amber-500" />
                <div>
                  <p className="font-medium text-th-text">Next scheduled restart</p>
                  <p className="mt-1 text-th-text-s">{formatDate(schedule.nextRestartAt)}</p>
                  <p className="mt-2 text-th-text-m">Last restart: {formatDate(schedule.lastRestartAt, 'Never')}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-600 dark:text-amber-300">
                <Power aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-th-text">Manual restart</p>
                <p className="text-th-text-m">Optional warning countdown before restarting all detected map services.</p>
              </div>
            </div>
            <label className="mt-4 block">
              <span className="mb-2 block text-th-text">Warning before restart</span>
              <select
                value={manualWarningMinutes}
                onChange={(event) => setManualWarningMinutes(Number(event.target.value))}
                className="dune-input"
              >
                {manualWarningOptions.map((value) => (
                  <option key={value} value={value}>{value === 0 ? 'No warning' : `${value} minute${value === 1 ? '' : 's'}`}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={restartingNow}
              className="dune-button mt-4 w-full disabled:cursor-not-allowed disabled:opacity-60"
              onClick={async () => {
                setPendingConfirm({
                  title: 'Restart Map Services',
                  message: manualWarningMinutes > 0
                    ? `Send a ${manualWarningMinutes}-minute warning, create a backup, and restart all map services?`
                    : 'Create a backup and restart all map services now?',
                  action: async () => {
                setRestartingNow(true);
                try {
                  const result = await apiClient.restartNow(manualWarningMinutes);
                  await restartScheduleApi.refetch();
                  const baseMessage = result.scheduled
                    ? `Restart scheduled for ${formatDate(result.restartAt, 'soon')}.`
                    : result.status === 'partial'
                      ? 'Restart completed with warnings.'
                      : 'Server restart triggered successfully.';
                  const detail = result.backupError ? ` Backup warning: ${result.backupError}` : '';
                  toast(`${baseMessage}${detail}`, result.status === 'failed' ? 'error' : 'success');
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Restart failed.';
                  toast(`Failed to restart server: ${message}`, 'error');
                } finally {
                  setRestartingNow(false);
                }
                  },
                });
              }}
            >
              <Power aria-hidden="true" className="mr-2 h-4 w-4" />
              {restartingNow ? 'Restarting…' : 'Restart server now'}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-th-text-m">{scheduleMessage ?? 'Changes are applied immediately and persisted for the next backend start.'}</p>
          <button
            type="button"
            className="dune-button"
            disabled={savingSchedule}
            onClick={async () => {
              setSavingSchedule(true);
              try {
                const warningMinutes = parseWarningMinutes(warningInput);
                const updated = await apiClient.updateRestartSchedule({
                  enabled: schedule.enabled,
                  intervalHours: schedule.intervalHours,
                  warningMinutes,
                });
                restartScheduleApi.setData(updated);
                setSchedule(updated);
                setWarningInput(updated.warningMinutes.join(', '));
                setScheduleMessage('Restart schedule saved.');
                toast('Restart schedule saved.', 'success');
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to save restart schedule.';
                setScheduleMessage(message);
                toast(`Failed to save restart schedule: ${message}`, 'error');
              } finally {
                setSavingSchedule(false);
              }
            }}
          >
            {savingSchedule ? 'Saving…' : 'Save restart schedule'}
          </button>
        </div>
      </section>

      <ShutdownPanel />
      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        confirmLabel="Confirm"
        variant={pendingConfirm?.variant}
        onConfirm={() => { pendingConfirm?.action(); setPendingConfirm(null); }}
        onCancel={() => setPendingConfirm(null)}
      />
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
