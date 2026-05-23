import type { Player, PlayerPosition } from '@/lib/types';

export const DEFAULT_HAGGA_BASIN_BOUNDS = {
  minX: -500_000,
  maxX: 500_000,
  minY: -500_000,
  maxY: 500_000,
};

export type PlayerMapSource = Player | PlayerPosition;

export interface NormalizedPlayerMapPoint {
  name: string;
  steamId: string;
  mapLabel: string;
  map: string;
  x: number;
  y: number;
  z: number | null;
  sessionSeconds: number;
  fill: string;
}

export function resolveCoordinate(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getPlayerMapColor(mapLabel: string) {
  const normalized = mapLabel.toLowerCase();

  if (normalized.includes('overmap')) {
    return '#60a5fa';
  }

  if (normalized.includes('deep')) {
    return '#fb923c';
  }

  return '#f59e0b';
}

export function normalizePlayerMapData(players: PlayerMapSource[]): NormalizedPlayerMapPoint[] {
  return players
    .map((player) => {
      const position = 'position' in player ? player.position : undefined;
      const mapName = 'map_name' in player ? player.map_name : undefined;
      const x = resolveCoordinate(player.x ?? position?.x);
      const y = resolveCoordinate(player.y ?? position?.y);
      const z = resolveCoordinate(player.z ?? position?.z);
      const mapLabel = mapName ?? player.map ?? 'Unknown map';

      return {
        name: player.name || 'Unknown',
        steamId: player.steamId,
        mapLabel,
        map: player.map ?? mapLabel,
        x,
        y,
        z,
        sessionSeconds: Math.max(0, player.sessionSeconds ?? 0),
        fill: getPlayerMapColor(mapLabel),
      };
    })
    .filter((player): player is NormalizedPlayerMapPoint => player.x !== null && player.y !== null);
}

export function getPlayerMapBounds(players: Array<{ x: number; y: number }>) {
  if (players.length === 0) {
    return DEFAULT_HAGGA_BASIN_BOUNDS;
  }

  const xs = players.map((player) => player.x);
  const ys = players.map((player) => player.y);
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
}

export function formatSessionDuration(seconds: number) {
  if (seconds < 3600) {
    return `${Math.max(1, Math.round(seconds / 60))}m`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
