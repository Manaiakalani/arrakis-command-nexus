'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  Cpu,
  Database,
  Download,
  Gauge,
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
  Zap,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HealthState, SystemVersion } from '@/lib/types';

const navigationSections = [
  {
    // Core navigation - most frequent actions
    items: [
      { href: '/', label: 'Overview', icon: Home },
      { href: '/players', label: 'Players', icon: Users },
      { href: '/maps', label: 'Maps', icon: Map },
    ],
  },
  {
    header: 'Management',
    items: [
      { href: '/characters', label: 'Characters', icon: UserCog },
      { href: '/economy', label: 'Economy', icon: Coins },
      { href: '/moderation', label: 'Moderation', icon: Shield },
    ],
  },
  {
    header: 'Server Control',
    items: [
      { href: '/config', label: 'Configuration', icon: Settings },
      { href: '/game-settings', label: 'Game settings', icon: SlidersHorizontal },
      { href: '/resources', label: 'Resources', icon: Gauge },
      { href: '/system', label: 'System', icon: Cpu },
      { href: '/logs', label: 'Logs', icon: Terminal },
    ],
  },
  {
    header: 'Automation',
    items: [
      { href: '/backups', label: 'Backups', icon: Database },
      { href: '/announcements', label: 'Announcements', icon: Megaphone },
      { href: '/watchdog', label: 'Watchdog', icon: ShieldAlert },
      { href: '/incidents', label: 'Incidents', icon: Zap },
    ],
  },
  {
    header: 'System',
    items: [
      { href: '/discord', label: 'Discord', icon: MessageSquare },
      { href: '/updates', label: 'Updates', icon: Download },
      { href: '/audit', label: 'Audit trail', icon: ClipboardList },
      { href: '/settings', label: 'Settings', icon: SlidersHorizontal },
      { href: '/public', label: 'Public status', icon: Globe },
    ],
  },
];

const statusMap: Record<HealthState, string> = {
  healthy: 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.85)]',
  degraded: 'bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.85)]',
  offline: 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.75)]',
  starting: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.75)]',
  stopped: 'bg-stone-400 dark:bg-slate-500',
  completed: 'bg-sky-300 shadow-[0_0_8px_rgba(125,211,252,0.5)]',
};

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  status?: HealthState;
  version?: SystemVersion;
  closeRef?: React.RefObject<HTMLButtonElement | null>;
}

export function Sidebar({ collapsed, mobileOpen, onToggle, onClose, status = 'healthy', version, closeRef }: SidebarProps) {
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
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? true : undefined}
        aria-label={mobileOpen ? 'Navigation' : undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-th-border-m/70 bg-th-bg/95 backdrop-blur-2xl',
          'transition-[width,transform,visibility] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          collapsed ? 'lg:w-[4.5rem]' : 'w-80',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 max-lg:invisible',
        )}
      >
        {/* Header */}
        <div className={cn('flex items-center border-b border-th-border-m/50 px-3 py-4', collapsed ? 'justify-center' : 'justify-between')}>
          <div className={cn(
            'flex items-center overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent',
            collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-3',
          )}>
            <div className={cn(
              'flex shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-th-accent shadow-dune',
              collapsed ? 'h-9 w-9' : 'h-12 w-12',
            )}>
              <Worm className={cn(collapsed ? 'h-5 w-5' : 'h-6 w-6')} />
            </div>
            {!collapsed && (
              <div className="overflow-hidden whitespace-nowrap">
                <p className="text-xs uppercase tracking-[0.26em] text-amber-700 dark:text-amber-200">Arrakis</p>
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
            ref={closeRef}
            type="button"
            onClick={onClose}
            data-testid="sidebar-close"
            className="inline-flex items-center justify-center rounded-lg border border-th-border/60 bg-th-surface-s/60 p-2.5 text-th-text-m transition-colors duration-150 hover:border-th-border hover:bg-th-surface hover:text-th-text-s lg:hidden"
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
        <nav className="mx-3 mt-4 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          {navigationSections.map((section, index) => (
            <div key={section.header ?? `core-${index}`} className={cn(index > 0 && collapsed && 'mt-4')}>
              {section.header && !collapsed && (
                <div className="mt-4 mb-1 border-t border-th-border-m/40 pt-4">
                  <p className="px-3 text-th-text-m text-[0.65rem] uppercase tracking-[0.2em] font-medium">
                    {section.header}
                  </p>
                </div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => {
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
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200 shadow-dune'
                          : 'border-transparent text-th-text-s hover:border-th-border hover:bg-th-surface-s/70 hover:text-th-text',
                      )}
                    >
                      <Icon aria-hidden="true" className={cn('h-[1.125rem] w-[1.125rem] shrink-0', active ? 'text-th-accent' : 'text-th-text-m group-hover:text-th-text-s')} />
                      <span className={cn(
                        'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300',
                        collapsed ? 'max-w-0 opacity-0' : 'max-w-[10rem] opacity-100',
                      )}>
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer info panel */}
        <div className={cn('mx-3 mb-4 mt-3 glass-panel overflow-hidden border-amber-500/10 bg-gradient-to-br from-amber-500/10 to-transparent', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
          {collapsed ? (
            <div className="flex justify-center text-amber-700 dark:text-amber-200">
              <Worm className="h-5 w-5 animate-float" />
            </div>
          ) : (
            <>
              <p className="text-xs uppercase tracking-[0.24em] text-amber-700 dark:text-amber-200">Spice forecast</p>
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
