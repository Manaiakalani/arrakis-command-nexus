'use client';

import { Archive, Building2, Car, Info, Map, MapPin, RefreshCcw, Square, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';

import { MapCardSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { BaseRecord, VehicleRecord, PlayerPosition } from '@/lib/types';
import { cn } from '@/lib/utils';

const HaggaBasinMap = dynamic(() => import('@/components/HaggaBasinMap').then((mod) => mod.HaggaBasinMap), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-3xl bg-th-surface/50" />,
});

const MapCard = dynamic(() => import('@/components/MapCard').then((mod) => mod.MapCard), {
  ssr: false,
  loading: () => <MapCardSkeleton />,
});

export default function MapsPage() {
  const { toast } = useToast();
  const { data: maps = [], loading, refetch } = useApi(() => apiClient.getMaps(), { refreshInterval: 15000, initialData: [] });
  const { data: players = [] } = useApi(() => apiClient.getPlayerPositions(), { refreshInterval: 10000, initialData: [] });
  const bases = useApi(() => apiClient.getBases(), { refreshInterval: 30000, initialData: [] });
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [selectedMapVehicles, setSelectedMapVehicles] = useState<string | null>(null);
  const vehicles = useApi(
    () => selectedMapVehicles ? apiClient.getVehicles(selectedMapVehicles) : Promise.resolve([]),
    { refreshInterval: 30000, initialData: [], enabled: !!selectedMapVehicles, deps: [selectedMapVehicles] },
  );

  const totals = useMemo(() => {
    const used = maps.reduce((sum, map) => sum + map.memoryUsedMb, 0);
    const limit = maps.reduce((sum, map) => sum + map.memoryLimitMb, 0);
    return { used, limit, percent: limit > 0 ? Math.round((used / limit) * 100) : 0 };
  }, [maps]);

  const handleAction = useCallback(async (name: string, action: 'start' | 'stop' | 'restart') => {
    try {
      if (action === 'start') await apiClient.startMap(name);
      if (action === 'stop') await apiClient.stopMap(name);
      if (action === 'restart') await apiClient.restartMap(name);
      await refetch();
      toast(`${name}: ${action} successful`, 'success');
    } catch (err) {
      toast(`${name}: ${action} failed${err instanceof Error ? ` - ${err.message}` : ''}`, 'error');
    }
  }, [refetch, toast]);

  const handleBulk = useCallback(async (action: 'restart' | 'stop') => {
    try {
      await Promise.all(maps.map((map) => (action === 'restart' ? apiClient.restartMap(map.name) : apiClient.stopMap(map.name))));
      await refetch();
      toast(`${action === 'restart' ? 'Restart' : 'Stop'} all completed`, 'success');
    } catch (err) {
      toast(`Bulk ${action} failed${err instanceof Error ? ` - ${err.message}` : ''}`, 'error');
    }
  }, [maps, refetch, toast]);

  const handleBackup = useCallback(async (name: string) => {
    try {
      setBackupMessage(`Creating backup for ${name}…`);
      await apiClient.backupMap(name);
      setBackupMessage(`Backup created for ${name}.`);
      setTimeout(() => setBackupMessage(null), 5000);
    } catch {
      setBackupMessage(`Failed to create backup for ${name}.`);
      setTimeout(() => setBackupMessage(null), 5000);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="glass-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-title">Map orchestration</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><Map aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Shard Fleet</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void handleBulk('restart')} className="dune-button">
              <RefreshCcw aria-hidden="true" className="mr-2 h-4 w-4" /> Restart all
            </button>
            <button type="button" onClick={() => void handleBulk('stop')} className="dune-button-muted">
              <Square aria-hidden="true" className="mr-2 h-4 w-4" /> Stop all
            </button>
          </div>
        </div>
        <div className="mt-6">
          <div className="flex items-center justify-between text-sm text-th-text-m">
            <span>Overall memory usage</span>
            <span>{Math.round(totals.used)} MB / {Math.round(totals.limit)} MB</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-th-surface-s/80">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" style={{ width: `${totals.percent}%` }} />
          </div>
        </div>
        {backupMessage ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-200">
            <Archive aria-hidden="true" className="h-4 w-4 shrink-0" />
            {backupMessage}
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {loading && maps.length === 0 ? (
          <>
            <MapCardSkeleton />
            <MapCardSkeleton />
          </>
        ) : (
          maps.map((map) => (
            <MapCard key={map.name} map={map} onAction={handleAction} onBackup={handleBackup} />
          ))
        )}
      </div>

      {/* Map Intelligence */}
      <section className="glass-panel p-5">
        <p className="section-title">Map intelligence</p>
        <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><MapPin aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Per-Map Analytics</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((map) => {
            const mapPlayers = players.filter((p) => p.map === map.name);
            const mapBases = (bases.data ?? []).filter((b) => {
              const partId = b.partition_id;
              return partId != null;
            });
            const isSelected = selectedMapVehicles === map.name;
            const mapVehicles = isSelected ? (vehicles.data ?? []) : [];

            // Compute most active zones from player positions
            const zones: Record<string, number> = {};
            for (const p of mapPlayers) {
              if (p.x != null && p.y != null) {
                const zoneX = Math.floor((p.x ?? 0) / 50000);
                const zoneY = Math.floor((p.y ?? 0) / 50000);
                const key = `${zoneX},${zoneY}`;
                zones[key] = (zones[key] ?? 0) + 1;
              }
            }
            const topZones = Object.entries(zones).sort((a, b) => b[1] - a[1]).slice(0, 3);

            return (
              <div key={map.name} className={cn('rounded-2xl border p-4', map.status === 'running' ? 'border-emerald-500/15 bg-th-surface-s/50' : 'border-th-border-m/80 bg-th-surface-s/30')}>
                <h3 className="truncate font-semibold text-th-text">{map.name}</h3>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5 text-th-text-m"><Users aria-hidden="true" className="h-3.5 w-3.5" /> Players</span>
                    <span className="font-semibold tabular-nums text-th-text">{mapPlayers.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5 text-th-text-m"><Building2 aria-hidden="true" className="h-3.5 w-3.5" /> Bases</span>
                    <span className="font-semibold tabular-nums text-th-text">{mapBases.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5 text-th-text-m"><Car aria-hidden="true" className="h-3.5 w-3.5" /> Vehicles</span>
                    {isSelected ? (
                      <span className="font-semibold tabular-nums text-th-text">{mapVehicles.length}</span>
                    ) : (
                      <button type="button" onClick={() => setSelectedMapVehicles(map.name)} className="text-xs text-amber-600 underline hover:text-amber-700 dark:text-amber-400">
                        Load
                      </button>
                    )}
                  </div>
                </div>
                {topZones.length > 0 && (
                  <div className="mt-3 border-t border-th-border-m/60 pt-3">
                    <p className="text-[10px] uppercase tracking-wider text-th-text-m">Most active zones</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {topZones.map(([zone, count]) => (
                        <span key={zone} className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-200">
                          {count} player{count > 1 ? 's' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="glass-panel p-5">
        <div className="flex items-start gap-3">
          <Info aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <h3 className="text-base font-semibold text-th-text">Adding maps</h3>
            <p className="mt-1 text-sm leading-relaxed text-th-text-m">
              To add a new map shard, define a new service in <code className="rounded bg-th-surface px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-300">docker-compose.basic.yml</code> using
              the game server image and set the <code className="rounded bg-th-surface px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-300">PARTITION_MAP_NAME</code> environment variable
              to the desired map name. Restart the stack with <code className="rounded bg-th-surface px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-300">docker compose up -d</code> and
              the new shard will appear here automatically. Use the Backups page to create a snapshot before making changes.
            </p>
          </div>
        </div>
      </div>

      <HaggaBasinMap players={players} refreshIntervalMs={0} />
    </div>
  );
}
