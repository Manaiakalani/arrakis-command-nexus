'use client';

import { Flame, LocateFixed, Users } from 'lucide-react';
import { useMemo } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';

import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import {
  formatSessionDuration,
  getPlayerMapBounds,
  normalizePlayerMapData,
  type NormalizedPlayerMapPoint,
  type PlayerMapSource,
} from '@/lib/player-map';

interface PlayerHeatmapProps {
  players: PlayerMapSource[];
  refreshIntervalMs?: number;
}

interface HeatmapCellDatum {
  x: number;
  y: number;
  count: number;
  intensity: number;
  fill: string;
  stroke: string;
  names: string[];
  averageSessionSeconds: number;
}

function getHeatColor(intensity: number) {
  const clamped = Math.min(Math.max(intensity, 0), 1);
  const alpha = 0.18 + clamped * 0.72;
  return `rgba(251, 191, 36, ${alpha.toFixed(2)})`;
}

function buildHeatmapCells(players: NormalizedPlayerMapPoint[]) {
  const bounds = getPlayerMapBounds(players);
  const columns = 12;
  const rows = 12;
  const stepX = Math.max((bounds.maxX - bounds.minX) / columns, 1);
  const stepY = Math.max((bounds.maxY - bounds.minY) / rows, 1);
  const buckets = new Map<string, { cellX: number; cellY: number; count: number; names: string[]; totalSessionSeconds: number }>();

  players.forEach((player) => {
    const cellX = Math.min(columns - 1, Math.max(0, Math.floor((player.x - bounds.minX) / stepX)));
    const cellY = Math.min(rows - 1, Math.max(0, Math.floor((player.y - bounds.minY) / stepY)));
    const key = `${cellX}:${cellY}`;
    const existing = buckets.get(key) ?? { cellX, cellY, count: 0, names: [], totalSessionSeconds: 0 };

    existing.count += 1;
    existing.totalSessionSeconds += player.sessionSeconds;
    existing.names.push(player.name);
    buckets.set(key, existing);
  });

  const rawCells = Array.from(buckets.values()).map((bucket) => ({
    x: bounds.minX + (bucket.cellX + 0.5) * stepX,
    y: bounds.minY + (bucket.cellY + 0.5) * stepY,
    count: bucket.count,
    score: bucket.count + bucket.totalSessionSeconds / 3600,
    names: bucket.names,
    averageSessionSeconds: bucket.count > 0 ? Math.round(bucket.totalSessionSeconds / bucket.count) : 0,
  }));

  const maxScore = Math.max(...rawCells.map((cell) => cell.score), 1);

  return rawCells.map((cell) => {
    const intensity = cell.score / maxScore;
    return {
      x: cell.x,
      y: cell.y,
      count: cell.count,
      intensity,
      fill: getHeatColor(intensity),
      stroke: intensity > 0.65 ? '#fbbf24' : '#fb923c',
      names: cell.names,
      averageSessionSeconds: cell.averageSessionSeconds,
    } satisfies HeatmapCellDatum;
  });
}

function HeatmapTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: HeatmapCellDatum }> }) {
  if (!active || !payload?.length) {
    return null;
  }

  const cell = payload[0].payload;

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-th-bg/95 px-3 py-2 text-xs text-th-text-s shadow-2xl">
      <p className="font-semibold text-amber-200">{cell.count} active player{cell.count === 1 ? '' : 's'}</p>
      <p className="mt-1 text-th-text-m">Avg. session {formatSessionDuration(cell.averageSessionSeconds)}</p>
      <p className="mt-1 text-th-text0">{cell.names.slice(0, 3).join(', ')}{cell.names.length > 3 ? ` +${cell.names.length - 3} more` : ''}</p>
    </div>
  );
}

function HeatmapCell({ cx = 0, cy = 0, payload }: { cx?: number; cy?: number; payload?: HeatmapCellDatum }) {
  if (!payload) {
    return null;
  }

  const size = 18 + payload.intensity * 22;

  return (
    <rect
      x={cx - size / 2}
      y={cy - size / 2}
      width={size}
      height={size}
      rx={6}
      fill={payload.fill}
      stroke={payload.stroke}
      strokeWidth={1.5}
    />
  );
}

export function PlayerHeatmap({ players, refreshIntervalMs = 10_000 }: PlayerHeatmapProps) {
  const { data: polledPlayers } = useApi(() => apiClient.getPlayerPositions(), {
    enabled: refreshIntervalMs > 0,
    refreshInterval: refreshIntervalMs || undefined,
  });

  const normalizedPlayers = useMemo(() => normalizePlayerMapData(polledPlayers ?? players), [players, polledPlayers]);
  const bounds = useMemo(() => getPlayerMapBounds(normalizedPlayers), [normalizedPlayers]);
  const cells = useMemo(() => buildHeatmapCells(normalizedPlayers), [normalizedPlayers]);
  const emptyMessage = players.length === 0 ? 'No player activity to bin' : 'Position telemetry is unavailable for current players.';

  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-th-border-m/80 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-title">Density analysis</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Player Activity Heatmap</h2>
            <p className="mt-2 text-sm text-th-text-m">Grid cells brighten as more players cluster together, weighted by current session duration.</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-th-text-m">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-amber-200">
              <Users className="h-4 w-4" /> {normalizedPlayers.length} sampled
            </span>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="relative h-[360px] overflow-hidden rounded-3xl border border-amber-500/15 bg-th-bg sand-glow">
          {cells.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 24, right: 24, bottom: 24, left: 12 }}>
                <CartesianGrid stroke="rgba(251, 191, 36, 0.12)" strokeDasharray="4 4" />
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
                <Tooltip cursor={{ stroke: '#f59e0b', strokeOpacity: 0.18 }} content={<HeatmapTooltip />} />
                <Scatter data={cells} shape={<HeatmapCell />} />
              </ScatterChart>
            </ResponsiveContainer>
          ) : null}

          {cells.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full border border-amber-500/20 bg-amber-500/10 p-4 text-amber-300">
                <LocateFixed className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-semibold text-th-text">{emptyMessage}</p>
                <p className="mt-2 max-w-md text-sm text-th-text-m">Heat bins appear once online players stream coordinate telemetry into the dashboard.</p>
              </div>
            </div>
          ) : null}

          <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-amber-400/20 bg-th-bg/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-amber-200/90">
            <Flame className="h-3.5 w-3.5" /> Weighted density
          </div>
        </div>
      </div>
    </section>
  );
}
