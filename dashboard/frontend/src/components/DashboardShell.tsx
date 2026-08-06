'use client';

import { Menu, Signal } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';

export function DashboardShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: overview } = useApi(() => apiClient.getStatus(), { refreshInterval: 15000 });
  const { data: version } = useApi(() => apiClient.getVersion(), { refreshInterval: 60000 });
  const mainRef = useRef<HTMLDivElement>(null);

  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => !current);
  }, []);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);

  const closeMobile = useCallback(() => {
    // Remove inert BEFORE focusing menu button (effect runs async)
    mainRef.current?.removeAttribute('inert');
    setMobileOpen(false);
    // Return focus to the menu trigger
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  const openMobile = useCallback(() => {
    setMobileOpen(true);
  }, []);

  // Trap focus: set inert on main content when mobile drawer is open
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (mobileOpen) {
      el.setAttribute('inert', '');
      // Move focus into the sidebar close button
      requestAnimationFrame(() => sidebarCloseRef.current?.focus());
    } else {
      el.removeAttribute('inert');
    }
  }, [mobileOpen]);

  // Close on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobile();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileOpen, closeMobile]);

  return (
    <div className="relative min-h-screen bg-dune-radial">
      <div className="absolute inset-0 bg-dune-grid bg-[size:42px_42px] opacity-[0.08]" />
      <div className="relative flex min-h-screen">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onClose={closeMobile}
          onToggle={toggleSidebar}
          status={overview?.status}
          version={version}
          closeRef={sidebarCloseRef}
        />
        <div ref={mainRef} className={cn('flex min-h-screen flex-1 flex-col transition-[margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]', collapsed ? 'lg:ml-[4.5rem]' : 'lg:ml-80')}>
          <header className="sticky top-0 z-30 border-b border-th-border-m/80 bg-th-bg/85 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
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
                <div className="min-w-0 flex-1">
                  <p className="section-title truncate text-xs sm:text-sm">Arrakis Command Nexus</p>
                  <div className="flex items-center gap-3">
                    <h1 className="truncate text-lg font-semibold text-th-text sm:text-2xl">{overview?.serverName ?? 'Loading\u2026'}</h1>
                    <div className="hidden items-center gap-2 rounded-full border border-th-border/80 bg-th-surface-s/70 px-3 py-1 text-xs text-th-text-s sm:flex">
                      <Signal className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" />
                      {overview?.region ?? 'Self-hosted cluster'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <ThemeToggle />
                <div className="glass-panel hidden min-w-[220px] items-center justify-between px-4 py-3 sm:flex">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Server pulse</p>
                    <p className="mt-1 text-sm font-medium tabular-nums text-th-text">{overview?.playersOnline ?? 0} players online</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.75)]" />
                    {overview?.status ?? 'healthy'}
                  </div>
                </div>
              </div>
            </div>
          </header>
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
