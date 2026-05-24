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
          'fixed inset-0 z-40 bg-th-bg/70 backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        data-testid="sidebar-backdrop"
        aria-hidden="true"
      />

      <aside
        data-testid="sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-th-border-m/70 bg-th-bg/95 backdrop-blur-2xl',
          'transition-[width,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          collapsed ? 'lg:w-[4.5rem]' : 'w-80',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Header */}
        <div className={cn('flex items-center border-b border-th-border-m/50 px-3 py-4', collapsed ? 'justify-center' : 'justify-between')}>
          <div className={cn(
            'flex items-center overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent',
            collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-3',
          )}>
            <div className={cn(
              'flex shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300 shadow-dune',
              collapsed ? 'h-9 w-9' : 'h-12 w-12',
            )}>
              <Worm className={cn(collapsed ? 'h-5 w-5' : 'h-6 w-6')} />
            </div>
            {!collapsed && (
              <div className="overflow-hidden whitespace-nowrap">
                <p className="text-xs uppercase tracking-[0.26em] text-amber-600/70 dark:text-amber-200/70">Arrakis</p>
                <h2 className="text-lg font-semibold leading-tight text-th-text">Command Nexus</h2>
              </div>
            )}
          </div>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggle}
            data-testid="sidebar-toggle"
            className={cn(
              'hidden lg:inline-flex items-center justify-center rounded-lg border border-th-border/60 bg-th-surface-s/60 p-1.5 text-th-text-m',
              'transition-colors duration-150 hover:border-th-border hover:bg-th-surface hover:text-th-text-s',
              collapsed && 'absolute -right-3 top-6 z-[60] rounded-full border-th-border bg-th-bg-s shadow-lg shadow-black/20 dark:shadow-black/50',
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
            className="inline-flex items-center justify-center rounded-lg border border-th-border/60 bg-th-surface-s/60 p-1.5 text-th-text-m transition-colors duration-150 hover:border-th-border hover:bg-th-surface hover:text-th-text-s lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Cluster status */}
        <div className={cn('mx-3 mt-4 glass-panel', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
            <span className={cn('h-3 w-3 shrink-0 rounded-full', statusMap[status])} />
            {!collapsed && (
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Cluster status</p>
                <p className="text-sm font-medium capitalize text-th-text">{status}</p>
              </div>
            )}
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
                    : 'border-transparent text-th-text-s hover:border-th-border hover:bg-th-surface-s/70 hover:text-th-text',
                )}
              >
                <Icon aria-hidden="true" className={cn('h-[1.125rem] w-[1.125rem] shrink-0', active ? 'text-amber-300' : 'text-th-text-m group-hover:text-th-text-s')} />
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
              <p className="mt-2 text-sm text-th-text-s">Live map, player, and service intelligence.</p>
              <div className="mt-3 space-y-2 border-t border-amber-500/10 pt-3 text-xs text-th-text-m">
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase tracking-[0.18em] text-th-text-m">Version</span>
                  <span className="font-medium text-th-text">{version?.version ?? 'unknown'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase tracking-[0.18em] text-th-text-m">Profile</span>
                  <span className="font-medium capitalize text-th-text">{version?.profile ?? 'basic'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase tracking-[0.18em] text-th-text-m">Env</span>
                  <span className="font-medium text-th-text">{environmentLabel}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
