'use client';

import { LocateFixed, MapPin, Minus, Navigation, Plus, RotateCcw, Send, Users, X } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

import { useApi } from '@/hooks/useApi';
import { useMapZoom } from '@/hooks/useMapZoom';
import { apiClient } from '@/lib/api';
import { DEFAULT_HAGGA_BASIN_BOUNDS, formatSessionDuration, getPlayerMapBounds, normalizePlayerMapData, type NormalizedPlayerMapPoint, type PlayerMapSource } from '@/lib/player-map';
import { cn } from '@/lib/utils';

const GRID_DIVISIONS = 8;

type ViewMode = 'tactical' | 'chart';

/* Preset POI locations on Hagga Basin */
const PRESET_LOCATIONS = [
  { name: 'Arrakeen Landing', x: -50_000, y: 50_000, z: 0 },
  { name: 'Spice Fields North', x: -150_000, y: 200_000, z: 0 },
  { name: 'Deep Canyon', x: 100_000, y: -100_000, z: -5_000 },
  { name: 'Southern Wastes', x: 50_000, y: -300_000, z: 0 },
  { name: 'Map Center', x: -50_000, y: -50_000, z: 0 },
  { name: 'Northwest Ridge', x: -350_000, y: 250_000, z: 2_000 },
  { name: 'Eastern Dunes', x: 250_000, y: 0, z: 0 },
];

interface TeleportTarget {
  x: number;
  y: number;
  z: number;
  label?: string;
}

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
    <div className="rounded-2xl border border-amber-500/20 bg-th-bg/95 px-3 py-2 text-xs text-th-text-s shadow-2xl">
      <p className="font-semibold text-amber-700 dark:text-amber-200">{player.name}</p>
      <p className="mt-1 text-th-text-m">{player.mapLabel}</p>
      <p className="mt-1 text-th-text-m">
        X {Math.round(player.x).toLocaleString()} &bull; Y {Math.round(player.y).toLocaleString()}
      </p>
      <p className="mt-1 text-th-text-m">Session {formatSessionDuration(player.sessionSeconds)}</p>
    </div>
  );
}

