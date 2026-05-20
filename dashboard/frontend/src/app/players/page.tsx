'use client';

import { Ban, ShieldAlert, UserCheck, Users } from 'lucide-react';
import { useState } from 'react';

import { PlayerTable } from '@/components/PlayerTable';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { Player } from '@/lib/types';
import { cn } from '@/lib/utils';

const tabs = ['online', 'banned', 'allowlist'] as const;

export default function PlayersPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('online');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [reason, setReason] = useState('Rule violation');
  const [duration, setDuration] = useState('24');
  const players = useApi(() => apiClient.getPlayers(), { refreshInterval: 10000, initialData: [] });
  const bans = useApi(() => apiClient.getBans(), { refreshInterval: 15000, initialData: [] });

  const handleBan = async () => {
    if (!selectedPlayer) {
      return;
    }

    await apiClient.banPlayer(selectedPlayer.steamId, reason, duration ? Number(duration) : undefined);
    setSelectedPlayer(null);
    await Promise.all([players.refetch(), bans.refetch()]);
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
              'rounded-full border px-4 py-2 text-sm font-medium capitalize transition',
              activeTab === tab ? 'border-amber-500/40 bg-amber-500/15 text-amber-200' : 'border-slate-700 bg-slate-900/70 text-slate-400',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'online' ? (
        <PlayerTable players={players.data ?? []} onBan={setSelectedPlayer} />
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-lg p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300"><Ban className="h-5 w-5" /></div>
              <div>
                <h3 className="text-xl font-semibold text-slate-50">Ban player</h3>
                <p className="text-sm text-slate-400">{selectedPlayer.name} • {selectedPlayer.steamId}</p>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-100">Reason</span>
                <input className="dune-input" value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-100">Duration (hours)</span>
                <input className="dune-input" type="number" value={duration} onChange={(event) => setDuration(event.target.value)} />
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
