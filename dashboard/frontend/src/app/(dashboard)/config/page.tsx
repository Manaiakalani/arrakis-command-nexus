'use client';

import { useCallback, useMemo } from 'react';

import { ConfigEditor } from '@/components/ConfigEditor';
import { Skeleton } from '@/components/Skeleton';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

const configFiles = ['UserGame.ini', 'UserEngine.ini', 'director.ini', 'gateway.ini'];

export default function ConfigPage() {
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
    await apiClient.updateConfig(filename, data);
    await refreshConfigs();
  }, [refreshConfigs]);

  const handleAcceptDrift = useCallback(async (filename: string) => {
    await apiClient.acceptConfigDrift(filename);
    await refreshConfigs();
  }, [refreshConfigs]);

  const isLoading = configs.loading || driftStatus.loading;

  if (isLoading) {
    return <ConfigPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="glass-panel border-amber-500/20 bg-amber-500/10 p-5">
        <p className="section-title text-amber-700/80 dark:text-amber-200/80">Configuration changes</p>
        <h2 className="mt-1 text-xl font-semibold text-amber-900 dark:text-amber-100">Changes Require Restart</h2>
        <p className="mt-2 max-w-3xl text-sm text-amber-800/80 dark:text-amber-100/80">Edit server settings below, then click <strong>Save changes</strong>. Restart the affected service from the <em>Map orchestration</em> page to apply.</p>
      </div>
      <div className="glass-panel p-5 text-th-text">
        <p className="section-title">Drift summary</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold">{driftedCount} config file{driftedCount === 1 ? '' : 's'} drifted</h3>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200">
            {driftedCount > 0 ? 'Review recommended' : 'All baselines current'}
          </span>
        </div>
        <p className="mt-2 text-sm text-th-text-m">Drift compares each config file to its last accepted baseline so manual edits stand out before your next restart.</p>
      </div>
      <ConfigEditor files={configs.data ?? []} onSave={handleSave} onAcceptDrift={handleAcceptDrift} />
    </div>
  );
}

function ConfigPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="glass-panel border-amber-500/20 bg-amber-500/10 p-5 space-y-2">
        <Skeleton className="h-3 w-32 bg-amber-500/20" />
        <Skeleton className="h-8 w-64 bg-amber-500/20" />
        <Skeleton className="h-4 w-full max-w-3xl bg-amber-500/20" />
      </div>
      <div className="glass-panel p-5 space-y-3 text-th-text">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-32 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-14 w-full rounded-2xl" />
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
