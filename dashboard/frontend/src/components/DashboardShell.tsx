'use client';

import { Menu, Signal } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import useSWR from 'swr';

import { Sidebar } from '@/components/Sidebar';
import { SessionMenu } from '@/components/SessionMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useDashboardSSE } from '@/hooks/useDashboardSSE';
import { useApiSWR } from '@/hooks/useApiSWR';
import { apiClient } from '@/lib/api';
import { asDisplayHealth, healthDotClass, healthLabel, healthPillClass } from '@/lib/health';
import type { DashboardOverview } from '@/lib/types';
import { cn } from '@/lib/utils';

const SIDEBAR_KEY = 'arrakis-sidebar-collapsed';
const SIDEBAR_EVENT = 'arrakis-sidebar';

function subscribeSidebar(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(SIDEBAR_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(SIDEBAR_EVENT, onStoreChange);
  };
}

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sseOpenRef = useRef(false);
  const { data: overview, mutate: overviewMutate } = useSWR(
    'api/overview',
    () => apiClient.getOverview(),
    { refreshInterval: () => (sseOpenRef.current ? 0 : 30_000) },
  );
  const { data: version } = useApiSWR('api/version', () => apiClient.getVersion(), { refreshInterval: 60_000 });
  const mainRef = useRef<HTMLDivElement>(null);

  const handleSSEUpdate = useCallback(
    (patch: Partial<DashboardOverview>) => {
      void overviewMutate((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (patch.status) next.status = { ...prev.status, ...patch.status };
        if (patch.maps) next.maps = patch.maps;
        if (patch.metrics) next.metrics = patch.metrics;
        if (patch.readiness) next.readiness = patch.readiness;
        return next;
      }, { revalidate: false });
    },
    [overviewMutate],
  );

  const { sseStatus } = useDashboardSSE({
    enabled: !!overview,
    onUpdate: handleSSEUpdate,
  });
  useEffect(() => {
    sseOpenRef.current = sseStatus === 'open';
  }, [sseStatus]);

  const toggleSidebar = useCallback(() => {
    writeSidebarCollapsed(!readSidebarCollapsed());
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);

  const closeMobile = useCallback(() => {
    mainRef.current?.removeAttribute('inert');
    setMobileOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  const openMobile = useCallback(() => {
    setMobileOpen(true);
  }, []);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (mobileOpen) {
      el.setAttribute('inert', '');
      requestAnimationFrame(() => sidebarCloseRef.current?.focus());
    } else {
      el.removeAttribute('inert');
    }
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobile();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileOpen, closeMobile]);

  const clusterHealth = asDisplayHealth(overview?.status.status);
  const liveLabel = sseStatus === 'open' ? 'Live' : sseStatus === 'connecting' ? 'Connecting…' : 'Polling';
  const liveTone =
    sseStatus === 'open'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : sseStatus === 'connecting'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200'
        : 'border-th-border/80 bg-th-surface-s/70 text-th-text-s';

  return (
    <div className="relative min-h-screen bg-dune-radial">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-th-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-th-text focus:shadow-lg"
      >
        Skip to content
      </a>
      <div className="absolute inset-0 bg-dune-grid bg-[size:42px_42px] opacity-[0.08]" />
      <div className="relative flex min-h-screen">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onClose={closeMobile}
          onToggle={toggleSidebar}
          status={overview?.status.status}
          version={version}
          closeRef={sidebarCloseRef}
        />
        <div ref={mainRef} className={cn('flex min-h-screen flex-1 flex-col transition-[margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]', collapsed ? 'lg:ml-[4.5rem]' : 'lg:ml-80')}>
          <header className="sticky top-0 z-30 border-b border-th-border-m/80 bg-th-bg/85 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <button
                  ref={menuButtonRef}
                  type="button"
                  className="dune-button-muted shrink-0 lg:hidden"
                  onClick={openMobile}
                  aria-label="Open navigation"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <h1 className="min-w-0 truncate text-lg font-semibold text-th-text sm:text-2xl">
                  {overview?.status.serverName ?? 'Loading…'}
                </h1>
              </div>
              <ThemeToggle />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div data-testid="region-chip" className="header-chip max-sm:max-w-[9.5rem]">
                <Signal className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" aria-hidden="true" />
                <span className="truncate">{overview?.status.region ?? 'Self-hosted cluster'}</span>
              </div>
              <div
                data-testid="sse-status"
                className={cn('header-chip', liveTone)}
                title="Event stream from the dashboard API"
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    sseStatus === 'open'
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.85)]'
                      : sseStatus === 'connecting'
                        ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.85)]'
                        : 'bg-stone-400 dark:bg-slate-500',
                  )}
                  aria-hidden="true"
                />
                <span>{liveLabel}</span>
              </div>
              <SessionMenu />
              <div className="flex items-center gap-2" data-testid="header-cluster">
                <div className="header-chip">
                  <span className="text-th-text-m">Players</span>
                  <span className="font-semibold tabular-nums text-th-text">{overview?.status.playersOnline ?? '—'}</span>
                </div>
                <div
                  data-testid="header-health"
                  className={cn('header-chip font-semibold', healthPillClass[clusterHealth])}
                >
                  <span
                    className={cn('h-2 w-2 rounded-full', healthDotClass[clusterHealth])}
                    aria-hidden="true"
                  />
                  <span>{healthLabel[clusterHealth]}</span>
                </div>
              </div>
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="flex-1 scroll-mt-24 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
