'use client';

import { Shield, ShieldAlert, Trash2 } from 'lucide-react';

import { Skeleton, TableSkeleton } from '@/components/Skeleton';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { ChatGuardViolation } from '@/lib/types';

const violationLabels: Record<ChatGuardViolation['type'], string> = {
  consecutive_duplicate: 'Duplicate spam',
  rate_limit: 'Rate limit',
  pattern_match: 'Pattern match',
};

export default function ModerationPage() {
  const settings = useApi(() => apiClient.getChatGuardSettings(), { refreshInterval: 15000 });
  const violations = useApi(() => apiClient.getChatGuardViolations(), { refreshInterval: 10000, initialData: [] });

  const handleClear = async () => {
    if (!window.confirm('Clear all chat guard violations? This action cannot be undone.')) {
      return;
    }
    await apiClient.clearChatGuardViolations();
    await Promise.all([settings.refetch(), violations.refetch()]);
  };

  const isLoading = settings.loading && !settings.data;

  if (isLoading) {
    return <ModerationPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-5">
          <p className="section-title">Moderation controls</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-th-text">Chat Guard</h2>
              <p className="text-sm text-th-text-m">Active spam limits and the latest enforcement activity.</p>
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Protection" value={settings.data?.enabled ? 'Enabled' : 'Disabled'} accent={settings.data?.enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-th-text-s'} />
          <StatCard label="Duplicate limit" value={settings.data ? `${settings.data.maxConsecutive} messages` : '—'} />
          <StatCard label="Rate limit" value={settings.data ? `${settings.data.rateMaxMessages}/${settings.data.rateWindowSeconds}s` : '—'} />
          <StatCard label="Auto kick" value={settings.data?.autoKick ? 'On' : 'Off'} accent={settings.data?.autoKick ? 'text-amber-600 dark:text-amber-300' : 'text-th-text-s'} />
          <StatCard label="Violations" value={String(settings.data?.totalViolations ?? violations.data?.length ?? 0)} />
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-th-border-m/80 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="section-title">Spam enforcement</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Recent Violations</h2>
          </div>
          <button type="button" className="dune-button-muted" onClick={() => void handleClear()}>
            <Trash2 className="mr-2 h-4 w-4" /> Clear violations
          </button>
        </div>

        {violations.error ? (
          <div className="p-5 text-sm text-red-700 dark:text-red-300">Unable to load chat guard violations.</div>
        ) : null}

        {(violations.data ?? []).length === 0 ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center">
            <ShieldAlert className="h-10 w-10 text-emerald-700 dark:text-emerald-300" />
            <div>
              <h3 className="text-lg font-semibold text-th-text">No spam violations</h3>
              <p className="mt-2 max-w-xl text-th-text-m">Chat guard is monitoring player messages. New warnings will appear here automatically.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-th-border-m/80 text-sm">
              <thead className="bg-th-bg/50 text-left text-xs uppercase tracking-[0.18em] text-th-text-m">
                <tr>
                  <th className="px-5 py-3 font-medium">Player</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Message</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-th-border-m/70 text-th-text-s">
                {(violations.data ?? []).map((violation) => (
                  <tr key={`${violation.steamId}-${violation.timestamp}-${violation.type}`}>
                    <td className="px-5 py-4">
                      <div className="font-medium text-th-text">{violation.playerName || violation.steamId}</div>
                      <div className="mt-1 text-xs text-th-text-m">{violation.steamId}</div>
                    </td>
                    <td className="px-5 py-4 text-th-text-s">{violationLabels[violation.type] ?? violation.type}</td>
                    <td className="px-5 py-4 text-th-text-s">{violation.message}</td>
                    <td className="px-5 py-4">
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-200">
                        {violation.action}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-th-text-m">{new Date(violation.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ModerationPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-5">
          <Skeleton className="h-3 w-28" />
          <div className="mt-2 flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-3xl border border-th-border-m/80 bg-th-bg/60 p-4 space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-3xl border border-th-border-m/80 bg-th-bg/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-th-text-m">{label}</p>
      <p className={`mt-3 text-xl font-semibold text-th-text ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
