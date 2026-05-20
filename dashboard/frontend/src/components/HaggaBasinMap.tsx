'use client';

import { LocateFixed, Users } from 'lucide-react';
import { useMemo } from 'react';

import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

const DEFAULT_HAGGA_BASIN_BOUNDS = {
  minX: -500_000,
  maxX: 500_000,
  minY: -500_000,
  maxY: 500_000,
};

const GRID_DIVISIONS = 8;

export interface HaggaBasinMapPlayer {
  name: string;
  x?: number | null;
  y?: number | null;
  map_name?: string | null;
  map?: string | null;
  position?: {
    x?: number | null;
    y?: number | null;
  } | null;
}

interface HaggaBasinMapProps {
  players: HaggaBasinMapPlayer[];
  refreshIntervalMs?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveCoordinate(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function HaggaBasinMap({ players, refreshIntervalMs = 10_000 }: HaggaBasinMapProps) {
  const { data: polledPlayers } = useApi(() => apiClient.getPlayers(), {
    refreshInterval: refreshIntervalMs,
  });

  const sourcePlayers = polledPlayers ?? players;

  const normalizedPlayers = useMemo(() => {
    return sourcePlayers
      .map((player) => {
        const x = resolveCoordinate(player.x ?? player.position?.x);
        const y = resolveCoordinate(player.y ?? player.position?.y);

        return {
          ...player,
          x,
          y,
          mapLabel: player.map_name ?? player.map ?? 'Unknown map',
        };
      })
      .filter((player): player is HaggaBasinMapPlayer & { x: number; y: number; mapLabel: string } => player.x !== null && player.y !== null);
  }, [sourcePlayers]);

  const bounds = useMemo(() => {
    if (normalizedPlayers.length === 0) {
      return DEFAULT_HAGGA_BASIN_BOUNDS;
    }

    const xs = normalizedPlayers.map((player) => player.x);
    const ys = normalizedPlayers.map((player) => player.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const paddingX = Math.max((maxX - minX) * 0.12, 5_000);
    const paddingY = Math.max((maxY - minY) * 0.12, 5_000);

    return {
      minX: Math.min(DEFAULT_HAGGA_BASIN_BOUNDS.minX, minX - paddingX),
      maxX: Math.max(DEFAULT_HAGGA_BASIN_BOUNDS.maxX, maxX + paddingX),
      minY: Math.min(DEFAULT_HAGGA_BASIN_BOUNDS.minY, minY - paddingY),
      maxY: Math.max(DEFAULT_HAGGA_BASIN_BOUNDS.maxY, maxY + paddingY),
    };
  }, [normalizedPlayers]);

  const plottedPlayers = useMemo(() => {
    const spanX = Math.max(bounds.maxX - bounds.minX, 1);
    const spanY = Math.max(bounds.maxY - bounds.minY, 1);

    return normalizedPlayers.map((player) => ({
      ...player,
      left: clamp(((player.x - bounds.minX) / spanX) * 100, 2, 98),
      top: clamp(100 - ((player.y - bounds.minY) / spanY) * 100, 2, 98),
    }));
  }, [bounds, normalizedPlayers]);

  const emptyMessage = sourcePlayers.length === 0 ? 'No players online' : 'Players are online, but coordinate telemetry is unavailable.';

  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-slate-800/80 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-title">Live map telemetry</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-50">Hagga Basin tactical overlay</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Placeholder desert backdrop in use. Add <code className="rounded bg-slate-900/80 px-1.5 py-0.5 text-xs text-amber-200">/public/maps/hagga-basin.webp</code> and swap the background once final art is available.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-amber-200">
              <Users className="h-4 w-4" /> {plottedPlayers.length} tracked
            </span>
            <span>Refreshes every {Math.round(refreshIntervalMs / 1000)}s</span>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div
          className="relative min-h-[420px] overflow-hidden rounded-3xl border border-amber-500/15 bg-slate-950 sand-glow"
          style={{
            backgroundImage: [
              'radial-gradient(circle at 20% 18%, rgba(251, 191, 36, 0.14), transparent 22%)',
              'radial-gradient(circle at 78% 30%, rgba(251, 146, 60, 0.16), transparent 24%)',
              'radial-gradient(circle at 55% 72%, rgba(180, 83, 9, 0.2), transparent 28%)',
              'linear-gradient(180deg, rgba(51, 26, 11, 0.96) 0%, rgba(23, 14, 10, 0.94) 45%, rgba(7, 10, 18, 0.98) 100%)',
            ].join(','),
          }}
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-35"
            style={{
              backgroundImage: 'linear-gradient(rgba(251, 191, 36, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(251, 191, 36, 0.1) 1px, transparent 1px)',
              backgroundSize: `${100 / GRID_DIVISIONS}% ${100 / GRID_DIVISIONS}%`,
            }}
          />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-amber-300/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/80 to-transparent" />

          <div className="absolute left-4 top-4 rounded-full border border-amber-400/20 bg-slate-950/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-amber-200/90">
            Hagga Basin
          </div>
          <div className="absolute right-4 top-4 rounded-full border border-slate-700/80 bg-slate-950/70 px-3 py-1 text-xs text-slate-300">
            X {Math.round(bounds.minX).toLocaleString()} → {Math.round(bounds.maxX).toLocaleString()}
          </div>
          <div className="absolute bottom-4 right-4 rounded-full border border-slate-700/80 bg-slate-950/70 px-3 py-1 text-xs text-slate-300">
            Y {Math.round(bounds.minY).toLocaleString()} → {Math.round(bounds.maxY).toLocaleString()}
          </div>

          {plottedPlayers.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full border border-amber-500/20 bg-amber-500/10 p-4 text-amber-300">
                <LocateFixed className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-100">{emptyMessage}</p>
                <p className="mt-2 max-w-md text-sm text-slate-400">
                  Player dots appear here as soon as the dashboard receives live position updates from the game services.
                </p>
              </div>
            </div>
          ) : null}

          {plottedPlayers.map((player, index) => (
            <button
              key={`${player.name}-${index}`}
              type="button"
              className="group absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${player.left}%`, top: `${player.top}%` }}
              aria-label={`${player.name} on ${player.mapLabel}`}
            >
              <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/20 blur-md" />
              <span className="relative block h-3.5 w-3.5 rounded-full border-2 border-amber-100 bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.75)] transition group-hover:scale-125" />
              <span className="pointer-events-none absolute bottom-[calc(100%+0.75rem)] left-1/2 hidden min-w-max -translate-x-1/2 rounded-xl border border-amber-500/20 bg-slate-950/95 px-3 py-2 text-left text-xs text-slate-200 shadow-2xl group-hover:block">
                <span className="block font-semibold text-amber-200">{player.name}</span>
                <span className="mt-1 block text-slate-400">{player.mapLabel}</span>
                <span className="mt-1 block text-slate-500">
                  X {Math.round(player.x).toLocaleString()} • Y {Math.round(player.y).toLocaleString()}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
