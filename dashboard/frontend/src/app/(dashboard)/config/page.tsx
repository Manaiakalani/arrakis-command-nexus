'use client';

import { CheckCircle2, FileCode, FileText, Settings, SlidersHorizontal } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { ConfigEditor } from '@/components/ConfigEditor';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

const configFiles = ['UserGame.ini', 'UserEngine.ini', 'director.ini', 'gateway.ini'];

export default function ConfigPage() {
  const { toast } = useToast();
  const configs = useApi(() => Promise.all(configFiles.map((file) => apiClient.getConfig(file))), { initialData: [] });
  const driftStatus = useApi(() => apiClient.getConfigDrift(), { initialData: { files: {} } });

  const driftedCount = useMemo(
    () => Object.values(driftStatus.data?.files ?? {}).filter((file) => file.drifted).length,
    [driftStatus.data],
  );

  const refreshConfigs = useCallback(async () => {
    await Promise.all([configs.refetch(), driftStatus.refetch()]);
  }, [configs, driftStatus]);

  const handleSave = useCallback(async (filename: string, data: Record<string, string | number | boolean>) => {
    try {
      await apiClient.updateConfig(filename, data);
      await refreshConfigs();
      toast(`${filename} saved successfully.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save config.';
      toast(`Failed to save config: ${message}`, 'error');
    }
  }, [refreshConfigs, toast]);

  const handleAcceptDrift = useCallback(async (filename: string) => {
    try {
      await apiClient.acceptConfigDrift(filename);
      await refreshConfigs();
      toast(`${filename} drift accepted.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to accept drift.';
      toast(`Failed to accept config drift: ${message}`, 'error');
    }
  }, [refreshConfigs, toast]);

  const isLoading = configs.loading || driftStatus.loading;

  if (isLoading) {
    return <ConfigPageSkeleton />;
  }

  const totalSettings = (configs.data ?? []).reduce((sum, f) => sum + f.fields.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel p-5">
        <p className="section-title">Server configuration</p>
        <h2 className="mt-1 inline-flex items-center gap-2 text-xl font-semibold text-th-text"><FileCode aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Battlegroup Settings</h2>
        <p className="mt-2 max-w-3xl text-sm text-th-text-m">
          Edit server settings below, then click <strong className="text-th-text-s">Save</strong> to write changes to the config file. A service restart is required for changes to take effect.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-th-border bg-th-surface-s/60 px-3 py-1.5 text-xs font-medium text-th-text-m">
            <FileText aria-hidden="true" className="h-3.5 w-3.5" /> {configFiles.length} config files
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-th-border bg-th-surface-s/60 px-3 py-1.5 text-xs font-medium text-th-text-m">
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" /> {totalSettings} settings
          </span>
          {driftedCount > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-200">
              {driftedCount} drifted
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> All baselines current
            </span>
          )}
        </div>
      </div>
      <ConfigEditor files={configs.data ?? []} onSave={handleSave} onAcceptDrift={handleAcceptDrift} />
    </div>
  );
}

function ConfigPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="glass-panel p-5 space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-3xl" />
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-32 rounded-full" />
            ))}
          </div>
        </div>
        <div className="space-y-6 p-4 sm:p-5">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="rounded-3xl border border-th-border-m/80 bg-th-bg-s/40 p-5 space-y-5">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-32" />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {Array.from({ length: 4 }).map((__, fieldIndex) => (
                  <div key={fieldIndex} className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-11 w-full rounded-xl" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-th-border-m/80 p-4 sm:p-5">
          <Skeleton className="h-11 w-44 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
