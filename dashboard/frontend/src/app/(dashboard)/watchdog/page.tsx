'use client';

import { Activity, RefreshCcw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

export default function WatchdogPage() {
  const [restarting, setRestarting] = useState<string | null>(null);
  const status = useApi(() => apiClient.getWatchdogStatus(), {
    refreshInterval: 15000,
    initialData: { enabled: false, autoRestart: true, intervalSeconds: 30, monitoredContainers: 0 },
  });
  const crashes = useApi(() => apiClient.getWatchdogCrashes(), { refreshInterval: 15000, initialData: [] });
  const maps = useApi(() => apiClient.getMaps(), { refreshInterval: 20000, initialData: [] });

  const services = useMemo(() => [...new Set((maps.data ?? []).map((map) => map.name))].sort(), [maps.data]);

  const handleRestart = async (service: string) => {
    setRestarting(service);
    try {
      await apiClient.restartService(service);
      await Promise.all([crashes.refetch(), maps.refetch(), status.refetch()]);
    } finally {
      setRestarting(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="glass-panel p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-300">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <p className="section-title">Watchdog state</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-50">{status.data?.enabled ? 'Enabled' : 'Disabled'}</h2>
            </div>
          </div>
        </div>
        <div className="glass-panel p-5">
          <p className="section-title">Monitored containers</p>
          <h2 className="mt-1 text-3xl font-semibold text-slate-50">{status.data?.monitoredContainers ?? 0}</h2>
          <p className="mt-2 text-sm text-slate-400">Active map services under supervision.</p>
        </div>
        <div className="glass-panel p-5">
          <p className="section-title">Auto restart</p>
          <h2 className="mt-1 text-3xl font-semibold text-slate-50">{status.data?.autoRestart ? 'On' : 'Off'}</h2>
          <p className="mt-2 text-sm text-slate-400">Crashes trigger automatic recovery when enabled.</p>
        </div>
        <div className="glass-panel p-5">
          <p className="section-title">Poll interval</p>
          <h2 className="mt-1 text-3xl font-semibold text-slate-50">{status.data?.intervalSeconds ?? 0}s</h2>
          <p className="mt-2 text-sm text-slate-400">Docker crash checks cadence.</p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="glass-panel p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-sky-500/10 p-3 text-sky-300">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <p className="section-title">Manual recovery</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-50">Restart monitored services</h2>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {services.map((service) => (
              <div key={service} className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-900/50 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-100">{service}</p>
                  <p className="text-sm text-slate-400">Manual restart through watchdog controls.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRestart(service)}
                  disabled={restarting === service}
                  className="dune-button-muted px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCcw className="mr-2 inline h-4 w-4" />
                  {restarting === service ? 'Restarting\u2026' : 'Restart'}
                </button>
              </div>
            ))}
            {services.length === 0 ? <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-6 text-sm text-slate-400">No monitored map services detected.</div> : null}
          </div>
        </div>

        <div className="glass-panel overflow-hidden">
          <div className="border-b border-slate-800/80 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-red-500/10 p-3 text-red-300">
                <TriangleAlert className="h-6 w-6" />
              </div>
              <div>
                <p className="section-title">Crash history</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-50">Last 100 watchdog events</h2>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead className="bg-slate-950/40 text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Exit Code</th>
                  <th className="px-4 py-3 font-medium">Restarted</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {(crashes.data ?? []).map((event) => (
                  <tr key={`${event.service}-${event.timestamp}-${event.message}`} className="bg-slate-950/10">
                    <td className="px-4 py-4 text-slate-300">{new Date(event.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-4 font-medium text-slate-100">{event.service}</td>
                    <td className="px-4 py-4 text-slate-300">{event.exitCode ?? '—'}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${event.restarted ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border border-slate-700 bg-slate-900/60 text-slate-300'}`}>
                        {event.restarted ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-300">{event.message}</td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => void handleRestart(event.service)}
                        disabled={restarting === event.service}
                        className="dune-button-muted px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Restart
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(crashes.data ?? []).length === 0 ? <div className="p-10 text-center text-slate-400">No crash events recorded.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
