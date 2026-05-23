'use client';

import { AlertTriangle, BadgeAlert, Coins, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { StatusCard } from '@/components/StatusCard';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { EconomyAlert } from '@/lib/types';
import { cn } from '@/lib/utils';

const severityClasses: Record<EconomyAlert['severity'], string> = {
  info: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  critical: 'border-red-500/20 bg-red-500/10 text-red-200',
};

export default function EconomyPage() {
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
    } finally {
      setSubmitting(false);
    }
  };

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
          <h2 className="mt-1 text-xl font-semibold text-slate-50">Create Economy Alert</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-100">Type</span>
              <input className="dune-input" name="alert-type" autoComplete="off" value={type} onChange={(event) => setType(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-100">Severity</span>
              <select className="dune-input" value={severity} onChange={(event) => setSeverity(event.target.value as EconomyAlert['severity'])}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-medium text-slate-100">Message</span>
              <input className="dune-input" name="alert-message" autoComplete="off" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Flag suspicious market behavior&#x2026;" />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-medium text-slate-100">Details (JSON)</span>
              <textarea className="dune-input min-h-[160px]" name="alert-details" autoComplete="off" spellCheck={false} value={detailsText} onChange={(event) => setDetailsText(event.target.value)} />
            </label>
          </div>
          {formError ? <p className="mt-4 text-sm text-red-300">{formError}</p> : null}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
            <span>Thresholds: {summary.data?.solariThreshold?.toLocaleString() ?? 0} Solari • {summary.data?.baseClaimThreshold ?? 0} claims</span>
            <button type="button" className="dune-button" onClick={() => void handleCreateAlert()} disabled={submitting}>
              <Coins className="mr-2 h-4 w-4" /> {submitting ? 'Creating\u2026' : 'Create alert'}
            </button>
          </div>
        </div>

        <div className="glass-panel overflow-hidden">
          <div className="border-b border-slate-800/80 p-5">
            <p className="section-title">Anomaly feed</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-50">Economy Alerts</h2>
          </div>
          <div className="divide-y divide-slate-800/80">
            {(alerts.data ?? []).map((alert) => (
              <div key={alert.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]', severityClasses[alert.severity])}>
                      {alert.severity}
                    </span>
                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
                      {alert.type}
                    </span>
                    {alert.acknowledged ? <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-200">Acknowledged</span> : null}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-100">{alert.message}</p>
                    <p className="mt-1 text-sm text-slate-400">{new Date(alert.timestamp).toLocaleString()}</p>
                  </div>
                  <pre className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4 text-xs text-slate-300">{JSON.stringify(alert.details, null, 2)}</pre>
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
                <Coins className="h-10 w-10 text-amber-300" />
                <div>
                  <h3 className="text-xl font-semibold text-slate-50">No Economy Alerts</h3>
                  <p className="mt-2 max-w-xl text-slate-400">Monitoring is active, but no anomalies have been recorded yet.</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
