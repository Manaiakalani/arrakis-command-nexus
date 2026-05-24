'use client';

import { Ban, Download, LocateFixed, ShieldAlert, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { HaggaBasinMap } from '@/components/HaggaBasinMap';
import { PlayerHeatmap } from '@/components/PlayerHeatmap';
import { PlayerTable } from '@/components/PlayerTable';
import { Skeleton, TableSkeleton } from '@/components/Skeleton';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { ConnectionLogEntry, Player } from '@/lib/types';
import { cn } from '@/lib/utils';

const tabs = ['online', 'banned', 'history', 'allowlist'] as const;

type KickStatus = {
  tone: 'success' | 'error';
  message: string;
};

export default function PlayersPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('online');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [reason, setReason] = useState('Rule violation');
  const [duration, setDuration] = useState('24');
  const [kickStatus, setKickStatus] = useState<KickStatus | null>(null);
  const players = useApi(() => apiClient.getPlayers(), { refreshInterval: 10000, initialData: [] });
  const playerPositions = useApi(() => apiClient.getPlayerPositions(), { refreshInterval: 10000, initialData: [] });
  const bans = useApi(() => apiClient.getBans(), { refreshInterval: 15000, initialData: [] });
  const connections = useApi(() => apiClient.getConnectionHistory(), { refreshInterval: 30000, initialData: [] });

  useEffect(() => {
    if (!kickStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => setKickStatus(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [kickStatus]);

  const handleBan = async () => {
    if (!selectedPlayer) {
      return;
    }

    await apiClient.banPlayer(selectedPlayer.steamId, reason, duration ? Number(duration) : undefined);
    setSelectedPlayer(null);
    await Promise.all([players.refetch(), playerPositions.refetch(), bans.refetch()]);
  };

  const handleKick = async (player: Player) => {
    try {
      const response = await apiClient.kickPlayer(player.steamId);
      setKickStatus({ tone: response.status === 'ok' ? 'success' : 'error', message: response.message });
      await Promise.all([players.refetch(), playerPositions.refetch()]);
    } catch (error) {
      setKickStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : `Failed to kick ${player.steamId}`,
      });
    }
  };

  const isLoading = players.loading || playerPositions.loading || bans.loading;

  if (isLoading) {
    return <PlayersPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-full border px-4 py-2 text-sm font-medium capitalize transition-[color,background-color,border-color] dune-focus',
              activeTab === tab ? 'border-amber-500/40 bg-amber-500/15 text-amber-200' : 'border-th-border bg-th-surface-s/70 text-th-text-m',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {kickStatus ? (
        <div
          className={cn(
            'rounded-3xl border px-4 py-3 text-sm',
            kickStatus.tone === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200',
          )}
        >
          {kickStatus.message}
        </div>
      ) : null}

      {activeTab === 'online' ? (
        <>
          <PlayerTable players={players.data ?? []} onBan={setSelectedPlayer} onKick={(player) => void handleKick(player)} />
          <div className="glass-panel overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-th-border-m/80 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="section-title">Spatial telemetry</p>
                <h2 className="mt-1 text-xl font-semibold text-th-text">Live Player Position Analysis</h2>
                <p className="mt-2 text-sm text-th-text-m">Hagga Basin tactical overlay and density heatmap.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
                  <LocateFixed className="h-4 w-4" /> {(playerPositions.data ?? []).length} tracked
                </span>
              </div>
            </div>
            <div className="space-y-5 p-5">
              <HaggaBasinMap players={playerPositions.data ?? []} refreshIntervalMs={0} />
              <PlayerHeatmap players={playerPositions.data ?? []} refreshIntervalMs={0} />
            </div>
          </div>
        </>
      ) : null}

      {activeTab === 'banned' ? (
        <div className="glass-panel overflow-hidden">
          <div className="border-b border-th-border-m/80 p-5">
            <p className="section-title">Enforcement</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Banned Players</h2>
          </div>
          <div className="divide-y divide-th-border-m/80">
            {(bans.data ?? []).map((entry) => (
              <div key={entry.steamId} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="font-semibold text-th-text">{entry.playerName ?? entry.steamId}</p>
                  <p className="mt-1 text-sm text-th-text-m">{entry.reason}</p>
                  <p className="mt-1 text-xs text-th-text-m">Expires: {entry.expiresAt ? new Date(entry.expiresAt).toLocaleString() : 'Never'}</p>
                </div>
                <button type="button" onClick={() => void apiClient.unbanPlayer(entry.steamId).then(() => bans.refetch())} className="dune-button">
                  <UserCheck className="mr-2 h-4 w-4" /> Unban
                </button>
              </div>
            ))}
            {(bans.data ?? []).length === 0 ? <div className="p-10 text-center text-th-text-m">No banned players. Discipline is holding.</div> : null}
          </div>
        </div>
      ) : null}

      {activeTab === 'history' ? (
        <div className="glass-panel overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-th-border-m/80 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="section-title">Intelligence</p>
              <h2 className="mt-1 text-xl font-semibold text-th-text">Connection History</h2>
              <p className="mt-2 text-sm text-th-text-m">A log of player connect and disconnect events on your server.</p>
            </div>
            <div className="flex items-center gap-2">
              <a href="/api/players/connections/export?format=csv" download className="dune-button-muted inline-flex items-center gap-2">
                <Download className="h-4 w-4" /> CSV
              </a>
              <a href="/api/players/connections/export?format=json" download className="dune-button-muted inline-flex items-center gap-2">
                <Download className="h-4 w-4" /> JSON
              </a>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-th-surface-s/50 text-xs uppercase tracking-[0.2em] text-th-text-m">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium">Steam ID</th>
                  <th className="px-4 py-3 font-medium">Map</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-th-border-m/60">
                {(connections.data ?? []).map((entry) => (
                  <tr key={entry.id} className="transition-colors hover:bg-th-surface-s/40">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-th-text-m">{new Date(entry.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                        entry.event === 'connect'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : 'bg-red-500/15 text-red-600 dark:text-red-300',
                      )}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', entry.event === 'connect' ? 'bg-emerald-400' : 'bg-red-400')} />
                        {entry.event === 'connect' ? 'Connected' : 'Disconnected'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-th-text">{entry.playerName ?? 'Unknown'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-th-text-m">{entry.steamId}</td>
                    <td className="px-4 py-3 text-th-text-s">{entry.mapName ?? '-'}</td>
                  </tr>
                ))}
                {(connections.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-th-text-m">No connection events recorded yet. Events are tracked automatically when players join or leave.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'allowlist' ? (
        <div className="glass-panel flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
          <ShieldAlert className="h-10 w-10 text-amber-300" />
          <div>
            <h2 className="text-xl font-semibold text-th-text">Allowlist View</h2>
            <p className="mt-2 max-w-xl text-th-text-m">Allowlist management is reserved for the backend control plane. Once exposed, the dashboard is ready to surface it here.</p>
          </div>
        </div>
      ) : null}

      {selectedPlayer ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-th-bg/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ban-dialog-title">
          <div className="glass-panel w-full max-w-lg p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300"><Ban className="h-5 w-5" /></div>
              <div>
                <h3 className="text-xl font-semibold text-th-text" id="ban-dialog-title">Ban Player</h3>
                <p className="text-sm text-th-text-m">{selectedPlayer.name} • {selectedPlayer.steamId}</p>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-th-text">Reason</span>
                <input className="dune-input" name="ban-reason" autoComplete="off" value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-th-text">Duration (hours)</span>
                <input className="dune-input" name="ban-duration" type="number" min="0" autoComplete="off" value={duration} onChange={(event) => setDuration(event.target.value)} />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="dune-button-muted" onClick={() => setSelectedPlayer(null)}>Cancel</button>
              <button type="button" className="dune-button" onClick={() => void handleBan()}>Confirm ban</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlayersPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-24 rounded-full" />
        ))}
      </div>
      <TableSkeleton rows={6} />
      <div className="glass-panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-th-border-m/80 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-28 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-xl" />
          </div>
        </div>
        <div className="space-y-5 p-5">
          <Skeleton className="h-72 w-full rounded-3xl" />
          <Skeleton className="h-64 w-full rounded-3xl" />
        </div>
      </div>
    </div>
  );
}
