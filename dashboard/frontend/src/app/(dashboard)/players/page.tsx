'use client';

import { Ban, ChevronDown, ChevronUp, LocateFixed, ShieldAlert, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { HaggaBasinMap } from '@/components/HaggaBasinMap';
import { PlayerHeatmap } from '@/components/PlayerHeatmap';
import { PlayerTable } from '@/components/PlayerTable';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { Player } from '@/lib/types';
import { cn } from '@/lib/utils';

const tabs = ['online', 'banned', 'allowlist'] as const;

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
  const [mapExpanded, setMapExpanded] = useState(false);
  const players = useApi(() => apiClient.getPlayers(), { refreshInterval: 10000, initialData: [] });
  const playerPositions = useApi(() => apiClient.getPlayerPositions(), { refreshInterval: 10000, initialData: [] });
  const bans = useApi(() => apiClient.getBans(), { refreshInterval: 15000, initialData: [] });

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
              activeTab === tab ? 'border-amber-500/40 bg-amber-500/15 text-amber-200' : 'border-slate-700 bg-slate-900/70 text-slate-400',
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
            <div className="flex flex-col gap-4 border-b border-slate-800/80 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="section-title">Spatial telemetry</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-50">Live player position analysis</h2>
                <p className="mt-2 text-sm text-slate-400">Expand to inspect the Hagga Basin tactical overlay and density heatmap without leaving the players roster.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
                  <LocateFixed className="h-4 w-4" /> {(playerPositions.data ?? []).length} tracked
                </span>
                <button
                  type="button"
                  onClick={() => setMapExpanded((current) => !current)}
                  className="dune-button-muted"
                  aria-label={mapExpanded ? 'Collapse live position analysis' : 'Expand live position analysis'}
                >
                  {mapExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {mapExpanded ? (
              <div className="space-y-5 p-5">
                <HaggaBasinMap players={playerPositions.data ?? []} refreshIntervalMs={0} />
                <PlayerHeatmap players={playerPositions.data ?? []} refreshIntervalMs={0} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {activeTab === 'banned' ? (
        <div className="glass-panel overflow-hidden">
          <div className="border-b border-slate-800/80 p-5">
            <p className="section-title">Enforcement</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-50">Banned players</h2>
          </div>
          <div className="divide-y divide-slate-800/80">
            {(bans.data ?? []).map((entry) => (
              <div key={entry.steamId} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="font-semibold text-slate-100">{entry.playerName ?? entry.steamId}</p>
                  <p className="mt-1 text-sm text-slate-400">{entry.reason}</p>
                  <p className="mt-1 text-xs text-slate-500">Expires: {entry.expiresAt ? new Date(entry.expiresAt).toLocaleString() : 'Never'}</p>
                </div>
                <button type="button" onClick={() => void apiClient.unbanPlayer(entry.steamId).then(() => bans.refetch())} className="dune-button">
                  <UserCheck className="mr-2 h-4 w-4" /> Unban
                </button>
              </div>
            ))}
            {(bans.data ?? []).length === 0 ? <div className="p-10 text-center text-slate-400">No banned players. Discipline is holding.</div> : null}
          </div>
        </div>
      ) : null}

      {activeTab === 'allowlist' ? (
        <div className="glass-panel flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
          <ShieldAlert className="h-10 w-10 text-amber-300" />
          <div>
            <h2 className="text-xl font-semibold text-slate-50">Allowlist view</h2>
            <p className="mt-2 max-w-xl text-slate-400">Allowlist management is reserved for the backend control plane. Once exposed, the dashboard is ready to surface it here.</p>
          </div>
        </div>
      ) : null}

      {selectedPlayer ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ban-dialog-title">
          <div className="glass-panel w-full max-w-lg p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300"><Ban className="h-5 w-5" /></div>
              <div>
                <h3 className="text-xl font-semibold text-slate-50" id="ban-dialog-title">Ban player</h3>
                <p className="text-sm text-slate-400">{selectedPlayer.name} • {selectedPlayer.steamId}</p>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-100">Reason</span>
                <input className="dune-input" name="ban-reason" autoComplete="off" value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-100">Duration (hours)</span>
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
