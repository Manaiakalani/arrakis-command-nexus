'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
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
  const asideRef = useRef<HTMLElement>(null);
  const environmentLabel = version?.environment === 'beta' ? 'PTC' : 'Live';
  const clusterHealth = asDisplayHealth(status);
  // Desktop collapse must not strip labels from the phone drawer.
  const compact = collapsed && !mobileOpen;

  useEffect(() => {
    if (!mobileOpen) return;
    const aside = asideRef.current;
    if (!aside) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [...aside.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

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
        ref={asideRef}
        data-testid="sidebar"
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? true : undefined}
        id="dashboard-navigation"
        aria-label="Navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(17rem,calc(100vw-3.25rem))] flex-col overflow-x-hidden border-r border-th-border-m/70 bg-th-bg/95 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl',
          'transition-[width,transform,visibility] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
          compact ? 'lg:w-[4.5rem]' : 'lg:w-[17rem]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 max-lg:invisible',
        )}
      >
        <div className={cn(
          'flex border-b border-th-border-m/50',
          compact ? 'flex-col items-center gap-2 px-2 py-3' : 'items-center justify-between gap-2 px-3 py-3',
        )}>
          <div className={cn(
            'flex min-w-0 items-center overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/10',
            compact ? 'justify-center p-2' : 'min-w-0 flex-1 gap-2.5 px-2.5 py-2',
          )}>
            <div className={cn(
              'relative flex shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-th-accent',
              compact ? 'h-9 w-9' : 'h-10 w-10',
            )}>
              <Worm className="h-5 w-5" aria-hidden="true" />
              <span
                data-testid="cluster-health"
                className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-th-bg', healthDotClass[clusterHealth])}
                aria-label={`Cluster ${healthLabel[clusterHealth]}`}
                role="img"
              />
            </div>
            {!compact && (
              <div className="min-w-0 overflow-hidden">
                <p className="truncate text-sm font-semibold leading-tight text-th-text">Command Nexus</p>
                <p className="truncate text-xs text-th-text-m">Arrakis</p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onToggle}
            data-testid="sidebar-toggle"
            className={cn(
              'hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-th-border/60 bg-th-surface-s/60 text-th-text-m lg:inline-flex',
              'transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-th-border hover:bg-th-surface hover:text-th-text-s active:scale-[0.97]',
            )}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-pressed={collapsed}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            data-testid="sidebar-close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-th-border/60 bg-th-surface-s/60 text-th-text-m transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-th-border hover:bg-th-surface hover:text-th-text-s active:scale-[0.97] lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="mx-3 mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" aria-label="Dashboard">
          {navigationSections.map((section, index) => (
            <div key={section.header ?? `core-${index}`} className={cn(index > 0 && compact && 'mt-4')}>
              {section.header && !compact && (
                <div className="mt-3 mb-1 border-t border-th-border-m/40 pt-3">
                  <p className="px-3 text-[0.65rem] font-medium uppercase tracking-[0.08em] text-th-text-m">
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
                      title={compact ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex min-h-11 items-center rounded-xl border text-sm font-medium',
                        'transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]',
                        compact ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
                        active
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200 shadow-dune'
                          : 'border-transparent text-th-text-s hover:border-th-border hover:bg-th-surface-s/70 hover:text-th-text',
                      )}
                    >
                      <Icon aria-hidden="true" className={cn('h-[1.125rem] w-[1.125rem] shrink-0', active ? 'text-th-accent' : 'text-th-text-m group-hover:text-th-text-s')} />
                      <span className={cn(
                        'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300',
                        compact ? 'max-w-0 opacity-0' : 'max-w-[9rem] opacity-100',
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

        <div className={cn('mx-3 mb-4 mt-3 space-y-3', compact && 'px-0')}>
          <div className={cn('flex', compact ? 'flex-col items-center gap-1' : 'flex-wrap gap-2 px-1')}>
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
                    compact && 'justify-center px-0',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {!compact && link.label}
                </Link>
              );
            })}
          </div>
          <div className={cn('glass-panel overflow-hidden border-amber-500/10', compact ? 'px-2 py-2' : 'px-3 py-2.5')}>
            {compact ? (
              <div className="flex justify-center text-amber-700 dark:text-amber-200">
                <Worm className="h-5 w-5" aria-hidden="true" />
              </div>
            ) : (
              <p className="truncate text-xs text-th-text-m" title={`Version ${version?.version ?? 'unknown'} · ${version?.profile ?? 'basic'} · ${environmentLabel}`}>
                <span className="font-medium text-th-text">{version?.version ?? 'unknown'}</span>
                <span> · </span>
                <span className="capitalize">{version?.profile ?? 'basic'}</span>
                <span> · {environmentLabel}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onToggle}
            data-testid="sidebar-minimize"
            className={cn(
              'hidden lg:inline-flex min-h-11 w-full items-center rounded-xl border border-th-border/60 bg-th-surface-s/60 text-th-text-m',
              'transition-colors duration-150 hover:border-th-border hover:bg-th-surface hover:text-th-text-s',
              collapsed ? 'justify-center px-0' : 'gap-2 px-3',
            )}
            aria-label={collapsed ? 'Expand navigation' : 'Minimize navigation'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span className="text-xs font-medium">Minimize</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
