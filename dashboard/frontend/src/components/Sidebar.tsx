'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  Home,
  Map,
  MessageSquare,
  Settings,
  Terminal,
  Users,
  Worm,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HealthState } from '@/lib/types';

const navigation = [
  { href: '/', label: 'Overview', icon: Home },
  { href: '/maps', label: 'Maps', icon: Map },
  { href: '/players', label: 'Players', icon: Users },
  { href: '/config', label: 'Configuration', icon: Settings },
  { href: '/logs', label: 'Logs', icon: Terminal },
  { href: '/system', label: 'System', icon: Cpu },
  { href: '/backups', label: 'Backups', icon: Database },
  { href: '/discord', label: 'Discord', icon: MessageSquare },
];

const statusMap: Record<HealthState, string> = {
  healthy: 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.85)]',
  degraded: 'bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.85)]',
  offline: 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.75)]',
  starting: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.75)]',
  stopped: 'bg-slate-500',
};

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  status?: HealthState;
}

export function Sidebar({ collapsed, mobileOpen, onToggle, onClose, status = 'healthy' }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm transition lg:hidden',
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-80 flex-col border-r border-slate-800/70 bg-slate-950/95 px-4 py-5 backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0',
          collapsed && 'lg:w-24',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent px-3 py-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300 shadow-dune">
              <Worm className="h-6 w-6" />
            </div>
            {!collapsed && (
              <div>
                <p className="text-xs uppercase tracking-[0.26em] text-amber-200/70">Arrakis</p>
                <h2 className="text-lg font-semibold text-slate-50">Command Nexus</h2>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onToggle} className="dune-button-muted hidden lg:inline-flex" aria-label="Collapse navigation">
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <button type="button" onClick={onClose} className="dune-button-muted lg:hidden" aria-label="Close navigation">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-6 glass-panel px-4 py-4">
          <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
            <span className={cn('h-3 w-3 rounded-full', statusMap[status])} />
            {!collapsed && (
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cluster Status</p>
                <p className="text-sm font-medium capitalize text-slate-100">{status}</p>
              </div>
            )}
          </div>
        </div>

        <nav className="mt-6 flex-1 space-y-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-medium transition',
                  collapsed && 'justify-center px-0',
                  active
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200 shadow-dune'
                    : 'border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900/70 hover:text-slate-50',
                )}
              >
                <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-amber-300' : 'text-slate-500 group-hover:text-slate-200')} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="glass-panel mt-4 overflow-hidden border-amber-500/10 bg-gradient-to-br from-amber-500/10 to-transparent px-4 py-4">
          {collapsed ? (
            <div className="flex justify-center text-amber-200">
              <Worm className="h-5 w-5 animate-float" />
            </div>
          ) : (
            <>
              <p className="text-xs uppercase tracking-[0.24em] text-amber-200/70">Spice Forecast</p>
              <p className="mt-2 text-sm text-slate-300">High telemetry visibility with live map, player, and service intelligence.</p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
