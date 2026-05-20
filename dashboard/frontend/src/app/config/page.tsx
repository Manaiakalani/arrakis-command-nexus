'use client';

import { useCallback } from 'react';

import { ConfigEditor } from '@/components/ConfigEditor';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

const configFiles = ['UserGame.ini', 'UserEngine.ini', 'director.ini', 'gateway.ini'];

export default function ConfigPage() {
  const configs = useApi(() => Promise.all(configFiles.map((file) => apiClient.getConfig(file))), { initialData: [] });

  const handleSave = useCallback(async (filename: string, data: Record<string, string | number | boolean>) => {
    await apiClient.updateConfig(filename, data);
    await configs.refetch();
  }, [configs]);

  return (
    <div className="space-y-6">
      <div className="glass-panel border-amber-500/20 bg-amber-500/10 p-5 text-amber-100">
        <p className="section-title text-amber-200/80">Configuration changes</p>
        <h2 className="mt-1 text-xl font-semibold">Changes require restart</h2>
        <p className="mt-2 max-w-3xl text-sm text-amber-100/80">Tune shard behavior, networking, and director systems from a single command panel. Save updates, then restart the affected services to apply them.</p>
      </div>
      <ConfigEditor files={configs.data ?? []} onSave={handleSave} />
    </div>
  );
}
