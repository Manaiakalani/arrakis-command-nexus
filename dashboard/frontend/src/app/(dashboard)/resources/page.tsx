'use client';

import { AlertTriangle, Cpu, HardDrive, Package, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

interface ResourceEntry {
  key: string;
  label: string;
  description: string;
  category: string;
  value: string;
  default: string;
  options: Array<{ value: string; label: string }>;
}

const CATEGORY_META: Record<string, { title: string; subtitle: string; icon: typeof Cpu }> = {
  'game-servers': {
    title: 'Game Server Resources',
    subtitle: 'Memory and CPU limits for map partition servers. These are the largest resource consumers.',
    icon: HardDrive,
  },
  infrastructure: {
    title: 'Infrastructure Services',
    subtitle: 'Resource limits for supporting services (database, message broker, director, gateway).',
    icon: Cpu,
  },
};

export default function ResourcesPage() {
  const { toast } = useToast();
  const resources = useApi(() => apiClient.getResourceLimits(), { initialData: null });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setEdits({});
    setFeedback(null);
  }, [resources.data]);

  const getValue = useCallback(
    (key: string, original: string) => (key in edits ? edits[key] : original),
    [edits],
  );

  const changeCount = Object.keys(edits).length;

  const handleSave = async () => {
    if (changeCount === 0) return;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await apiClient.updateResourceLimits(edits);
      setFeedback({ type: 'success', text: result.message });
      setEdits({});
      await resources.refetch();
      toast(result.message, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setFeedback({ type: 'error', text: message });
      toast(`Failed to save resource limits: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setEdits({});
    setFeedback(null);
  };

  if (resources.loading || !resources.data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const grouped: Record<string, ResourceEntry[]> = {};
  for (const r of resources.data.resources) {
    (grouped[r.category] ??= []).push(r);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="section-title">Infrastructure tuning</p>
          <h1 className="mt-1 inline-flex items-center gap-3 text-2xl font-bold text-th-text sm:text-3xl"><Package aria-hidden="true" className="h-7 w-7 text-amber-600 dark:text-amber-300" /> Resource Limits</h1>
          <p className="mt-2 text-sm text-th-text-m">
            Adjust Docker container memory and CPU caps. Changes update the <code className="rounded bg-th-surface-s px-1.5 py-0.5 text-xs">.env</code> file and require a container restart to take effect.
          </p>
        </div>
        {changeCount > 0 ? (
          <div className="flex items-center gap-2">
            <button type="button" className="dune-button-muted" onClick={handleReset} disabled={saving}>
              <RotateCcw aria-hidden="true" className="mr-1.5 h-4 w-4" /> Discard
            </button>
            <button type="button" className="dune-button" onClick={() => void handleSave()} disabled={saving}>
              <Save aria-hidden="true" className="mr-1.5 h-4 w-4" />
              {saving ? 'Saving…' : `Save ${changeCount} change${changeCount === 1 ? '' : 's'}`}
            </button>
          </div>
        ) : null}
      </div>

      {/* Restart warning */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="text-sm text-th-text-m">
          <p className="font-medium text-th-text">Changes require a container restart</p>
          <p className="mt-1">
            Saving updates the <code className="rounded bg-th-surface-s px-1 py-0.5 text-xs">.env</code> file on the host.
            Navigate to <strong>Maps</strong> to restart individual map servers, or use <strong>Watchdog</strong> to restart infrastructure services.
          </p>
        </div>
      </div>

      {/* Feedback */}
      {feedback ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200'}`}>
          {feedback.text}
        </div>
      ) : null}

      {/* Category sections */}
      {Object.entries(CATEGORY_META).map(([category, meta]) => {
        const items = grouped[category];
        if (!items?.length) return null;
        const Icon = meta.icon;
        return (
          <div key={category} className="glass-panel p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-600 dark:text-amber-300">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-th-text">{meta.title}</h2>
                <p className="text-sm text-th-text-m">{meta.subtitle}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {items.map((resource) => {
                const current = getValue(resource.key, resource.value);
                const modified = resource.key in edits;
                const hasCurrentInOptions = resource.options.some((o) => o.value === current);
                return (
                  <div
                    key={resource.key}
                    className={`rounded-2xl border p-4 transition-colors ${modified ? 'border-amber-500/40 bg-amber-500/5' : 'border-th-border/70 bg-th-surface-s/60'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-th-text">
                          {resource.label}
                          {modified ? <span className="ml-2 text-xs text-amber-600 dark:text-amber-300">modified</span> : null}
                        </p>
                        <p className="mt-1 text-sm text-th-text-m">{resource.description}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <select
                        className="dune-input"
                        value={current}
                        aria-label={`Set ${resource.label}`}
                        onChange={(e) => {
                          const newVal = e.target.value;
                          if (newVal === resource.value) {
                            setEdits((prev) => {
                              const next = { ...prev };
                              delete next[resource.key];
                              return next;
                            });
                          } else {
                            setEdits((prev) => ({ ...prev, [resource.key]: newVal }));
                          }
                        }}
                      >
                        {!hasCurrentInOptions ? (
                          <option value={current}>{current} (custom)</option>
                        ) : null}
                        {resource.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}{opt.value === resource.default ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="mt-2 text-xs text-th-text-m">
                      <code className="rounded bg-th-surface-s px-1 py-0.5">{resource.key}</code>
                      {resource.value !== resource.default ? (
                        <span className="ml-2">Default: {resource.default}</span>
                      ) : null}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
