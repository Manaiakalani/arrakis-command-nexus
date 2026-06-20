'use client';

import { AlertTriangle, Clock, RefreshCcw, Server, ShieldAlert, Zap } from 'lucide-react';
import { useMemo } from 'react';

import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function IncidentsPage() {
  const { toast } = useToast();
  const crashes = useApi(() => apiClient.getWatchdogCrashes(), { refreshInterval: 15000, initialData: [] });
  const watchdog = useApi(() => apiClient.getWatchdogStatus(), { refreshInterval: 15000 });

  const incidents = useMemo(() => {
    const events = (crashes.data ?? []).map((crash) => ({
      id: `${crash.service}-${crash.timestamp}`,
      type: crash.restarted ? 'restart' as const : crash.exitCode ? 'crash' as const : 'alert' as const,
      service: crash.service,
      message: crash.message,
      timestamp: crash.timestamp,
      exitCode: crash.exitCode,
      restarted: crash.restarted,
    }));
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [crashes.data]);

  const stats = useMemo(() => {
    const now = Date.now();
    const last24h = incidents.filter((e) => now - new Date(e.timestamp).getTime() < 86400000);
    return {
      total: incidents.length,
      crashes: last24h.filter((e) => e.type === 'crash').length,
      restarts: last24h.filter((e) => e.type === 'restart').length,
      alerts: last24h.filter((e) => e.type === 'alert').length,
    };
  }, [incidents]);

  const handleRestart = async (service: string) => {
    try {
      await apiClient.restartService(service);
      toast(`${service} restarted`, 'success');
      await crashes.refetch();
    } catch (err) {
      toast(`Failed to restart ${service}: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  };

  const isLoading = crashes.loading && crashes.data?.length === 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-red-500/15 p-3 text-red-600 dark:text-red-300">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="section-title">Incident response</p>
          <h1 className="mt-1 text-2xl font-semibold text-th-text">Incident Center</h1>
        </div>
      </div>

      {/* Status bar */}
      <div className="glass-panel flex flex-wrap items-center gap-4 p-4">
        <span className="text-sm text-th-text-m">Watchdog:</span>
        <span className={cn('rounded-full border px-3 py-0.5 text-xs font-semibold uppercase', watchdog.data?.enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300')}>
          {watchdog.data?.enabled ? 'Active' : 'Disabled'}
        </span>
        <span className="text-sm text-th-text-m">Auto-restart: {watchdog.data?.autoRestart ? 'On' : 'Off'}</span>
        <span className="text-sm text-th-text-m">Monitoring {watchdog.data?.monitoredContainers ?? 0} containers</span>
      </div>

      {/* 24h stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-panel p-5">
          <div className="flex items-center gap-3">
            <AlertTriangle aria-hidden="true" className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Crashes (24h)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-th-text">{stats.crashes}</p>
            </div>
          </div>
        </div>
        <div className="glass-panel p-5">
          <div className="flex items-center gap-3">
            <RefreshCcw aria-hidden="true" className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Auto-restarts (24h)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-th-text">{stats.restarts}</p>
            </div>
          </div>
        </div>
        <div className="glass-panel p-5">
          <div className="flex items-center gap-3">
            <Zap aria-hidden="true" className="h-5 w-5 text-sky-500" />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Alerts (24h)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-th-text">{stats.alerts}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Incident timeline */}
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-5">
          <p className="section-title">Event timeline</p>
          <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Clock aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Recent Incidents</h2>
        </div>
        <div className="divide-y divide-th-border-m/80">
          {incidents.length > 0 ? (
            incidents.slice(0, 50).map((event) => (
              <div key={event.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    event.type === 'crash' ? 'bg-red-500/15 text-red-500' : event.type === 'restart' ? 'bg-amber-500/15 text-amber-500' : 'bg-sky-500/15 text-sky-500',
                  )}>
                    {event.type === 'crash' ? <AlertTriangle className="h-4 w-4" /> : event.type === 'restart' ? <RefreshCcw className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        event.type === 'crash' ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' : event.type === 'restart' ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200' : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
                      )}>
                        {event.type}
                      </span>
                      <span className="font-semibold text-th-text">{event.service}</span>
                      {event.exitCode != null && <span className="text-xs text-th-text-m">exit {event.exitCode}</span>}
                    </div>
                    <p className="mt-1 text-sm text-th-text-m">{event.message}</p>
                    <p className="mt-1 text-xs text-th-text-m">{timeAgo(event.timestamp)} — {new Date(event.timestamp).toLocaleString()}</p>
                  </div>
                </div>
                <button type="button" onClick={() => void handleRestart(event.service)} className="dune-button-muted shrink-0 text-sm">
                  <RefreshCcw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" /> Restart
                </button>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <Server aria-hidden="true" className="h-8 w-8 text-emerald-400" />
              <p className="text-th-text-m">No incidents recorded. All systems operational.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
