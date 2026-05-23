'use client';

import { Ban, Search, ShieldX } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { Player } from '@/lib/types';
import { cn } from '@/lib/utils';

type SortKey = 'name' | 'steamId' | 'map' | 'sessionSeconds';

interface PlayerTableProps {
  players: Player[];
  onBan?: (player: Player) => void;
  onKick?: (player: Player) => void;
}

function formatSession(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function PlayerTable({ players, onBan, onKick }: PlayerTableProps) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [ascending, setAscending] = useState(true);

  const filtered = useMemo(() => {
    const lowered = query.toLowerCase();
    const next = players.filter((player) => {
      return [player.name, player.steamId, player.map].some((value) => value.toLowerCase().includes(lowered));
    });

    next.sort((left, right) => {
      const a = left[sortKey];
      const b = right[sortKey];
      if (typeof a === 'number' && typeof b === 'number') {
        return ascending ? a - b : b - a;
      }
      return ascending ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a));
    });

    return next;
  }, [ascending, players, query, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setAscending((current) => !current);
      return;
    }

    setSortKey(key);
    setAscending(true);
  };

  return (
    <div className="glass-panel overflow-hidden">
      <div className="border-b border-slate-800/80 p-4 sm:p-5">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="dune-input pl-11"
            placeholder="Search players, Steam IDs, or maps\u2026"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900/50 text-xs uppercase tracking-[0.2em] text-slate-500">
            <tr>
              {[
                ['name', 'Name'],
                ['steamId', 'Steam ID'],
                ['map', 'Map'],
                ['sessionSeconds', 'Session Time'],
              ].map(([key, label]) => (
                <th key={key} className="px-5 py-4 font-medium">
                  <button type="button" onClick={() => toggleSort(key as SortKey)} className="inline-flex items-center gap-2 transition-colors hover:text-slate-300">
                    {label}
                    <span className={cn('text-[10px]', sortKey === key ? 'text-amber-300' : 'text-slate-700')}>{sortKey === key ? (ascending ? '▲' : '▼') : '•'}</span>
                  </button>
                </th>
              ))}
              <th className="px-5 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {filtered.length > 0 ? (
              filtered.map((player) => (
                <tr key={player.steamId} className="transition-colors hover:bg-slate-900/50">
                  <td className="px-5 py-4 font-medium text-slate-100">{player.name}</td>
                  <td className="px-5 py-4 text-slate-300">{player.steamId}</td>
                  <td className="px-5 py-4 text-slate-300">{player.map}</td>
                  <td className="px-5 py-4 tabular-nums text-slate-300">{formatSession(player.sessionSeconds)}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="dune-button-muted px-3 py-2 text-xs"
                        onClick={() => onKick?.(player)}
                        disabled={!onKick}
                      >
                        <ShieldX className="mr-1.5 h-3.5 w-3.5" /> Kick
                      </button>
                      <button type="button" className="dune-button px-3 py-2 text-xs" onClick={() => onBan?.(player)}>
                        <Ban className="mr-1.5 h-3.5 w-3.5" /> Ban
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                  No players match the current search. The sands are quiet right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
