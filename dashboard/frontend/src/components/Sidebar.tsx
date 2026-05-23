'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Cpu,
  Database,
  Globe,
  Home,
  Map,
  Megaphone,
  MessageSquare,
  Settings,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Terminal,
  UserCog,
  Users,
  Worm,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HealthState, SystemVersion } from '@/lib/types';

const navigation = [
  { href: '/', label: 'Overview', icon: Home },
  { href: '/maps', label: 'Maps', icon: Map },
  { href: '/players', label: 'Players', icon: Users },
  { href: '/characters', label: 'Characters', icon: UserCog },
  { href: '/config', label: 'Configuration', icon: Settings },
  { href: '/logs', label: 'Logs', icon: Terminal },
  { href: '/system', label: 'System', icon: Cpu },
  { href: '/economy', label: 'Economy', icon: Coins },
  { href: '/backups', label: 'Backups', icon: Database },
  { href: '/moderation', label: 'Moderation', icon: Shield },
  { href: '/discord', label: 'Discord', icon: MessageSquare },
  { href: '/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/watchdog', label: 'Watchdog', icon: ShieldAlert },
  { href: '/settings', label: 'Settings', icon: SlidersHorizontal },
  { href: '/public', label: 'Public Status', icon: Globe },
];

const statusMap: Record<HealthState, string> = {
  healthy: 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.85)]',
  degraded: 'bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.85)]',
  offline: 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.75)]',
  starting: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.75)]',
  stopped: 'bg-slate-500',
  completed: 'bg-sky-300 shadow-[0_0_8px_rgba(125,211,252,0.5)]',
};

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  status?: HealthState;
  version?: SystemVersion;
}

export function Sidebar({ collapsed, mobileOpen, onToggle, onClose, status = 'healthy', version }: SidebarProps) {
  const pathname = usePathname();
  const environmentLabel = version?.environment === 'beta' ? 'PTC' : 'Live';

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        data-testid="sidebar-backdrop"
        aria-hidden="true"
      />

      <aside
        data-testid="sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-800/70 bg-slate-950/95 backdrop-blur-2xl',
          'transition-[width,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          collapsed ? 'lg:w-[4.5rem]' : 'w-80',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Header */}
        <div className={cn('flex items-center border-b border-slate-800/50 px-3 py-4', collapsed ? 'justify-center' : 'justify-between')}>
          <div className={cn(
            'flex items-center gap-3 overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent',
            collapsed ? 'p-2' : 'px-3 py-3',
          )}>
            <div className={cn(
              'flex shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300 shadow-dune',
              collapsed ? 'h-9 w-9' : 'h-12 w-12',
            )}>
              <Worm className={cn(collapsed ? 'h-5 w-5' : 'h-6 w-6')} />
            </div>
            <div className={cn(
              'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300',
              collapsed ? 'max-w-0 opacity-0' : 'max-w-[10rem] opacity-100',
            )}>
              <p className="text-xs uppercase tracking-[0.26em] text-amber-200/70">Arrakis</p>
              <h2 className="text-lg font-semibold leading-tight text-slate-50">Command Nexus</h2>
            </div>
          </div>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggle}
            data-testid="sidebar-toggle"
            className={cn(
              'hidden lg:inline-flex items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/60 p-1.5 text-slate-400',
              'transition-colors duration-150 hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200',
              collapsed && 'absolute -right-3 top-6 z-[60] rounded-full border-slate-700 bg-slate-900 shadow-lg shadow-slate-950/50',
            )}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>

          {/* Mobile close button */}
          <button
            type="button"
            onClick={onClose}
            data-testid="sidebar-close"
            className="inline-flex items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/60 p-1.5 text-slate-400 transition-colors duration-150 hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Cluster status */}
        <div className={cn('mx-3 mt-4 glass-panel', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
          <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
            <span className={cn('h-3 w-3 shrink-0 rounded-full', statusMap[status])} />
            <div className={cn(
              'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300',
              collapsed ? 'max-w-0 opacity-0' : 'max-w-[10rem] opacity-100',
            )}>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Cluster status</p>
              <p className="text-sm font-medium capitalize text-slate-100">{status}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="mx-3 mt-4 flex-1 space-y-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'group flex items-center rounded-xl border text-sm font-medium',
                  'transition-[color,background-color,border-color,box-shadow,padding] duration-200',
                  collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
                  active
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200 shadow-dune'
                    : 'border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900/70 hover:text-slate-50',
                )}
              >
                <Icon aria-hidden="true" className={cn('h-[1.125rem] w-[1.125rem] shrink-0', active ? 'text-amber-300' : 'text-slate-500 group-hover:text-slate-200')} />
                <span className={cn(
                  'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300',
                  collapsed ? 'max-w-0 opacity-0' : 'max-w-[10rem] opacity-100',
                )}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Footer info panel */}
        <div className={cn('mx-3 mb-4 mt-3 glass-panel overflow-hidden border-amber-500/10 bg-gradient-to-br from-amber-500/10 to-transparent', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
          {collapsed ? (
            <div className="flex justify-center text-amber-200">
              <Worm className="h-5 w-5 animate-float" />
            </div>
          ) : (
            <>
              <p className="text-xs uppercase tracking-[0.24em] text-amber-200/70">Spice forecast</p>
              <p className="mt-2 text-sm text-slate-300">Live map, player, and service intelligence.</p>
              <div className="mt-3 space-y-2 border-t border-amber-500/10 pt-3 text-xs text-slate-400">
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase tracking-[0.18em] text-slate-500">Version</span>
                  <span className="font-medium text-slate-100">{version?.version ?? 'unknown'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase tracking-[0.18em] text-slate-500">Profile</span>
                  <span className="font-medium capitalize text-slate-100">{version?.profile ?? 'basic'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase tracking-[0.18em] text-slate-500">Env</span>
                  <span className="font-medium text-slate-100">{environmentLabel}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
