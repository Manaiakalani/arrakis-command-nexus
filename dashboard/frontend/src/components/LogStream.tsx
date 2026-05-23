'use client';

import { Search, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useSSE } from '@/hooks/useSSE';
import type { LogEvent, Severity } from '@/lib/types';
import { cn } from '@/lib/utils';

const severityClasses: Record<Severity, string> = {
  ERROR: 'border-red-500/30 bg-red-500/10 text-red-300',
  WARN: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  INFO: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  DEBUG: 'border-slate-600 bg-slate-800 text-slate-300',
};

function parseLogEvent(raw: string): LogEvent {
  try {
    const parsed = JSON.parse(raw) as Partial<LogEvent>;
    return {
      id: parsed.id ?? `${Date.now()}-${Math.random()}`,
      timestamp: parsed.timestamp ?? new Date().toISOString(),
      service: parsed.service ?? 'gateway',
      level: parsed.level ?? 'INFO',
      message: parsed.message ?? raw,
    };
  } catch {
    return {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      service: 'gateway',
      level: raw.includes('ERROR') ? 'ERROR' : raw.includes('WARN') ? 'WARN' : 'INFO',
      message: raw,
    };
  }
}

interface LogStreamProps {
  endpoint: string;
  selectedService?: string;
  onServiceChange?: (service: string) => void;
  services?: string[];
}

export function LogStream({ endpoint, selectedService: controlledService, onServiceChange, services }: LogStreamProps) {
  const [uncontrolledService, setUncontrolledService] = useState('all');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const { messages, status } = useSSE<LogEvent>(endpoint, { parse: parseLogEvent });
  const selectedService = controlledService ?? uncontrolledService;

  const availableServices = useMemo(() => {
    const fromStream = Array.from(new Set(messages.map((message) => message.service)));
    return ['all', ...(services ?? fromStream)];
  }, [messages, services]);

  const visibleMessages = useMemo(() => {
    return messages.filter((message) => {
      const matchesService = selectedService === 'all' || message.service === selectedService;
      const matchesQuery = query.length === 0 || `${message.message} ${message.service}`.toLowerCase().includes(query.toLowerCase());
      return matchesService && matchesQuery;
    });
  }, [messages, query, selectedService]);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) {
      return;
    }

    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [autoScroll, visibleMessages]);

  const setService = (service: string) => {
    onServiceChange?.(service);
    if (!onServiceChange) {
      setUncontrolledService(service);
    }
  };

  return (
    <div className="glass-panel overflow-hidden">
      <div className="border-b border-slate-800/80 p-4 sm:p-5">
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
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                    : 'border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200',
                )}
              >
                {service}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="dune-input pl-11" placeholder="Search logs&#x2026;" aria-label="Search logs" name="log-search" autoComplete="off" spellCheck={false} />
            </div>
            <label className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
              <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} className="accent-amber-400" />
              Auto-scroll
            </label>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300" role="status" aria-label={`Stream ${status}`}>
              {status === 'open' ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-red-400" />}
              {status}
            </div>
          </div>
        </div>
      </div>
      <div ref={containerRef} className="max-h-[70vh] min-h-[400px] overflow-auto bg-slate-950/90 p-3 font-mono text-[13px] leading-relaxed">
        {visibleMessages.length > 0 ? (
          <table className="w-full border-collapse">
            <tbody>
              {visibleMessages.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-800/40 hover:bg-slate-900/60">
                  <td className="whitespace-nowrap px-2 py-1.5 align-top tabular-nums text-slate-500">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-top">
                    <span className={cn('inline-block w-[3.5rem] text-center rounded border px-1 py-0.5 text-[10px] font-bold uppercase', severityClasses[entry.level])}>{entry.level}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-top text-slate-400">{entry.service.replace('dune-awakening-', '').replace(/-1$/, '')}</td>
                  <td className="w-full break-all px-2 py-1.5 align-top text-slate-200">{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center text-slate-500">
            {status === 'connecting' ? 'Connecting to log stream\u2026' : 'No matching log events yet.'}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-800/80 px-4 py-2 text-xs text-slate-500">
        <span>{visibleMessages.length} entries</span>
        <span>{messages.length} total in buffer</span>
      </div>
    </div>
  );
}
