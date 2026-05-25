'use client';

import { AlertTriangle, BadgeAlert, Coins, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Skeleton, TableSkeleton } from '@/components/Skeleton';
import { StatusCard } from '@/components/StatusCard';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { EconomyAlert } from '@/lib/types';
import { cn } from '@/lib/utils';

const severityClasses: Record<EconomyAlert['severity'], string> = {
  info: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  critical: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200',
};

export default function EconomyPage() {
  const { toast } = useToast();
  const summary = useApi(() => apiClient.getEconomySummary(), { refreshInterval: 15000 });
  const alerts = useApi(() => apiClient.getEconomyAlerts(), { refreshInterval: 15000, initialData: [] });
  const [type, setType] = useState('manual');
  const [severity, setSeverity] = useState<EconomyAlert['severity']>('info');
  const [message, setMessage] = useState('');
  const [detailsText, setDetailsText] = useState('{}');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const handleAcknowledge = async (alertId: string) => {
    setAcknowledgingId(alertId);
    try {
      await apiClient.acknowledgeAlert(alertId);
      await Promise.all([summary.refetch(), alerts.refetch()]);
      toast('Alert acknowledged.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to acknowledge alert.';
      toast(`Failed to acknowledge alert: ${message}`, 'error');
    } finally {
      setAcknowledgingId(null);
    }
  };

  const handleCreateAlert = async () => {
    if (!message.trim()) {
      setFormError('Message is required.');
      return;
    }

    let details: Record<string, unknown> | undefined;
    try {
      details = detailsText.trim() ? (JSON.parse(detailsText) as Record<string, unknown>) : undefined;
    } catch {
      setFormError('Details must be valid JSON.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await apiClient.createEconomyAlert({
        type,
        severity,
        message: message.trim(),
        details,
      });
      setMessage('');
      setDetailsText('{}');
      await Promise.all([summary.refetch(), alerts.refetch()]);
      toast('Economy alert created.', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create alert.';
      setFormError(errorMessage);
      toast(`Failed to create alert: ${errorMessage}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = summary.loading && !summary.data;

  if (isLoading) {
    return <EconomyPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatusCard icon={BadgeAlert} title="Total alerts" value={summary.data?.totalAlerts ?? 0} subtitle="Retained economy anomaly events" variant="warning" />
        <StatusCard icon={AlertTriangle} title="Unacknowledged" value={summary.data?.unacknowledgedAlerts ?? 0} subtitle="Alerts still awaiting review" variant={(summary.data?.unacknowledgedAlerts ?? 0) > 0 ? 'error' : 'success'} />
        <StatusCard icon={ShieldCheck} title="Monitoring" value={summary.data?.enabled ? 'Enabled' : 'Disabled'} subtitle={`Checks every ${summary.data?.checkIntervalSeconds ?? 0}s`} variant={summary.data?.enabled ? 'success' : 'default'} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="glass-panel p-5">
          <p className="section-title">Manual injection</p>
          <h2 className="mt-1 text-xl font-semibold text-th-text">Create Economy Alert</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-th-text">Type</span>
              <input className="dune-input" name="alert-type" autoComplete="off" value={type} onChange={(event) => setType(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-th-text">Severity</span>
              <select className="dune-input" value={severity} onChange={(event) => setSeverity(event.target.value as EconomyAlert['severity'])}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-medium text-th-text">Message</span>
              <input className="dune-input" name="alert-message" autoComplete="off" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Flag suspicious market behavior&#x2026;" />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-medium text-th-text">Details (JSON)</span>
              <textarea className="dune-input min-h-[160px]" name="alert-details" autoComplete="off" spellCheck={false} value={detailsText} onChange={(event) => setDetailsText(event.target.value)} />
            </label>
          </div>
          {formError ? <p className="mt-4 text-sm text-red-700 dark:text-red-300">{formError}</p> : null}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-th-text-m">
            <span>Thresholds: {summary.data?.solariThreshold?.toLocaleString() ?? 0} Solari • {summary.data?.baseClaimThreshold ?? 0} claims</span>
            <button type="button" className="dune-button" onClick={() => void handleCreateAlert()} disabled={submitting}>
              <Coins className="mr-2 h-4 w-4" /> {submitting ? 'Creating\u2026' : 'Create alert'}
            </button>
          </div>
        </div>

        <div className="glass-panel overflow-hidden">
          <div className="border-b border-th-border-m/80 p-5">
            <p className="section-title">Anomaly feed</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Economy Alerts</h2>
          </div>
          <div className="divide-y divide-th-border-m/80">
            {(alerts.data ?? []).map((alert) => (
              <div key={alert.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]', severityClasses[alert.severity])}>
                      {alert.severity}
                    </span>
                    <span className="rounded-full border border-th-border px-3 py-1 text-xs uppercase tracking-[0.18em] text-th-text-s">
                      {alert.type}
                    </span>
                    {alert.acknowledged ? <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-200">Acknowledged</span> : null}
                  </div>
                  <div>
                    <p className="font-semibold text-th-text">{alert.message}</p>
                    <p className="mt-1 text-sm text-th-text-m">{new Date(alert.timestamp).toLocaleString()}</p>
                  </div>
                  <pre className="overflow-x-auto rounded-2xl border border-th-border-m/80 bg-th-bg/60 p-4 text-xs text-th-text-s">{JSON.stringify(alert.details, null, 2)}</pre>
                </div>
                <div>
                  <button
                    type="button"
                    className="dune-button-muted"
                    onClick={() => void handleAcknowledge(alert.id)}
                    disabled={alert.acknowledged || acknowledgingId === alert.id}
                  >
                    {alert.acknowledged ? 'Acknowledged' : acknowledgingId === alert.id ? 'Saving\u2026' : 'Acknowledge'}
                  </button>
                </div>
              </div>
            ))}
            {(alerts.data ?? []).length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
                <Coins className="h-10 w-10 text-amber-600 dark:text-amber-300" />
                <div>
                  <h3 className="text-xl font-semibold text-th-text">No Economy Alerts</h3>
                  <p className="mt-2 max-w-xl text-th-text-m">Monitoring is active, but no anomalies have been recorded yet.</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function EconomyPageSkeleton() {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="glass-panel p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="glass-panel p-5 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-48" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2 md:col-span-1 last:md:col-span-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            ))}
            <div className="space-y-2 md:col-span-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-11 w-32 rounded-xl" />
          </div>
        </div>
        <TableSkeleton rows={5} />
      </section>
    </div>
  );
}
