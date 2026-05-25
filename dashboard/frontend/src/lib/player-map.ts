import type { Player, PlayerPosition } from '@/lib/types';

// Real Hagga Basin bounds from cdn.th.gl/dune-awakening/config/tiles.json
export const DEFAULT_HAGGA_BASIN_BOUNDS = {
  minX: -457_599,
  maxX: 355_199,
  minY: -457_599,
  maxY: 355_199,
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

  // Use player spread or a minimum 20K unit window, whichever is larger
  const spanX = Math.max(maxX - minX, 20_000);
  const spanY = Math.max(maxY - minY, 20_000);
  const paddingX = spanX * 0.15;
  const paddingY = spanY * 0.15;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    minX: centerX - spanX / 2 - paddingX,
    maxX: centerX + spanX / 2 + paddingX,
    minY: centerY - spanY / 2 - paddingY,
    maxY: centerY + spanY / 2 + paddingY,
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
