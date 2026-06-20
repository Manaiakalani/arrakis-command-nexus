'use client';

import { Ban, Download, History, LocateFixed, MapPinned, Shield, ShieldAlert, UserCheck, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import { PlayerTable } from '@/components/PlayerTable';
import { Skeleton, TableSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { ConnectionLogEntry, Player } from '@/lib/types';
import { cn } from '@/lib/utils';

const tabs = ['online', 'banned', 'history', 'allowlist'] as const;

type KickStatus = {
  tone: 'success' | 'error';
  message: string;
};

const HaggaBasinMap = dynamic(() => import('@/components/HaggaBasinMap').then((mod) => mod.HaggaBasinMap), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-3xl bg-th-surface/50" />,
});

const PlayerHeatmap = dynamic(() => import('@/components/PlayerHeatmap').then((mod) => mod.PlayerHeatmap), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-3xl bg-th-surface/50" />,
});

const BAN_REASON_TEMPLATES = ['Cheating', 'Harassment', 'AFK / Inactive', 'Exploiting', 'Custom'] as const;

export default function PlayersPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('online');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [reason, setReason] = useState('Rule violation');
  const [reasonTemplate, setReasonTemplate] = useState<string>('Custom');
  const [duration, setDuration] = useState('24');
  const [kickStatus, setKickStatus] = useState<KickStatus | null>(null);
  const players = useApi(() => apiClient.getPlayers(), { refreshInterval: 10000, initialData: [] });
  const playerPositions = useApi(() => apiClient.getPlayerPositions(), { refreshInterval: 10000, initialData: [] });
  const bans = useApi(() => apiClient.getBans(), { refreshInterval: 15000, initialData: [] });
  const connections = useApi(() => apiClient.getConnectionHistory(), { refreshInterval: 30000, initialData: [] });
  const allowlist = useApi(() => apiClient.getAllowlist(), { refreshInterval: 30000, initialData: [] });
  const [allowSteamId, setAllowSteamId] = useState('');
  const [allowName, setAllowName] = useState('');
  const [allowSubmitting, setAllowSubmitting] = useState(false);
  const [selectedSteamIds, setSelectedSteamIds] = useState<Set<string>>(new Set());
  const [bulkBanning, setBulkBanning] = useState(false);
  const [selectedBanIds, setSelectedBanIds] = useState<Set<string>>(new Set());

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

    try {
      await apiClient.banPlayer(selectedPlayer.steamId, reason, duration ? Number(duration) : undefined);
      setSelectedPlayer(null);
      await Promise.all([players.refetch(), playerPositions.refetch(), bans.refetch()]);
      toast(`Banned ${selectedPlayer.name}.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to ban player.';
      toast(`Failed to ban player: ${message}`, 'error');
    }
  };

  const handleKick = async (player: Player) => {
    try {
      const response = await apiClient.kickPlayer(player.steamId);
      setKickStatus({ tone: response.status === 'ok' ? 'success' : 'error', message: response.message });
      await Promise.all([players.refetch(), playerPositions.refetch()]);
      toast(response.message, response.status === 'ok' ? 'success' : 'error');
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to kick ${player.steamId}`;
      setKickStatus({
        tone: 'error',
        message,
      });
      toast(`Failed to kick player: ${message}`, 'error');
    }
  };

  const handleUnban = async (steamId: string) => {
    try {
      await apiClient.unbanPlayer(steamId);
      await bans.refetch();
      toast('Player unbanned.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to unban player.';
      toast(`Failed to unban player: ${message}`, 'error');
    }
  };

  const handleAddAllowlist = async () => {
    const steamId = allowSteamId.trim();
    if (!steamId) {
      toast('Enter a Steam ID to allowlist.', 'error');
      return;
    }
    setAllowSubmitting(true);
    try {
      await apiClient.addAllowlist(steamId, allowName.trim() || undefined);
      setAllowSteamId('');
      setAllowName('');
      toast('Player added to allowlist.', 'success');
      await allowlist.refetch().catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add to allowlist.';
      toast(`Failed to add to allowlist: ${message}`, 'error');
    } finally {
      setAllowSubmitting(false);
    }
  };

  const handleRemoveAllowlist = async (steamId: string) => {
    try {
      await apiClient.removeAllowlist(steamId);
      toast('Player removed from allowlist.', 'success');
      await allowlist.refetch().catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove from allowlist.';
      toast(`Failed to remove from allowlist: ${message}`, 'error');
    }
  };

  const handleBulkBan = async () => {
    if (selectedSteamIds.size === 0) return;
    setBulkBanning(true);
    let successCount = 0;
    for (const steamId of selectedSteamIds) {
      try {
        await apiClient.banPlayer(steamId, reason, duration ? Number(duration) : undefined);
        successCount++;
      } catch {
        // continue with remaining
      }
    }
    setSelectedSteamIds(new Set());
    setBulkBanning(false);
    await Promise.all([players.refetch(), bans.refetch()]);
    toast(`Banned ${successCount} of ${selectedSteamIds.size} players.`, successCount > 0 ? 'success' : 'error');
  };

  const handleBulkUnban = async () => {
    if (selectedBanIds.size === 0) return;
    let successCount = 0;
    for (const steamId of selectedBanIds) {
      try {
        await apiClient.unbanPlayer(steamId);
        successCount++;
      } catch {
        // continue with remaining
      }
    }
    setSelectedBanIds(new Set());
    await bans.refetch();
    toast(`Unbanned ${successCount} of ${selectedBanIds.size} players.`, successCount > 0 ? 'success' : 'error');
  };

  const togglePlayerSelection = (steamId: string) => {
    setSelectedSteamIds((prev) => {
      const next = new Set(prev);
      if (next.has(steamId)) next.delete(steamId);
      else next.add(steamId);
      return next;
    });
  };

  const toggleBanSelection = (steamId: string) => {
    setSelectedBanIds((prev) => {
      const next = new Set(prev);
      if (next.has(steamId)) next.delete(steamId);
      else next.add(steamId);
      return next;
    });
  };

  const isLoading = players.loading || playerPositions.loading || bans.loading;

  if (isLoading) {
    return <PlayersPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300">
          <Users className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="section-title">Player operations</p>
          <h1 className="mt-1 text-2xl font-semibold text-th-text">Players</h1>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-full border px-4 py-2 text-sm font-medium capitalize transition-[color,background-color,border-color] dune-focus',
              activeTab === tab ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200' : 'border-th-border bg-th-surface-s/70 text-th-text-m',
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
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200',
          )}
        >
          {kickStatus.message}
        </div>
      ) : null}

      {activeTab === 'online' ? (
        <>
          {selectedSteamIds.size > 0 && (
            <div className="glass-panel flex flex-wrap items-center gap-3 p-4">
              <span className="text-sm text-th-text-m">{selectedSteamIds.size} player{selectedSteamIds.size > 1 ? 's' : ''} selected</span>
              <select value={reasonTemplate} onChange={(e) => { setReasonTemplate(e.target.value); if (e.target.value !== 'Custom') setReason(e.target.value); }} className="dune-input w-auto text-sm" aria-label="Ban reason template">
                {BAN_REASON_TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {reasonTemplate === 'Custom' && (
                <input value={reason} onChange={(e) => setReason(e.target.value)} className="dune-input w-auto text-sm" placeholder="Custom reason…" />
              )}
              <button type="button" disabled={bulkBanning} onClick={() => void handleBulkBan()} className="dune-button text-sm">
                <Ban aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" /> {bulkBanning ? 'Banning…' : 'Ban Selected'}
              </button>
              <button type="button" onClick={() => setSelectedSteamIds(new Set())} className="dune-button-muted text-sm">Clear</button>
            </div>
          )}
          <PlayerTable players={players.data ?? []} onBan={setSelectedPlayer} onKick={(player) => void handleKick(player)} selectedSteamIds={selectedSteamIds} onToggleSelect={togglePlayerSelection} />
          <div className="glass-panel overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-th-border-m/80 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="section-title">Spatial telemetry</p>
                <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><MapPinned aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Live Player Position Analysis</h2>
                <p className="mt-2 text-sm text-th-text-m">Hagga Basin tactical overlay and density heatmap.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-700 dark:text-amber-200">
                  <LocateFixed aria-hidden="true" className="h-4 w-4" /> {(playerPositions.data ?? []).length} tracked
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
          <div className="flex flex-col gap-3 border-b border-th-border-m/80 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="section-title">Enforcement</p>
              <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Shield aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Banned Players</h2>
            </div>
            {selectedBanIds.size > 0 && (
              <button type="button" onClick={() => void handleBulkUnban()} className="dune-button text-sm">
                <UserCheck aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" /> Unban Selected ({selectedBanIds.size})
              </button>
            )}
          </div>
          <div className="divide-y divide-th-border-m/80">
            {(bans.data ?? []).map((entry) => (
              <div key={entry.steamId} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedBanIds.has(entry.steamId)}
                    onChange={() => toggleBanSelection(entry.steamId)}
                    className="h-4 w-4 rounded border-th-border bg-th-surface accent-amber-500"
                    aria-label={`Select ${entry.playerName ?? entry.steamId}`}
                  />
                  <div>
                    <p className="font-semibold text-th-text">{entry.playerName ?? entry.steamId}</p>
                    <p className="mt-1 text-sm text-th-text-m">{entry.reason}</p>
                    <p className="mt-1 text-xs text-th-text-m">Expires: {entry.expiresAt ? new Date(entry.expiresAt).toLocaleString() : 'Never'}</p>
                  </div>
                </div>
                <button type="button" onClick={() => void handleUnban(entry.steamId)} className="dune-button">
                  <UserCheck aria-hidden="true" className="mr-2 h-4 w-4" /> Unban
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
              <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><History aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Connection History</h2>
              <p className="mt-2 text-sm text-th-text-m">A log of player connect and disconnect events on your server.</p>
            </div>
            <div className="flex items-center gap-2">
              <a href="/api/players/connections/export?format=csv" download className="dune-button-muted inline-flex items-center gap-2">
                <Download aria-hidden="true" className="h-4 w-4" /> CSV
              </a>
              <a href="/api/players/connections/export?format=json" download className="dune-button-muted inline-flex items-center gap-2">
                <Download aria-hidden="true" className="h-4 w-4" /> JSON
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
        <div className="space-y-6">
          <div className="glass-panel p-5">
            <p className="section-title">Access control</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><UserCheck aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Allowlist</h2>
            <p className="mt-2 text-sm text-th-text-m">A dashboard-maintained roster of approved Steam IDs for moderation and automation. Connection enforcement is configured on the game server itself.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="allow-steam-id" className="mb-1 block text-xs font-medium text-th-text-m">Steam ID</label>
                <input
                  id="allow-steam-id"
                  className="dune-input"
                  placeholder="7656119..."
                  value={allowSteamId}
                  onChange={(event) => setAllowSteamId(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void handleAddAllowlist(); }}
                />
              </div>
              <div className="flex-1">
                <label htmlFor="allow-name" className="mb-1 block text-xs font-medium text-th-text-m">Display name (optional)</label>
                <input
                  id="allow-name"
                  className="dune-input"
                  placeholder="Muad'Dib"
                  value={allowName}
                  onChange={(event) => setAllowName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void handleAddAllowlist(); }}
                />
              </div>
              <button type="button" onClick={() => void handleAddAllowlist()} disabled={allowSubmitting || !allowSteamId.trim()} className="dune-button disabled:cursor-not-allowed disabled:opacity-50">
                <UserCheck aria-hidden="true" className="mr-2 h-4 w-4" /> {allowSubmitting ? 'Adding...' : 'Add to Allowlist'}
              </button>
            </div>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-th-border-m/80 p-5">
              <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-th-text"><Shield aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Allowlisted Players</h3>
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-sm text-amber-700 dark:text-amber-200">{(allowlist.data ?? []).length}</span>
            </div>
            <div className="divide-y divide-th-border-m/80">
              {(allowlist.data ?? []).map((entry) => (
                <div key={entry.steamId} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-th-text">{entry.playerName || entry.steamId}</p>
                    {entry.playerName ? <p className="mt-1 font-mono text-xs text-th-text-m">{entry.steamId}</p> : null}
                    {entry.addedAt ? <p className="mt-1 text-xs text-th-text-m">Added {new Date(entry.addedAt).toLocaleString()}</p> : null}
                  </div>
                  <button type="button" onClick={() => void handleRemoveAllowlist(entry.steamId)} className="dune-button-secondary">
                    <Ban aria-hidden="true" className="mr-2 h-4 w-4" /> Remove
                  </button>
                </div>
              ))}
              {(allowlist.data ?? []).length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                  <ShieldAlert aria-hidden="true" className="h-8 w-8 text-th-text-m" />
                  <p className="text-th-text-m">The allowlist is empty. Add a Steam ID above to start your approved roster.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {selectedPlayer ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-th-bg/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ban-dialog-title">
          <div className="glass-panel w-full max-w-lg p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300"><Ban aria-hidden="true" className="h-5 w-5" /></div>
              <div>
                <h3 className="text-xl font-semibold text-th-text" id="ban-dialog-title">Ban Player</h3>
                <p className="text-sm text-th-text-m">{selectedPlayer.name} • {selectedPlayer.steamId}</p>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-th-text">Reason template</span>
                <select className="dune-input" value={reasonTemplate} onChange={(e) => { setReasonTemplate(e.target.value); if (e.target.value !== 'Custom') setReason(e.target.value); }} aria-label="Reason template">
                  {BAN_REASON_TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
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
