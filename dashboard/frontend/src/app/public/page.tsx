'use client';

import { Activity, Clock3, Server, Shield, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

interface PublicStatus {
  serverName: string;
  status: 'online' | 'degraded' | 'offline' | 'unknown';
  playersOnline: number;
  maxPlayers: number;
  mapsActive: number;
  uptimeSeconds: number;
  version: string;
  region: string;
  lastUpdated: string;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const statusStyles = {
  online: { bg: 'bg-emerald-500', text: 'text-emerald-300', label: 'Online' },
  degraded: { bg: 'bg-amber-500', text: 'text-amber-300', label: 'Degraded' },
  offline: { bg: 'bg-red-500', text: 'text-red-300', label: 'Offline' },
  unknown: { bg: 'bg-slate-500', text: 'text-slate-300', label: 'Unknown' },
};

export default function PublicStatusPage() {
  const [data, setData] = useState<PublicStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/public/status', { cache: 'no-store' });
        if (!response.ok) {
          setError(true);
          return;
        }

        setData(await response.json());
        setError(false);
      } catch {
        setError(true);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const status = data?.status ?? 'unknown';
  const styles = statusStyles[status];

  return (
    <div className="min-h-screen bg-dune-radial">
      <div className="absolute inset-0 bg-dune-grid bg-[size:42px_42px] opacity-[0.08]" />
      <div className="relative mx-auto max-w-2xl px-4 py-16">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Dune Awakening</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-50">{data?.serverName ?? 'Server Status'}</h1>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-700/80 px-4 py-2">
            <span className={`h-3 w-3 rounded-full ${styles.bg} shadow-[0_0_12px_currentColor]`} />
            <span className={`font-semibold ${styles.text}`}>{styles.label}</span>
          </div>
          {error && <p className="mt-3 text-sm text-red-300">Unable to reach the public status endpoint.</p>}
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <div className="glass-panel px-6 py-7 text-center">
            <Users className="mx-auto h-7 w-7 text-amber-300" />
            <p className="mt-4 text-4xl font-bold tabular-nums text-slate-50">{data?.playersOnline ?? 0}</p>
            <p className="mt-2 text-sm font-medium text-slate-300">Players Online</p>
            {data?.maxPlayers != null && (
              <p className="mt-1 text-xs tabular-nums text-slate-500">of {data.maxPlayers} max</p>
            )}
          </div>
          <div className="glass-panel px-6 py-7 text-center">
            <Activity className="mx-auto h-7 w-7 text-amber-300" />
            <p className="mt-4 text-4xl font-bold tabular-nums text-slate-50">{data?.mapsActive ?? 0}</p>
            <p className="mt-2 text-sm font-medium text-slate-300">Active Maps</p>
          </div>
          <div className="glass-panel px-6 py-7 text-center">
            <Clock3 className="mx-auto h-7 w-7 text-amber-300" />
            <p className="mt-4 text-4xl font-bold tabular-nums text-slate-50">{data ? formatUptime(data.uptimeSeconds) : '--'}</p>
            <p className="mt-2 text-sm font-medium text-slate-300">Uptime</p>
          </div>
          <div className="glass-panel px-6 py-7 text-center">
            <Shield className="mx-auto h-7 w-7 text-amber-300" />
            <p className="mt-4 text-4xl font-bold tabular-nums text-slate-50">
              {status === 'online' ? '100%' : status === 'degraded' ? 'Partial' : '--'}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-300">Availability</p>
          </div>
        </div>

        <div className="mt-10 glass-panel p-6">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-amber-300" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Server Details</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 px-4 py-3">
              <p className="text-xs text-slate-500">Server Name</p>
              <p className="mt-1 text-sm font-medium text-slate-100">{data?.serverName ?? '--'}</p>
            </div>
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 px-4 py-3">
              <p className="text-xs text-slate-500">Max Players</p>
              <p className="mt-1 text-sm font-medium tabular-nums text-slate-100">{data?.maxPlayers ?? '--'}</p>
            </div>
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 px-4 py-3">
              <p className="text-xs text-slate-500">Active Maps</p>
              <p className="mt-1 text-sm font-medium tabular-nums text-slate-100">{data?.mapsActive ?? '--'}</p>
            </div>
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 px-4 py-3">
              <p className="text-xs text-slate-500">Region</p>
              <p className="mt-1 text-sm font-medium text-slate-100">{data?.region ?? '--'}</p>
            </div>
          </div>
        </div>

        <div className="mt-10 text-center text-xs text-slate-500">
          {data?.lastUpdated ? `Last updated: ${new Date(data.lastUpdated).toLocaleString()}` : ''}
          <p className="mt-2">Powered by Arrakis Command Nexus</p>
        </div>
      </div>
    </div>
  );
}
