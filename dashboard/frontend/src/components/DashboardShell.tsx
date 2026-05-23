'use client';

import { Menu, Signal } from 'lucide-react';
import { ReactNode, useCallback, useState } from 'react';

import { Sidebar } from '@/components/Sidebar';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';

export function DashboardShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: overview } = useApi(() => apiClient.getStatus(), { refreshInterval: 15000 });
  const { data: version } = useApi(() => apiClient.getVersion(), { refreshInterval: 60000 });

  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => !current);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const openMobile = useCallback(() => {
    setMobileOpen(true);
  }, []);

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
        />
        <div className={cn('flex min-h-screen flex-1 flex-col transition-all duration-300', collapsed ? 'lg:ml-24' : 'lg:ml-80')}>
          <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="dune-button-muted lg:hidden"
                  onClick={openMobile}
                  aria-label="Open navigation"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div>
                  <p className="section-title">Dune Awakening</p>
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-semibold text-slate-50">{overview?.serverName ?? 'Arrakis Command'}</h1>
                    <div className="hidden items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/70 px-3 py-1 text-xs text-slate-300 sm:flex">
                      <Signal className="h-3.5 w-3.5 text-amber-300" />
                      {overview?.region ?? 'Self-hosted cluster'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="glass-panel hidden min-w-[220px] items-center justify-between px-4 py-3 sm:flex">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Server pulse</p>
                  <p className="mt-1 text-sm font-medium tabular-nums text-slate-100">{overview?.playersOnline ?? 0} players online</p>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.75)]" />
                  {overview?.status ?? 'healthy'}
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
