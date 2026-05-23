'use client';

import { LocateFixed, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import { formatSessionDuration, getPlayerMapBounds, normalizePlayerMapData, type PlayerMapSource } from '@/lib/player-map';
import { cn } from '@/lib/utils';

const GRID_DIVISIONS = 8;

type ViewMode = 'tactical' | 'chart';

interface HaggaBasinMapProps {
  players: PlayerMapSource[];
  refreshIntervalMs?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function PlayerPositionTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ReturnType<typeof normalizePlayerMapData>[number] }> }) {
  if (!active || !payload?.length) {
    return null;
  }

  const player = payload[0].payload;

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-slate-950/95 px-3 py-2 text-xs text-slate-200 shadow-2xl">
      <p className="font-semibold text-amber-200">{player.name}</p>
      <p className="mt-1 text-slate-400">{player.mapLabel}</p>
      <p className="mt-1 text-slate-500">
        X {Math.round(player.x).toLocaleString()} • Y {Math.round(player.y).toLocaleString()}
      </p>
      <p className="mt-1 text-slate-500">Session {formatSessionDuration(player.sessionSeconds)}</p>
    </div>
  );
}

export function HaggaBasinMap({ players, refreshIntervalMs = 10_000 }: HaggaBasinMapProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('tactical');
  const { data: polledPlayers } = useApi(() => apiClient.getPlayerPositions(), {
    enabled: refreshIntervalMs > 0,
    refreshInterval: refreshIntervalMs || undefined,
  });

  const sourcePlayers = polledPlayers ?? players;
  const normalizedPlayers = useMemo(() => normalizePlayerMapData(sourcePlayers), [sourcePlayers]);
  const bounds = useMemo(() => getPlayerMapBounds(normalizedPlayers), [normalizedPlayers]);

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
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="section-title">Live map telemetry</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-50">Hagga Basin Tactical Overlay</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Placeholder desert backdrop in use. Add <code className="rounded bg-slate-900/80 px-1.5 py-0.5 text-xs text-amber-200">/public/maps/hagga-basin.webp</code> and swap the background once final art is available.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-amber-200">
              <Users className="h-4 w-4" /> {plottedPlayers.length} tracked
            </span>
            {refreshIntervalMs > 0 ? <span>Refreshes every {Math.round(refreshIntervalMs / 1000)}s</span> : null}
            <div className="inline-flex rounded-full border border-slate-700/80 bg-slate-950/80 p-1">
              {(['tactical', 'chart'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition-colors',
                    viewMode === mode ? 'bg-amber-500/15 text-amber-200' : 'text-slate-400 hover:text-slate-200',
                  )}
                >
                  {mode === 'tactical' ? 'Tactical' : 'Chart'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-5">
        {viewMode === 'tactical' ? (
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
                key={`${player.steamId}-${index}`}
                type="button"
                className="group absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${player.left}%`, top: `${player.top}%` }}
                aria-label={`${player.name} on ${player.mapLabel}`}
              >
                <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/20 blur-md" />
                <span className="relative block h-3.5 w-3.5 rounded-full border-2 border-amber-100 bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.75)] transition-transform duration-150 ease-[var(--ease-out-expo)] group-hover:scale-125" />
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
        ) : (
          <div className="relative h-[420px] overflow-hidden rounded-3xl border border-amber-500/15 bg-[linear-gradient(180deg,rgba(51,26,11,0.78)_0%,rgba(15,23,42,0.96)_100%)] p-2">
            {normalizedPlayers.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 24, right: 24, bottom: 24, left: 12 }}>
                  <CartesianGrid stroke="rgba(251, 191, 36, 0.14)" strokeDasharray="4 4" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[bounds.minX, bounds.maxX]}
                    tick={{ fill: '#cbd5e1', fontSize: 12 }}
                    tickFormatter={(value) => Math.round(value).toLocaleString()}
                    stroke="rgba(245, 158, 11, 0.45)"
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    domain={[bounds.minY, bounds.maxY]}
                    tick={{ fill: '#cbd5e1', fontSize: 12 }}
                    tickFormatter={(value) => Math.round(value).toLocaleString()}
                    stroke="rgba(245, 158, 11, 0.45)"
                  />
                  <ZAxis type="number" dataKey="sessionSeconds" range={[80, 360]} />
                  <Tooltip cursor={{ stroke: '#f59e0b', strokeOpacity: 0.2 }} content={<PlayerPositionTooltip />} />
                  <Scatter data={normalizedPlayers}>
                    {normalizedPlayers.map((player) => (
                      <Cell key={player.steamId} fill={player.fill} stroke="#f8fafc" strokeOpacity={0.75} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            ) : null}

            {normalizedPlayers.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="rounded-full border border-amber-500/20 bg-amber-500/10 p-4 text-amber-300">
                  <LocateFixed className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-100">{emptyMessage}</p>
                  <p className="mt-2 max-w-md text-sm text-slate-400">Switch back to Tactical view once live coordinates begin flowing again.</p>
                </div>
              </div>
            ) : (
              <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2 text-xs text-slate-200">
                <span className="rounded-full border border-amber-500/20 bg-slate-950/70 px-3 py-1">Survival <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" /></span>
                <span className="rounded-full border border-amber-500/20 bg-slate-950/70 px-3 py-1">Overmap <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-[#60a5fa]" /></span>
                <span className="rounded-full border border-amber-500/20 bg-slate-950/70 px-3 py-1">DeepDesert <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-[#fb923c]" /></span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
