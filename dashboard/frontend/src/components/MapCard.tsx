'use client';

import { Archive, ChevronDown, ChevronUp, Play, RefreshCcw, Square } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { MapStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

interface MapCardProps {
  map: MapStatus;
  onAction: (mapName: string, action: 'start' | 'stop' | 'restart') => Promise<void> | void;
  onBackup?: (mapName: string) => Promise<void> | void;
}

const badgeStyles: Record<MapStatus['status'], string> = {
  running: 'border-emerald-500/30 bg-emerald-500/10 text-th-accent-success',
  stopped: 'border-th-border bg-th-surface-s/70 text-th-text-s',
  completed: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  error: 'border-red-500/30 bg-red-500/10 text-th-accent-danger',
  starting: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  stopping: 'border-amber-500/30 bg-amber-500/10 text-th-accent',
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function MapCard({ map, onAction, onBackup }: MapCardProps) {
  const [expanded, setExpanded] = useState(false);
  const memoryPercent = useMemo(() => {
    if (!map.memoryLimitMb) {
      return 0;
    }
    return Math.min(100, Math.round((map.memoryUsedMb / map.memoryLimitMb) * 100));
  }, [map.memoryLimitMb, map.memoryUsedMb]);

  return (
    <div className="glass-panel overflow-hidden p-5 transition-[border-color,box-shadow] duration-200 hover:border-amber-500/30 hover:shadow-dune">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-semibold text-th-text">{map.name}</h3>
            <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]', badgeStyles[map.status])}>
              {map.status}
            </span>
          </div>
          <p className="mt-2 text-sm text-th-text-m">{map.players}{map.maxPlayers ? ` / ${map.maxPlayers}` : ''} players online</p>
        </div>
        <button type="button" onClick={() => setExpanded((current) => !current)} className="dune-button-muted" aria-label={expanded ? 'Collapse details' : 'Expand details'}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-th-border/50 bg-th-bg-s/40 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.15em] text-th-text-m">CPU</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-th-text">{map.cpuPercent != null ? `${map.cpuPercent}%` : '-'}</p>
        </div>
        <div className="rounded-xl border border-th-border/50 bg-th-bg-s/40 px-3 py-2">
          <p className="text-xs uppercase tracking-[0.15em] text-th-text-m">Uptime</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-th-text">{map.uptimeSeconds ? formatUptime(map.uptimeSeconds) : '-'}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-sm text-th-text-m">
          <span>Memory footprint</span>
          <span>{map.memoryUsedMb} MB / {map.memoryLimitMb} MB</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-th-surface-s/80">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" style={{ width: `${memoryPercent}%` }} />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {map.status === 'stopped' || map.status === 'error' ? (
          <button type="button" onClick={() => void onAction(map.name, 'start')} className="dune-button">
            <Play className="mr-2 h-4 w-4" /> Start
          </button>
        ) : null}
        {map.status === 'running' ? (
          <button type="button" onClick={() => void onAction(map.name, 'stop')} className="dune-button-muted">
            <Square className="mr-2 h-4 w-4" /> Stop
          </button>
        ) : null}
        {map.status === 'running' || map.status === 'error' ? (
          <button type="button" onClick={() => void onAction(map.name, 'restart')} className="dune-button-muted">
            <RefreshCcw className="mr-2 h-4 w-4" /> Restart
          </button>
        ) : null}
        {onBackup ? (
          <button type="button" onClick={() => void onBackup(map.name)} className="dune-button-muted">
            <Archive className="mr-2 h-4 w-4" /> Backup
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-5 grid gap-3 rounded-2xl border border-th-border/70 bg-th-surface-s/50 p-4 text-sm text-th-text-s sm:grid-cols-2">
          {Object.entries(map.settings ?? {}).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">{key}</p>
              <p className="mt-1 text-base text-th-text">{String(value)}</p>
            </div>
          ))}
          {map.notes ? <p className="sm:col-span-2 text-th-text-m">{map.notes}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
