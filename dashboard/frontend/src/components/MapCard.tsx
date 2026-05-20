'use client';

import { ChevronDown, ChevronUp, Play, RefreshCcw, Square } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { MapStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

interface MapCardProps {
  map: MapStatus;
  onAction: (mapName: string, action: 'start' | 'stop' | 'restart') => Promise<void> | void;
}

const badgeStyles: Record<MapStatus['status'], string> = {
  running: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  stopped: 'border-slate-600 bg-slate-900/70 text-slate-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  starting: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  stopping: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
};

export function MapCard({ map, onAction }: MapCardProps) {
  const [expanded, setExpanded] = useState(false);
  const memoryPercent = useMemo(() => {
    if (!map.memoryLimitMb) {
      return 0;
    }
    return Math.min(100, Math.round((map.memoryUsedMb / map.memoryLimitMb) * 100));
  }, [map.memoryLimitMb, map.memoryUsedMb]);

  return (
    <div className="glass-panel overflow-hidden p-5 transition hover:border-amber-500/30 hover:shadow-dune">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-semibold text-slate-50">{map.name}</h3>
            <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]', badgeStyles[map.status])}>
              {map.status}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-400">{map.players}{map.maxPlayers ? ` / ${map.maxPlayers}` : ''} players online</p>
        </div>
        <button type="button" onClick={() => setExpanded((current) => !current)} className="dune-button-muted">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>Memory footprint</span>
          <span>{map.memoryUsedMb} MB / {map.memoryLimitMb} MB</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-900/80">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" style={{ width: `${memoryPercent}%` }} />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => void onAction(map.name, 'start')} className="dune-button">
          <Play className="mr-2 h-4 w-4" /> Start
        </button>
        <button type="button" onClick={() => void onAction(map.name, 'stop')} className="dune-button-muted">
          <Square className="mr-2 h-4 w-4" /> Stop
        </button>
        <button type="button" onClick={() => void onAction(map.name, 'restart')} className="dune-button-muted">
          <RefreshCcw className="mr-2 h-4 w-4" /> Restart
        </button>
      </div>

      {expanded ? (
        <div className="mt-5 grid gap-3 rounded-2xl border border-slate-700/70 bg-slate-900/50 p-4 text-sm text-slate-300 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">CPU</p>
            <p className="mt-1 text-base text-slate-100">{map.cpuPercent ?? 0}%</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Uptime</p>
            <p className="mt-1 text-base text-slate-100">{map.uptimeSeconds ? `${Math.floor(map.uptimeSeconds / 3600)}h` : '—'}</p>
          </div>
          {Object.entries(map.settings ?? {}).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{key}</p>
              <p className="mt-1 text-base text-slate-100">{String(value)}</p>
            </div>
          ))}
          {map.notes ? <p className="sm:col-span-2 text-slate-400">{map.notes}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
