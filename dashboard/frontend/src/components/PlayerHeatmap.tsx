'use client';

import { Flame, LocateFixed, Minus, Plus, RotateCcw, Users } from 'lucide-react';
import { useMemo } from 'react';

import { useApi } from '@/hooks/useApi';
import { useMapZoom } from '@/hooks/useMapZoom';
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

interface HeatmapCell {
  row: number;
  col: number;
  count: number;
  intensity: number;
  names: string[];
  averageSessionSeconds: number;
  centerX: number;
  centerY: number;
}

const GRID_COLS = 16;
const GRID_ROWS = 12;

function buildHeatGrid(players: NormalizedPlayerMapPoint[], bounds: ReturnType<typeof getPlayerMapBounds>): HeatmapCell[] {
  const stepX = Math.max((bounds.maxX - bounds.minX) / GRID_COLS, 1);
  const stepY = Math.max((bounds.maxY - bounds.minY) / GRID_ROWS, 1);

  const buckets = new Map<string, { row: number; col: number; count: number; names: string[]; totalSession: number }>();

  for (const p of players) {
    const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((p.x - bounds.minX) / stepX)));
    const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((p.y - bounds.minY) / stepY)));
    const key = `${row}:${col}`;
    const b = buckets.get(key) ?? { row, col, count: 0, names: [], totalSession: 0 };
    b.count += 1;
    b.totalSession += p.sessionSeconds;
    b.names.push(p.name);
    buckets.set(key, b);
  }

  const raw = Array.from(buckets.values()).map((b) => ({
    ...b,
    score: b.count + b.totalSession / 3600,
    centerX: bounds.minX + (b.col + 0.5) * stepX,
    centerY: bounds.minY + (b.row + 0.5) * stepY,
    averageSessionSeconds: b.count > 0 ? Math.round(b.totalSession / b.count) : 0,
  }));

  const maxScore = Math.max(...raw.map((c) => c.score), 1);

  return raw.map((c) => ({
    row: c.row,
    col: c.col,
    count: c.count,
    intensity: c.score / maxScore,
    names: c.names,
    averageSessionSeconds: c.averageSessionSeconds,
    centerX: c.centerX,
    centerY: c.centerY,
  }));
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

