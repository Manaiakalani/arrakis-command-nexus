'use client';

import { Play, Square } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { HaggaBasinMap } from '@/components/HaggaBasinMap';
import { MapCard } from '@/components/MapCard';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

export default function MapsPage() {
  const { data: maps = [], refetch } = useApi(() => apiClient.getMaps(), { refreshInterval: 15000, initialData: [] });
  const { data: players = [] } = useApi(() => apiClient.getPlayerPositions(), { refreshInterval: 10000, initialData: [] });

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

  const handleBulk = useCallback(async (action: 'start' | 'stop') => {
    await Promise.all(maps.map((map) => (action === 'start' ? apiClient.startMap(map.name) : apiClient.stopMap(map.name))));
    await refetch();
  }, [maps, refetch]);

  return (
    <div className="space-y-6">
      <div className="glass-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-title">Map orchestration</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-50">Shard fleet</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void handleBulk('start')} className="dune-button">
              <Play className="mr-2 h-4 w-4" /> Start all
            </button>
            <button type="button" onClick={() => void handleBulk('stop')} className="dune-button-muted">
              <Square className="mr-2 h-4 w-4" /> Stop all
            </button>
          </div>
        </div>
        <div className="mt-6">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>Overall memory usage</span>
            <span>{totals.used} MB / {totals.limit} MB</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-900/80">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" style={{ width: `${totals.percent}%` }} />
          </div>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {maps.map((map) => (
          <MapCard key={map.name} map={map} onAction={handleAction} />
        ))}
      </div>
      <HaggaBasinMap players={players} refreshIntervalMs={0} />
    </div>
  );
}
