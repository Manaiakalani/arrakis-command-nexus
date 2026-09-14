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
  KeyRound,
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
import { asDisplayHealth, healthDotClass, healthLabel } from '@/lib/health';
import type { HealthState, SystemVersion } from '@/lib/types';

const navigationSections = [
  {
    items: [
      { href: '/', label: 'Overview', icon: Home },
      { href: '/players', label: 'Players', icon: Users },
      { href: '/maps', label: 'Maps', icon: Map },
    ],
  },
  {
    header: 'People',
    items: [
      { href: '/characters', label: 'Characters', icon: UserCog },
      { href: '/economy', label: 'Economy', icon: Coins },
      { href: '/moderation', label: 'Moderation', icon: Shield },
    ],
  },
  {
    header: 'Keep running',
    items: [
      { href: '/backups', label: 'Backups', icon: Database },
      { href: '/announcements', label: 'Announcements', icon: Megaphone },
      { href: '/watchdog', label: 'Watchdog', icon: ShieldAlert },
      { href: '/updates', label: 'Updates', icon: Download },
    ],
  },
  {
    header: 'Console',
    items: [
      { href: '/config', label: 'Configuration', icon: Settings },
      { href: '/game-settings', label: 'Game settings', icon: SlidersHorizontal },
      { href: '/resources', label: 'Resources', icon: Gauge },
      { href: '/system', label: 'System', icon: Cpu },
      { href: '/logs', label: 'Logs', icon: Terminal },
      { href: '/settings', label: 'Settings', icon: KeyRound },
    ],
  },
];

const footerLinks = [
  { href: '/discord', label: 'Discord', icon: MessageSquare },
  { href: '/audit', label: 'Audit', icon: ClipboardList },
  { href: '/public', label: 'Public status', icon: Globe },
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  status?: HealthState;
  version?: SystemVersion;
  closeRef?: React.RefObject<HTMLButtonElement | null>;
}

export function Sidebar({ collapsed, mobileOpen, onToggle, onClose, status, version, closeRef }: SidebarProps) {
  const pathname = usePathname();
  const environmentLabel = version?.environment === 'beta' ? 'PTC' : 'Live';
  const clusterHealth = asDisplayHealth(status);

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-th-bg/70 backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onClose();
        }}
        role="presentation"
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
        <div className={cn('flex items-center border-b border-th-border-m/50 px-3 py-4', collapsed ? 'justify-center' : 'justify-between')}>
          <div className={cn(
            'flex items-center overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent',
            collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-3',
          )}>
            <div className={cn(
              'flex shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-th-accent shadow-dune',
              collapsed ? 'h-9 w-9' : 'h-12 w-12',
            )}>
              <Worm className={cn(collapsed ? 'h-5 w-5' : 'h-6 w-6')} aria-hidden="true" />
            </div>
            {!collapsed && (
              <div className="overflow-hidden whitespace-nowrap">
                <p className="text-lg font-semibold leading-tight text-th-text">Command Nexus</p>
                <p className="text-xs text-th-text-m">Arrakis</p>
              </div>
            )}
          </div>

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

        <div className={cn('mx-3 mt-4 glass-panel', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
            <span
              data-testid="cluster-health"
              className={cn('h-3 w-3 shrink-0 rounded-full', healthDotClass[clusterHealth])}
              aria-label={`Cluster ${healthLabel[clusterHealth]}`}
              role="img"
            />
            {!collapsed && (
              <div>
                <p className="text-sm font-medium capitalize text-th-text">{healthLabel[clusterHealth]}</p>
                <p className="text-xs text-th-text-m">Cluster</p>
              </div>
            )}
          </div>
        </div>

        <nav className="mx-3 mt-4 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin" aria-label="Dashboard">
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
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex min-h-11 items-center rounded-xl border text-sm font-medium',
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

        <div className={cn('mx-3 mb-4 mt-3 space-y-3', collapsed && 'px-0')}>
          <div className={cn('flex', collapsed ? 'flex-col items-center gap-1' : 'flex-wrap gap-2 px-1')}>
            {footerLinks.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onClose}
                  title={link.label}
                  target={link.href === '/public' ? '_blank' : undefined}
                  rel={link.href === '/public' ? 'noreferrer' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-th-text-m hover:text-th-text',
                    active && 'text-amber-700 dark:text-amber-200',
                    collapsed && 'justify-center px-0',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {!collapsed && link.label}
                </Link>
              );
            })}
          </div>
          <div className={cn('glass-panel overflow-hidden border-amber-500/10', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
            {collapsed ? (
              <div className="flex justify-center text-amber-700 dark:text-amber-200">
                <Worm className="h-5 w-5" aria-hidden="true" />
              </div>
            ) : (
              <div className="space-y-2 text-xs text-th-text-m">
                <div className="flex items-center justify-between gap-3">
                  <span>Version</span>
                  <span className="font-medium text-th-text">{version?.version ?? 'unknown'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Profile</span>
                  <span className="font-medium capitalize text-th-text">{version?.profile ?? 'basic'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Env</span>
                  <span className="font-medium text-th-text">{environmentLabel}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
