'use client';

import { Clock, Download, FileText, Search } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';

import { Skeleton } from '@/components/Skeleton';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

const LogStream = dynamic(
  () => import('@/components/LogStream').then((mod) => mod.LogStream),
  {
    loading: () => (
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-20 rounded-full" />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-10 w-64 rounded-xl" />
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-8 w-16 rounded-full" />
            </div>
          </div>
        </div>
        <div className="min-h-[400px] bg-th-bg/90 p-3 space-y-2">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-14 rounded" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
        <div className="border-t border-th-border-m/80 px-4 py-2">
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    ),
    ssr: false,
  },
);

const timeRanges = [
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: 'All', ms: 0 },
] as const;

export default function LogsPage() {
  const [service, setService] = useState('all');
  const [format, setFormat] = useState<'txt' | 'json' | 'csv'>('txt');
  const [tail, setTail] = useState<number>(500);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeRange, setTimeRange] = useState<number>(0);

  const params = new URLSearchParams();
  if (service !== 'all') params.set('service', service);
  params.set('format', format);
  params.set('tail', String(tail));
  const downloadHref = `/api/logs/download?${params.toString()}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="section-title">Live telemetry</p>
          <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><FileText aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Service Logs</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={service} onChange={(event) => setService(event.target.value)} className="dune-input w-full sm:min-w-[200px] sm:w-auto" aria-label="Filter by service">
            <option value="all">All services</option>
            <option value="gateway">Gateway</option>
            <option value="director">Director</option>
            <option value="discord">Discord</option>
            <option value="database">Database</option>
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value as 'txt' | 'json' | 'csv')} className="dune-input w-full sm:w-auto" aria-label="Export format">
            <option value="txt">Plain text (.txt)</option>
            <option value="json">JSON (.json)</option>
            <option value="csv">CSV (.csv)</option>
          </select>
          <select value={tail} onChange={(e) => setTail(Number(e.target.value))} className="dune-input w-full sm:w-auto" aria-label="Tail size">
            <option value={100}>Last 100</option>
            <option value={500}>Last 500</option>
            <option value={1000}>Last 1,000</option>
            <option value={2500}>Last 2,500</option>
            <option value={5000}>Last 5,000</option>
          </select>
          <a href={downloadHref} download className="dune-button-muted">
            <Download aria-hidden="true" className="mr-2 h-4 w-4" /> Export logs
          </a>
        </div>
      </div>

      {/* Search + time-range filters */}
      <div className="glass-panel p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-th-text-m" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="dune-input w-full pl-11"
              placeholder="Search log messages…"
              aria-label="Search log messages"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center gap-2">
            <Clock aria-hidden="true" className="h-4 w-4 text-th-text-m" />
            <span className="text-xs uppercase tracking-[0.18em] text-th-text-m">Range</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-th-border">
              {timeRanges.map((range) => (
                <button
                  key={range.label}
                  type="button"
                  onClick={() => setTimeRange(range.ms)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors dune-focus',
                    timeRange === range.ms
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                      : 'bg-th-surface-s/70 text-th-text-m hover:text-th-text-s',
                  )}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <LogStream
        endpoint={apiClient.getLogStreamUrl()}
        selectedService={service}
        onServiceChange={setService}
        externalSearch={searchQuery}
        timeRangeMs={timeRange}
      />
    </div>
  );
}