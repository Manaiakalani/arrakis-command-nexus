'use client';

import { useEffect, useState } from 'react';

import { BackupList } from '@/components/BackupList';
import { Skeleton, TableSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { BackupSchedule } from '@/lib/types';

const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: false,
  intervalHours: 24,
  retentionDays: 7,
  lastRunAt: null,
  nextRunAt: null,
};

function formatDate(value?: string | null, fallback = 'Never') {
  return value ? new Date(value).toLocaleString() : fallback;
}

export default function BackupsPage() {
  const { toast } = useToast();
  const backups = useApi(() => apiClient.getBackups(), { refreshInterval: 15000, initialData: [] });
  const scheduleApi = useApi(() => apiClient.getBackupSchedule(), { refreshInterval: 15000, initialData: DEFAULT_SCHEDULE });
  const [schedule, setSchedule] = useState<BackupSchedule>(DEFAULT_SCHEDULE);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  useEffect(() => {
    if (scheduleApi.data) {
      setSchedule(scheduleApi.data);
    }
  }, [scheduleApi.data]);

  const totalSize = (backups.data ?? []).reduce((sum, backup) => sum + backup.sizeBytes, 0);
  const isLoading = backups.loading || scheduleApi.loading;

  if (isLoading) {
    return <BackupsPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="glass-panel p-5">
        <p className="section-title">Storage usage summary</p>
        <h2 className="mt-1 text-xl font-semibold text-th-text">Recovery footprint</h2>
        <p className="mt-2 text-sm text-th-text-m">{(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB retained across {(backups.data ?? []).length} snapshots.</p>
      </div>
      <div className="glass-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="section-title">Schedule configuration</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Automated backups</h2>
            <p className="mt-2 text-sm text-th-text-m">Create scheduled recovery points and prune snapshots older than your retention window.</p>
          </div>
          <button
            type="button"
            className="dune-button-muted"
            onClick={() => {
              setScheduleMessage(null);
              setSchedule((current) => ({ ...current, enabled: !current.enabled }));
            }}
          >
            {schedule.enabled ? 'Disable scheduling' : 'Enable scheduling'}
          </button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Status</p>
            <p className="mt-2 text-lg font-semibold text-th-text">{schedule.enabled ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Interval</p>
            <p className="mt-2 text-lg font-semibold text-th-text">Every {schedule.intervalHours} hour{schedule.intervalHours === 1 ? '' : 's'}</p>
          </div>
          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Last run</p>
            <p className="mt-2 text-sm font-medium text-th-text">{formatDate(schedule.lastRunAt)}</p>
          </div>
          <div className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 text-sm text-th-text-s">
            <p className="text-xs uppercase tracking-[0.2em] text-th-text-m">Next run</p>
            <p className="mt-2 text-sm font-medium text-th-text">{formatDate(schedule.nextRunAt, 'Not scheduled')}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3 text-sm text-th-text-s">
            <span className="mb-2 block text-th-text">Interval (hours)</span>
            <input
              className="dune-input"
              min={1}
              type="number"
              value={schedule.intervalHours}
              onChange={(event) => {
                setScheduleMessage(null);
                setSchedule((current) => ({ ...current, intervalHours: Math.max(1, Number(event.target.value) || 1) }));
              }}
            />
          </label>
          <label className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3 text-sm text-th-text-s">
            <span className="mb-2 block text-th-text">Retention (days)</span>
            <input
              className="dune-input"
              min={0}
              type="number"
              value={schedule.retentionDays}
              onChange={(event) => {
                setScheduleMessage(null);
                setSchedule((current) => ({ ...current, retentionDays: Math.max(0, Number(event.target.value) || 0) }));
              }}
            />
          </label>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-th-text-m">{scheduleMessage ?? 'Save changes to apply the updated schedule immediately.'}</p>
          <button
            type="button"
            className="dune-button"
            disabled={savingSchedule}
            onClick={async () => {
              setSavingSchedule(true);
              try {
                const updated = await apiClient.updateBackupSchedule({
                  enabled: schedule.enabled,
                  intervalHours: schedule.intervalHours,
                  retentionDays: schedule.retentionDays,
                });
                scheduleApi.setData(updated);
                setSchedule(updated);
                setScheduleMessage('Backup schedule saved.');
                toast('Backup schedule saved.', 'success');
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to save backup schedule.';
                setScheduleMessage(message);
                toast(`Failed to save backup schedule: ${message}`, 'error');
              } finally {
                setSavingSchedule(false);
              }
            }}
          >
            {savingSchedule ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </div>
      <BackupList
        backups={backups.data ?? []}
        onCreate={async (scope) => {
          try {
            await apiClient.createBackup(scope);
            await backups.refetch();
            await scheduleApi.refetch();
            toast('Backup created successfully.', 'success');
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Backup creation failed.';
            toast(`Failed to create backup: ${message}`, 'error');
          }
        }}
        onRestore={async (id) => {
          try {
            await apiClient.restoreBackup(id);
            toast('Backup restored successfully.', 'success');
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Restore failed.';
            toast(`Failed to restore backup: ${message}`, 'error');
          }
        }}
        onDelete={async (id) => {
          try {
            await apiClient.deleteBackup(id);
            await backups.refetch();
            toast('Backup deleted successfully.', 'success');
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Delete failed.';
            toast(`Failed to delete backup: ${message}`, 'error');
          }
        }}
      />
    </div>
  );
}

function BackupsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="glass-panel p-5 space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="glass-panel p-5 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
          <Skeleton className="h-11 w-40 rounded-xl" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-th-border/70 bg-th-surface-s/60 p-4 space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="space-y-2 rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-11 w-32 rounded-xl" />
        </div>
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}