/* Teleport confirmation dialog */
function TeleportDialog({
  target,
  players,
  onTeleport,
  onClose,
  teleporting,
}: {
  target: TeleportTarget;
  players: NormalizedPlayerMapPoint[];
  onTeleport: (playerId: string) => void;
  onClose: () => void;
  teleporting: string | null;
}) {
  return (
    <div className="absolute bottom-4 left-4 z-50 w-72 rounded-2xl border border-amber-500/30 bg-th-bg/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-amber-500/15 px-4 py-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-200">Teleport</span>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-th-text-m hover:bg-th-surface-s/50 hover:text-th-text">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-4 py-3">
        {target.label ? (
          <p className="text-sm font-medium text-th-text">{target.label}</p>
        ) : null}
        <p className="mt-1 font-mono text-[10px] text-th-text-m">
          X: {Math.round(target.x).toLocaleString()} &bull; Y: {Math.round(target.y).toLocaleString()} &bull; Z: {Math.round(target.z).toLocaleString()}
        </p>
        {players.length === 0 ? (
          <p className="mt-3 text-xs text-th-text-m">No players online to teleport.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-[10px] uppercase tracking-[0.15em] text-th-text-m">Select player to teleport</p>
            {players.map((player) => (
              <button
                key={player.steamId}
                type="button"
                disabled={teleporting !== null}
                onClick={() => onTeleport(player.steamId)}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                  teleporting === player.steamId
                    ? 'border-cyan-500/40 bg-cyan-500/10'
                    : 'border-th-border-m/60 bg-th-surface-s/30 hover:border-amber-500/30 hover:bg-amber-500/5',
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: player.fill }} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-th-text">{player.name}</span>
                {teleporting === player.steamId ? (
                  <span className="shrink-0 text-[10px] text-cyan-400">Sending...</span>
                ) : (
                  <Send className="h-3 w-3 shrink-0 text-th-text-m" />
                )}
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] text-th-text-m/70">Player must relog for teleport to take effect.</p>
      </div>
    </div>
  );
}

/* Manual coordinate input panel */
function ManualTeleportInput({
  onSubmit,
  onClose,
}: {
  onSubmit: (x: number, y: number, z: number) => void;
  onClose: () => void;
}) {
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [z, setZ] = useState('0');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nx = parseFloat(x);
    const ny = parseFloat(y);
    const nz = parseFloat(z) || 0;
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      onSubmit(nx, ny, nz);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex-1">
        <label className="text-[10px] uppercase tracking-[0.15em] text-th-text-m">X</label>
        <input type="number" value={x} onChange={(e) => setX(e.target.value)} placeholder="-50000"
          className="mt-0.5 w-full rounded-lg border border-th-border-m/60 bg-th-surface-s/30 px-2.5 py-1.5 font-mono text-xs text-th-text placeholder:text-th-text-m/50 focus:border-amber-500/40 focus:outline-none" />
      </div>
      <div className="flex-1">
        <label className="text-[10px] uppercase tracking-[0.15em] text-th-text-m">Y</label>
        <input type="number" value={y} onChange={(e) => setY(e.target.value)} placeholder="50000"
          className="mt-0.5 w-full rounded-lg border border-th-border-m/60 bg-th-surface-s/30 px-2.5 py-1.5 font-mono text-xs text-th-text placeholder:text-th-text-m/50 focus:border-amber-500/40 focus:outline-none" />
      </div>
      <div className="flex-1">
        <label className="text-[10px] uppercase tracking-[0.15em] text-th-text-m">Z</label>
        <input type="number" value={z} onChange={(e) => setZ(e.target.value)} placeholder="0"
          className="mt-0.5 w-full rounded-lg border border-th-border-m/60 bg-th-surface-s/30 px-2.5 py-1.5 font-mono text-xs text-th-text placeholder:text-th-text-m/50 focus:border-amber-500/40 focus:outline-none" />
      </div>
      <button type="submit" disabled={!x || !y}
        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-40">
        Set Pin
      </button>
      <button type="button" onClick={onClose}
        className="rounded-lg border border-th-border-m/60 px-2 py-1.5 text-xs text-th-text-m hover:bg-th-surface-s/50">
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}

export function HaggaBasinMap({ players, refreshIntervalMs = 10_000 }: HaggaBasinMapProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('tactical');
  const [teleportTarget, setTeleportTarget] = useState<TeleportTarget | null>(null);
  const [teleporting, setTeleporting] = useState<string | null>(null);
  const [teleportResult, setTeleportResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const zoom = useMapZoom();
  const { data: polledPlayers } = useApi(() => apiClient.getPlayerPositions(), {
    enabled: refreshIntervalMs > 0,
    refreshInterval: refreshIntervalMs || undefined,
  });

  const sourcePlayers = polledPlayers ?? players;
  const normalizedPlayers = useMemo(() => normalizePlayerMapData(sourcePlayers), [sourcePlayers]);
  const bounds = useMemo(() => getPlayerMapBounds(normalizedPlayers), [normalizedPlayers]);

  /* Use full Hagga Basin bounds for click-to-coordinate mapping */
  const mapBounds = DEFAULT_HAGGA_BASIN_BOUNDS;

  /* In tactical view, position everything using full map bounds so dots and pins
     align with the HD background image. Chart view uses player-relative bounds. */
  const plottedPlayers = useMemo(() => {
    const b = mapBounds;
    const spanX = Math.max(b.maxX - b.minX, 1);
    const spanY = Math.max(b.maxY - b.minY, 1);

    return normalizedPlayers.map((player) => ({
      ...player,
      left: clamp(((player.x - b.minX) / spanX) * 100, 1, 99),
      top: clamp(100 - ((player.y - b.minY) / spanY) * 100, 1, 99),
    }));
  }, [mapBounds, normalizedPlayers]);

  /* Convert a teleport target to percent position on the map (same bounds as dots) */
  const targetPosition = useMemo(() => {
    if (!teleportTarget) return null;
    const b = mapBounds;
    const spanX = Math.max(b.maxX - b.minX, 1);
    const spanY = Math.max(b.maxY - b.minY, 1);
    return {
      left: clamp(((teleportTarget.x - b.minX) / spanX) * 100, 0, 100),
      top: clamp(100 - ((teleportTarget.y - b.minY) / spanY) * 100, 0, 100),
    };
  }, [teleportTarget, mapBounds]);

  /* Click on tactical map to place a teleport pin */
  const handleMapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (zoom.scale > 1) return; // Disable click-to-pin while zoomed (prevents misclicks during pan)
      const rect = e.currentTarget.getBoundingClientRect();
      const pctX = (e.clientX - rect.left) / rect.width;
      const pctY = (e.clientY - rect.top) / rect.height;
      const spanX = mapBounds.maxX - mapBounds.minX;
      const spanY = mapBounds.maxY - mapBounds.minY;
      const gameX = mapBounds.minX + pctX * spanX;
      const gameY = mapBounds.maxY - pctY * spanY; // Y is inverted (top=maxY)
      setTeleportTarget({ x: gameX, y: gameY, z: 0 });
      setTeleportResult(null);
    },
    [mapBounds, zoom.scale],
  );

  /* Execute teleport via API */
  const handleTeleport = useCallback(
    async (steamId: string) => {
      if (!teleportTarget) return;
      setTeleporting(steamId);
      setTeleportResult(null);
      try {
        // The API expects account_id (character_id), not steamId. Find the matching player.
        // For now, use steamId as character_id since that's how the API works
        await apiClient.teleportCharacter(steamId, teleportTarget.x, teleportTarget.y, teleportTarget.z);
        setTeleportResult({ success: true, message: `Teleported to (${Math.round(teleportTarget.x)}, ${Math.round(teleportTarget.y)}). Relog to apply.` });
      } catch (err) {
        setTeleportResult({ success: false, message: err instanceof Error ? err.message : 'Teleport failed' });
      } finally {
        setTeleporting(null);
      }
    },
    [teleportTarget],
  );

  const emptyMessage = sourcePlayers.length === 0 ? 'No players online' : 'Players are online, but coordinate telemetry is unavailable.';

  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-th-border-m/80 p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="section-title">Live map telemetry</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Hagga Basin Tactical Overlay</h2>
            <p className="mt-2 max-w-3xl text-sm text-th-text-m">
              Live player positions. Click on the map to place a teleport pin, then select a player to move. Use presets for common locations.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-th-text-m">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-amber-700 dark:text-amber-200">
              <Users className="h-4 w-4" /> {plottedPlayers.length} tracked
            </span>
            {refreshIntervalMs > 0 ? <span>Refreshes every {Math.round(refreshIntervalMs / 1000)}s</span> : null}
            <div className="inline-flex rounded-full border border-th-border/80 bg-th-bg/80 p-1">
              {(['tactical', 'chart'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition-colors',
                    viewMode === mode ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200' : 'text-th-text-m hover:text-th-text-s',
                  )}
                >
                  {mode === 'tactical' ? 'Tactical' : 'Chart'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Teleport toolbar */}
      <div className="border-b border-th-border-m/60 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Navigation className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-th-text-m">Teleport Controls</span>
          <div className="mx-2 h-4 w-px bg-th-border-m/60" />

          {/* Preset locations dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPresets(!showPresets)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                showPresets
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-th-border-m/60 text-th-text-m hover:border-amber-500/30 hover:text-th-text',
              )}
            >
              <MapPin className="mr-1.5 inline-block h-3 w-3" />
              Presets
            </button>
            {showPresets ? (
              <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-amber-500/20 bg-th-bg/95 py-1 shadow-2xl backdrop-blur-xl">
                {PRESET_LOCATIONS.map((loc) => (
                  <button
                    key={loc.name}
                    type="button"
                    onClick={() => {
                      setTeleportTarget({ x: loc.x, y: loc.y, z: loc.z, label: loc.name });
                      setShowPresets(false);
                      setTeleportResult(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-amber-500/10"
                  >
                    <MapPin className="h-3 w-3 shrink-0 text-amber-500/60" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-th-text">{loc.name}</p>
                      <p className="font-mono text-[10px] text-th-text-m">{loc.x.toLocaleString()}, {loc.y.toLocaleString()}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Manual coordinate input toggle */}
          <button
            type="button"
            onClick={() => setShowManualInput(!showManualInput)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              showManualInput
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-th-border-m/60 text-th-text-m hover:border-amber-500/30 hover:text-th-text',
            )}
          >
            Coordinates
          </button>

          {/* Clear pin */}
          {teleportTarget ? (
            <button
              type="button"
              onClick={() => { setTeleportTarget(null); setTeleportResult(null); }}
              className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
            >
              Clear Pin
            </button>
          ) : null}

          {/* Teleport result toast */}
          {teleportResult ? (
            <span className={cn(
              'ml-auto rounded-full px-3 py-1 text-xs font-medium',
              teleportResult.success
                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                : 'border border-red-500/20 bg-red-500/10 text-red-400',
            )}>
              {teleportResult.message}
            </span>
          ) : (
            <span className="ml-auto text-[10px] text-th-text-m/60">Click map to place pin, or use presets</span>
          )}
        </div>

        {/* Manual input row */}
        {showManualInput ? (
          <div className="mt-2">
            <ManualTeleportInput
              onSubmit={(x, y, z) => {
                setTeleportTarget({ x, y, z, label: `Custom (${Math.round(x)}, ${Math.round(y)})` });
                setShowManualInput(false);
                setTeleportResult(null);
              }}
              onClose={() => setShowManualInput(false)}
            />
          </div>
        ) : null}
      </div>

      <div className="p-5">
        {viewMode === 'tactical' ? (
          <div
            className={cn(
              'relative overflow-hidden rounded-3xl border sand-glow',
              teleportTarget ? 'border-cyan-500/30' : 'border-amber-500/15',
              zoom.scale <= 1 ? 'cursor-crosshair' : 'cursor-grab',
            )}
            {...zoom.containerProps}
            style={{ aspectRatio: '1 / 1', ...zoom.containerProps.style, cursor: zoom.scale <= 1 ? 'crosshair' : 'grab' }}
            onClick={handleMapClick}
          >
            <div style={zoom.transformStyle} className="absolute inset-0">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: 'url(/maps/hagga-basin-hd.webp)',
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                }}
              />
              <div className="absolute inset-0 bg-black/40" />
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-25"
                style={{
                  backgroundImage: 'linear-gradient(rgba(251, 191, 36, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(251, 191, 36, 0.15) 1px, transparent 1px)',
                  backgroundSize: `${100 / GRID_DIVISIONS}% ${100 / GRID_DIVISIONS}%`,
                }}
              />

              {plottedPlayers.length === 0 && !teleportTarget ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <div className="rounded-full border border-amber-500/20 bg-amber-500/10 p-4 text-amber-600 dark:text-amber-300">
                    <LocateFixed className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-th-text">{emptyMessage}</p>
                    <p className="mt-2 max-w-md text-sm text-th-text-m">
                      Click anywhere on the map to place a teleport pin, or use preset locations above.
                    </p>
                  </div>
                </div>
              ) : null}

              {/* Player dots */}
              {plottedPlayers.map((player, index) => (
                <button
                  key={`${player.steamId}-${index}`}
                  type="button"
                  className="group absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${player.left}%`, top: `${player.top}%` }}
                  aria-label={`${player.name} on ${player.mapLabel}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/20 blur-md" />
                  <span className="relative block h-3.5 w-3.5 rounded-full border-2 border-amber-100 bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.75)] transition-transform duration-150 ease-[var(--ease-out-expo)] group-hover:scale-125" />
                  <span className="pointer-events-none absolute bottom-[calc(100%+0.75rem)] left-1/2 hidden min-w-max -translate-x-1/2 rounded-xl border border-amber-500/20 bg-th-bg/95 px-3 py-2 text-left text-xs text-th-text-s shadow-2xl group-hover:block">
                    <span className="block font-semibold text-amber-700 dark:text-amber-200">{player.name}</span>
                    <span className="mt-1 block text-th-text-m">{player.mapLabel}</span>
                    <span className="mt-1 block font-mono text-[10px] text-th-text-m">
                      X: {Math.round(player.x).toLocaleString()} &bull; Y: {Math.round(player.y).toLocaleString()}{player.z !== null ? ` • Z: ${Math.round(player.z).toLocaleString()}` : ''}
                    </span>
                  </span>
                </button>
              ))}

              {/* Teleport target pin */}
              {targetPosition ? (
                <div
                  className="absolute -translate-x-1/2 -translate-y-full"
                  style={{ left: `${targetPosition.left}%`, top: `${targetPosition.top}%` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="relative">
                    <MapPin className="h-8 w-8 text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.6)]" fill="rgba(34,211,238,0.3)" />
                    <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-cyan-500/30 bg-th-bg/90 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                      {teleportTarget?.label ?? `${Math.round(teleportTarget?.x ?? 0)}, ${Math.round(teleportTarget?.y ?? 0)}`}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Fixed overlay labels */}
            <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-amber-400/20 bg-th-bg/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-amber-700/90 dark:text-amber-200/90">
              Hagga Basin
            </div>
            <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-1 text-[10px] text-th-text-m">
              <span className="rounded-full border border-th-border/80 bg-th-bg/70 px-2.5 py-0.5">
                X: {Math.round(mapBounds.minX).toLocaleString()} to {Math.round(mapBounds.maxX).toLocaleString()}
              </span>
              <span className="rounded-full border border-th-border/80 bg-th-bg/70 px-2.5 py-0.5">
                Y: {Math.round(mapBounds.minY).toLocaleString()} to {Math.round(mapBounds.maxY).toLocaleString()}
              </span>
            </div>

            {/* Zoom controls */}
            <div className="absolute bottom-4 right-4 flex items-center gap-1">
              {zoom.scale > 1 ? (
                <span className="mr-1 rounded-full border border-th-border/80 bg-th-bg/70 px-2.5 py-1 text-[10px] text-th-text-m">
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

            {/* Teleport dialog (anchored to map) */}
            {teleportTarget ? (
              <TeleportDialog
                target={teleportTarget}
                players={normalizedPlayers}
                onTeleport={handleTeleport}
                onClose={() => { setTeleportTarget(null); setTeleportResult(null); }}
                teleporting={teleporting}
              />
            ) : null}
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
                <div className="rounded-full border border-amber-500/20 bg-amber-500/10 p-4 text-amber-600 dark:text-amber-300">
                  <LocateFixed className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-th-text">{emptyMessage}</p>
                  <p className="mt-2 max-w-md text-sm text-th-text-m">Switch back to Tactical view once live coordinates begin flowing again.</p>
                </div>
              </div>
            ) : (
              <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2 text-xs text-th-text-s">
                <span className="rounded-full border border-amber-500/20 bg-th-bg/70 px-3 py-1">Survival <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" /></span>
                <span className="rounded-full border border-amber-500/20 bg-th-bg/70 px-3 py-1">Overmap <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-[#60a5fa]" /></span>
                <span className="rounded-full border border-amber-500/20 bg-th-bg/70 px-3 py-1">DeepDesert <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-[#fb923c]" /></span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Player coordinate cards with teleport-to-player buttons */}
      {normalizedPlayers.length > 0 ? (
        <div className="border-t border-th-border-m/80 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-th-text-m">Player Coordinates</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {normalizedPlayers.map((player) => (
              <div
                key={player.steamId}
                className="flex items-center gap-3 rounded-2xl border border-th-border-m/60 bg-th-surface-s/30 px-4 py-2.5"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: player.fill }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-th-text">{player.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-th-text-m">
                    X: {Math.round(player.x).toLocaleString()} &bull; Y: {Math.round(player.y).toLocaleString()}{player.z !== null ? ` • Z: ${Math.round(player.z).toLocaleString()}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTeleportTarget({ x: player.x, y: player.y, z: player.z ?? 0, label: `${player.name}'s location` });
                    setTeleportResult(null);
                  }}
                  className="shrink-0 rounded-lg border border-th-border-m/60 p-1.5 text-th-text-m transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-400"
                  title={`Set teleport pin at ${player.name}'s location`}
                >
                  <MapPin className="h-3.5 w-3.5" />
                </button>
                <span className="shrink-0 text-[10px] text-th-text-m">{formatSessionDuration(player.sessionSeconds)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