export function PlayerHeatmap({ players, refreshIntervalMs = 10_000 }: PlayerHeatmapProps) {
  const { data: polledPlayers } = useApi(() => apiClient.getPlayerPositions(), {
    enabled: refreshIntervalMs > 0,
    refreshInterval: refreshIntervalMs || undefined,
  });
  const zoom = useMapZoom();

  const normalizedPlayers = useMemo(() => normalizePlayerMapData(polledPlayers ?? players), [players, polledPlayers]);
  const bounds = useMemo(() => getPlayerMapBounds(normalizedPlayers), [normalizedPlayers]);
  const cells = useMemo(() => buildHeatGrid(normalizedPlayers, bounds), [normalizedPlayers, bounds]);

  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);

  const emptyMessage = players.length === 0 ? 'No player activity to display' : 'Position telemetry is unavailable for current players.';

  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-th-border-m/80 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-title">Density analysis</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Player Activity Heatmap</h2>
            <p className="mt-2 text-sm text-th-text-m">Grid cells brighten as more players cluster together, weighted by session duration.</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-th-text-m">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-amber-700 dark:text-amber-200">
              <Users className="h-4 w-4" /> {normalizedPlayers.length} sampled
            </span>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div
          className="relative mx-auto overflow-hidden rounded-3xl border border-amber-500/15 sand-glow"
          {...zoom.containerProps}
          style={{
            aspectRatio: '1 / 1',
            width: '100%',
            maxWidth: 'min(92vh, 1600px)',
            ...zoom.containerProps.style,
          }}
        >
          <div style={zoom.transformStyle} className="absolute inset-0">
            {/* Map background - HD 2048x2048 */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'url(/maps/hagga-basin-hd.webp)',
                backgroundSize: '100% 100%',
                backgroundPosition: 'center',
              }}
            />
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-black/55" />

              {/* Grid lines */}
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: 'linear-gradient(rgba(251, 191, 36, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(251, 191, 36, 0.2) 1px, transparent 1px)',
                  backgroundSize: `${100 / GRID_COLS}% ${100 / GRID_ROWS}%`,
                }}
              />

              {/* Heat cells */}
              {cells.map((cell) => {
                const left = ((cell.centerX - bounds.minX) / spanX) * 100;
                const top = 100 - ((cell.centerY - bounds.minY) / spanY) * 100;
                const a = 0.15 + cell.intensity * 0.65;
                const size = 3 + cell.intensity * 5;
                const blur = 20 + cell.intensity * 40;

                return (
                  <div
                    key={`${cell.row}:${cell.col}`}
                    className="group absolute -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: `${clamp(left, 2, 98)}%`,
                      top: `${clamp(top, 2, 98)}%`,
                      width: `${size}rem`,
                      height: `${size}rem`,
                    }}
                  >
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: `radial-gradient(circle, rgba(251, 191, 36, ${(a * 1.2).toFixed(2)}) 0%, rgba(251, 146, 60, ${(a * 0.6).toFixed(2)}) 40%, transparent 70%)`,
                        filter: `blur(${blur}px)`,
                      }}
                    />
                    <div
                      className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-200/80"
                      style={{ backgroundColor: `rgba(251, 191, 36, ${Math.min(a + 0.3, 1).toFixed(2)})` }}
                    />
                    <div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 hidden min-w-max -translate-x-1/2 rounded-xl border border-amber-500/20 bg-th-bg/95 px-3 py-2 text-left text-xs text-th-text-s shadow-2xl group-hover:block">
                      <p className="font-semibold text-amber-700 dark:text-amber-200">
                        {cell.count} player{cell.count === 1 ? '' : 's'}
                      </p>
                      <p className="mt-1 text-th-text-m">Avg. session {formatSessionDuration(cell.averageSessionSeconds)}</p>
                      <p className="mt-1 text-th-text-m">{cell.names.slice(0, 4).join(', ')}{cell.names.length > 4 ? ` +${cell.names.length - 4}` : ''}</p>
                      <p className="mt-1 font-mono text-[10px] text-th-text-m">
                        X: {Math.round(cell.centerX).toLocaleString()} &bull; Y: {Math.round(cell.centerY).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Empty state */}
              {cells.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <div className="rounded-full border border-amber-500/20 bg-amber-500/10 p-4 text-amber-600 dark:text-amber-300">
                    <LocateFixed className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-th-text">{emptyMessage}</p>
                    <p className="mt-2 max-w-md text-sm text-th-text-m">Heat zones appear once online players stream coordinate data.</p>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Fixed overlay labels */}
          <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-amber-400/20 bg-th-bg/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-amber-700/90 dark:text-amber-200/90">
            <Flame className="h-3.5 w-3.5" /> Weighted density
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-th-border/80 bg-th-bg/70 px-2.5 py-1 text-[10px] text-th-text-m">
            X: {Math.round(bounds.minX).toLocaleString()} to {Math.round(bounds.maxX).toLocaleString()} &bull; Y: {Math.round(bounds.minY).toLocaleString()} to {Math.round(bounds.maxY).toLocaleString()}
          </div>

          {/* Zoom controls + legend */}
          <div className="absolute bottom-4 right-4 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-th-border/80 bg-th-bg/70 px-2.5 py-1 text-[10px] text-th-text-m">
              <span className="h-2 w-2 rounded-full bg-amber-500/30" /> Low
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-th-border/80 bg-th-bg/70 px-2.5 py-1 text-[10px] text-th-text-m">
              <span className="h-2 w-2 rounded-full bg-amber-300" /> High
            </span>
            <span className="mx-1 h-4 w-px bg-th-border-m/40" />
            {zoom.scale > 1 ? (
              <span className="rounded-full border border-th-border/80 bg-th-bg/70 px-2.5 py-1 text-[10px] text-th-text-m">
                {Math.round(zoom.scale * 100)}%
              </span>
            ) : null}
            <button type="button" onClick={zoom.zoomIn} className="rounded-full border border-th-border/80 bg-th-bg/70 p-1.5 text-th-text-m hover:bg-th-bg hover:text-th-text transition-colors" aria-label="Zoom in">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={zoom.zoomOut} className="rounded-full border border-th-border/80 bg-th-bg/70 p-1.5 text-th-text-m hover:bg-th-bg hover:text-th-text transition-colors" aria-label="Zoom out">
              <Minus className="h-3.5 w-3.5" />
            </button>
            {zoom.scale > 1 ? (
              <button type="button" onClick={zoom.resetZoom} className="rounded-full border border-th-border/80 bg-th-bg/70 p-1.5 text-th-text-m hover:bg-th-bg hover:text-th-text transition-colors" aria-label="Reset zoom">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
