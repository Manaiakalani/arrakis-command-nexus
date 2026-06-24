import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Variant = 'default' | 'success' | 'warning' | 'error';

const variantClasses: Record<Variant, string> = {
  default: 'border-th-border/70 bg-th-surface/70 text-th-text',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-50',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-50',
  error: 'border-red-500/20 bg-red-500/10 text-red-50',
};

interface StatusCardProps {
  icon: LucideIcon;
  title: string;
  value: string | number;
  subtitle?: string;
  variant?: Variant;
  trend?: { value: number; direction: 'up' | 'down' };
  children?: ReactNode;
}

export const StatusCard = memo(function StatusCard({ icon: Icon, title, value, subtitle, variant = 'default', trend, children }: StatusCardProps) {
  const TrendIcon = trend?.direction === 'up' ? ArrowUpRight : ArrowDownRight;

  return (
    <div className={cn('glass-panel relative overflow-hidden p-5 transition-[border-color,box-shadow] duration-200', variantClasses[variant])}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-th-text-m">{title}</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums leading-none">{value}</p>
          {subtitle ? <p className="mt-2 text-sm text-th-text-m">{subtitle}</p> : null}
        </div>
        <div className="rounded-2xl border border-th-border/30 dark:border-white/5 bg-th-bg/40 p-3 text-th-accent shadow-dune">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      </div>
      {trend ? (
        <div className="mt-4 inline-flex items-center gap-1 rounded-full border border-th-border/30 dark:border-white/5 bg-th-bg/40 px-3 py-1 text-xs font-medium text-th-text-s">
          <TrendIcon className={cn('h-3.5 w-3.5', trend.direction === 'up' ? 'text-emerald-400' : 'text-th-accent-danger')} />
          {trend.value}% vs last window
        </div>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
});
