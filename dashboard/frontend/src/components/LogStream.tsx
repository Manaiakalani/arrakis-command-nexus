'use client';

import { Search, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiClient } from '@/lib/api';
import { useSSE } from '@/hooks/useSSE';
import type { LogEvent, Severity } from '@/lib/types';
import { cn } from '@/lib/utils';

const severityClasses: Record<Severity, string> = {
  ERROR: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  WARN: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  INFO: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  DEBUG: 'border-th-border bg-th-surface text-th-text-s',
};

function parseLogEvent(raw: unknown): LogEvent {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: new Date().toISOString(),
        service: 'gateway',
        level: (raw as string).includes('ERROR') ? 'ERROR' : (raw as string).includes('WARN') ? 'WARN' : 'INFO',
        message: raw as string,
      };
    }
  }

  const parsed = raw as Partial<LogEvent>;
  return {
    id: parsed.id ?? `${Date.now()}-${Math.random()}`,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
    service: parsed.service ?? 'gateway',
    level: parsed.level ?? 'INFO',
    message: parsed.message ?? String(raw),
  };
}

interface LogStreamProps {
  endpoint: string;
  selectedService?: string;
  onServiceChange?: (service: string) => void;
  services?: string[];
  externalSearch?: string;
  timeRangeMs?: number;
}

export function LogStream({ endpoint, selectedService: controlledService, onServiceChange, services, externalSearch, timeRangeMs }: LogStreamProps) {
  const [uncontrolledService, setUncontrolledService] = useState('all');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [seedLogs, setSeedLogs] = useState<LogEvent[]>([]);
  const [sseMessages, setSseMessages] = useState<LogEvent[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEvent = useCallback((event: { type: string; data: unknown }) => {
    const logEvent = parseLogEvent(event.data);
    setSseMessages((prev) => [...prev, logEvent].slice(-2000));
  }, []);

  const { status } = useSSE(endpoint, { onEvent: handleEvent });
  const selectedService = controlledService ?? uncontrolledService;

  // Fetch initial log tail on mount
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const fetchInitial = async () => {
      try {
        const containers = await apiClient.getServices();
        const running = containers.filter((s) => s.status === 'healthy' || s.status === 'starting').map((s) => s.name);
        const results = await Promise.all(
          running.slice(0, 10).map(async (svc) => {
            try {
              const data = await apiClient.getServiceLogs(svc, 50);
              return (data.entries ?? []).map((e: Record<string, string>) => ({
                id: `seed-${svc}-${Math.random()}`,
                timestamp: e.timestamp ?? new Date().toISOString(),
                service: svc,
                level: (e.severity ?? 'INFO') as Severity,
                message: e.message ?? '',
              }));
            } catch {
              return [];
            }
          }),
        );
        const all = results.flat().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        setSeedLogs(all);
      } catch {
        // Silently fail — SSE will still provide live logs
      }
    };
    void fetchInitial();
  }, []);

  const allMessages = useMemo(() => {
    const sseIds = new Set(sseMessages.map((m) => m.id));
    const deduped = seedLogs.filter((s) => !sseIds.has(s.id));
    return [...deduped, ...sseMessages];
  }, [seedLogs, sseMessages]);

  const availableServices = useMemo(() => {
    const fromStream = Array.from(new Set(allMessages.map((message) => message.service)));
    return ['all', ...(services ?? fromStream)];
  }, [allMessages, services]);

  const visibleMessages = useMemo(() => {
    const combinedQuery = externalSearch || query;
    const cutoff = timeRangeMs && timeRangeMs > 0 ? Date.now() - timeRangeMs : 0;
    return allMessages.filter((message) => {
      const matchesService = selectedService === 'all' || message.service === selectedService;
      const matchesQuery = combinedQuery.length === 0 || `${message.message} ${message.service}`.toLowerCase().includes(combinedQuery.toLowerCase());
      const matchesTime = cutoff === 0 || new Date(message.timestamp).getTime() >= cutoff;
      return matchesService && matchesQuery && matchesTime;
    });
  }, [allMessages, query, externalSearch, timeRangeMs, selectedService]);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) {
      return;
    }

    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [autoScroll, visibleMessages]);

  const setService = useCallback((service: string) => {
    onServiceChange?.(service);
    if (!onServiceChange) {
      setUncontrolledService(service);
    }
  }, [onServiceChange]);

  return (
    <div className="glass-panel overflow-hidden">
      <div className="border-b border-th-border-m/80 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {availableServices.map((service) => (
              <button
                key={service}
                type="button"
                onClick={() => setService(service)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition-[color,background-color,border-color] dune-focus',
                  selectedService === service
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200'
                    : 'border-th-border bg-th-surface-s/70 text-th-text-m hover:text-th-text-s',
                )}
              >
                {service}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:min-w-[260px] sm:flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-th-text-m" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="dune-input pl-11" placeholder="Search logs&#x2026;" aria-label="Search logs" name="log-search" autoComplete="off" spellCheck={false} />
            </div>
            <label className="inline-flex items-center gap-2 rounded-full border border-th-border bg-th-surface-s/70 px-3 py-2 text-xs text-th-text-s">
              <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} className="accent-amber-400" />
              Auto-scroll
            </label>
            <div className="inline-flex items-center gap-2 rounded-full border border-th-border bg-th-surface-s/70 px-3 py-2 text-xs text-th-text-s" role="status" aria-label={`Stream ${status}`}>
              {status === 'open' ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
              {status}
            </div>
          </div>
        </div>
      </div>
      <div ref={containerRef} className="max-h-[70vh] min-h-[400px] overflow-auto bg-th-bg/90 p-3 font-mono text-[13px] leading-relaxed">
        {visibleMessages.length > 0 ? (
          <table className="w-full border-collapse" aria-label="Service log entries">
            <thead className="sr-only">
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Level</th>
                <th scope="col">Service</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {visibleMessages.map((entry) => (
                <tr key={entry.id} className="border-b border-th-border-m/40 hover:bg-th-surface-s/60">
                  <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums text-th-text-m">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-top">
                    <span className={cn('inline-block w-[3.5rem] text-center rounded border px-1 py-0.5 text-[10px] font-bold uppercase', severityClasses[entry.level])}>{entry.level}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-top text-th-text-m">{entry.service.replace('dune-awakening-', '').replace(/-1$/, '')}</td>
                  <td className="w-full break-all px-2 py-1.5 align-top text-th-text-s">{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center text-th-text-m">
            {status === 'connecting' ? 'Connecting to log stream\u2026' : seedLogs.length === 0 ? 'Loading initial logs\u2026' : 'No matching log events.'}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-th-border-m/80 px-4 py-2 text-xs text-th-text-m">
        <span>{visibleMessages.length} entries</span>
        <span>{allMessages.length} total in buffer</span>
      </div>
    </div>
  );
}