'use client';

import { useCallback, useMemo } from 'react';

import { ConfigEditor } from '@/components/ConfigEditor';
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

  return (
    <div className="space-y-6">
      <div className="glass-panel border-amber-500/20 bg-amber-500/10 p-5 text-amber-100">
        <p className="section-title text-amber-200/80">Configuration changes</p>
        <h2 className="mt-1 text-xl font-semibold">Changes require restart</h2>
        <p className="mt-2 max-w-3xl text-sm text-amber-100/80">Tune shard behavior, networking, and director systems from a single command panel. Save updates, then restart the affected services to apply them.</p>
      </div>
      <div className="glass-panel p-5 text-slate-100">
        <p className="section-title">Drift summary</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold">{driftedCount} config file{driftedCount === 1 ? '' : 's'} drifted</h3>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
            {driftedCount > 0 ? 'Review recommended' : 'All baselines current'}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-400">Drift compares each config file to its last accepted baseline so manual edits stand out before your next restart.</p>
      </div>
      <ConfigEditor files={configs.data ?? []} onSave={handleSave} onAcceptDrift={handleAcceptDrift} />
    </div>
  );
}
