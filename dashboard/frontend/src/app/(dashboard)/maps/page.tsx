'use client';

import { Archive, Info, RefreshCcw, Square } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';

import { MapCardSkeleton } from '@/components/Skeleton';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

const HaggaBasinMap = dynamic(() => import('@/components/HaggaBasinMap').then((mod) => mod.HaggaBasinMap), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-3xl bg-th-surface/50" />,
});

const MapCard = dynamic(() => import('@/components/MapCard').then((mod) => mod.MapCard), {
  ssr: false,
  loading: () => <MapCardSkeleton />,
});

export default function MapsPage() {
  const { data: maps = [], loading, refetch } = useApi(() => apiClient.getMaps(), { refreshInterval: 15000, initialData: [] });
  const { data: players = [] } = useApi(() => apiClient.getPlayerPositions(), { refreshInterval: 10000, initialData: [] });
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  const totals = useMemo(() => {
    const used = maps.reduce((sum, map) => sum + map.memoryUsedMb, 0);
    const limit = maps.reduce((sum, map) => sum + map.memoryLimitMb, 0);
    return { used, limit, percent: limit > 0 ? Math.round((used / limit) * 100) : 0 };
  }, [maps]);

  const handleAction = useCallback(async (name: string, action: 'start' | 'stop' | 'restart') => {
    if (action === 'start') await apiClient.startMap(name);
    if (action === 'stop') await apiClient.stopMap(name);
    if (action === 'restart') await apiClient.restartMap(name);
    await refetch();
  }, [refetch]);

  const handleBulk = useCallback(async (action: 'restart' | 'stop') => {
    await Promise.all(maps.map((map) => (action === 'restart' ? apiClient.restartMap(map.name) : apiClient.stopMap(map.name))));
    await refetch();
  }, [maps, refetch]);

  const handleBackup = useCallback(async (name: string) => {
    try {
      setBackupMessage(`Creating backup for ${name}...`);
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
            <h2 className="mt-1 text-xl font-semibold text-th-text">Shard Fleet</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void handleBulk('restart')} className="dune-button">
              <RefreshCcw className="mr-2 h-4 w-4" /> Restart all
            </button>
            <button type="button" onClick={() => void handleBulk('stop')} className="dune-button-muted">
              <Square className="mr-2 h-4 w-4" /> Stop all
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
            <Archive className="h-4 w-4 shrink-0" />
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

      <div className="glass-panel p-5">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
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
