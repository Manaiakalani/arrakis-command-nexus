'use client';

import { ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { BackupEntry } from '@/lib/types';

interface BackupListProps {
  backups: BackupEntry[];
  onCreate: (scope: string) => Promise<void> | void;
  onRestore: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

type PendingAction = { type: 'restore'; id: string } | { type: 'delete'; id: string } | null;

export function BackupList({ backups, onCreate, onRestore, onDelete }: BackupListProps) {
  const [scope, setScope] = useState('full');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  return (
    <div className="glass-panel overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-th-border-m/80 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="section-title">Recovery vault</p>
          <h3 className="mt-1 text-lg font-semibold text-th-text">Backup inventory</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={scope} onChange={(event) => setScope(event.target.value)} className="dune-input w-full sm:min-w-[180px] sm:w-auto" aria-label="Backup scope">
            <option value="full">Full backup</option>
            <option value="configs">Configs only</option>
            <option value="save-data">Save data</option>
            <option value="database">Database</option>
          </select>
          <button type="button" onClick={() => void onCreate(scope)} className="dune-button">
            <Plus className="mr-2 h-4 w-4" /> Create backup
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-th-border-m text-left text-sm">
          <thead className="bg-th-surface-s/50 text-xs uppercase tracking-[0.2em] text-th-text-m">
            <tr>
              <th className="px-5 py-4 font-medium">Name</th>
              <th className="px-5 py-4 font-medium">Date</th>
              <th className="px-5 py-4 font-medium">Size</th>
              <th className="px-5 py-4 font-medium">Scope</th>
              <th className="px-5 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-th-border-m/80">
            {backups.map((backup) => (
              <tr key={backup.id} className="transition-colors hover:bg-th-surface-s/50">
                <td className="px-5 py-4 text-th-text">{backup.name}</td>
                <td className="px-5 py-4 tabular-nums text-th-text-s">{new Date(backup.createdAt).toLocaleString()}</td>
                <td className="px-5 py-4 tabular-nums text-th-text-s">{formatBytes(backup.sizeBytes)}</td>
                <td className="px-5 py-4 text-th-text-s capitalize">{backup.scope}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="dune-button-muted px-3 py-2 text-xs" onClick={() => setPendingAction({ type: 'restore', id: backup.id })}>
                      <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Restore
                    </button>
                    <button type="button" className="dune-button-muted px-3 py-2 text-xs text-red-700 dark:text-red-300" onClick={() => setPendingAction({ type: 'delete', id: backup.id })}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {backups.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-th-text-m">No backups yet. Create a fresh snapshot before the next sandstorm.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingAction?.type === 'restore'}
        title="Restore Backup"
        message="Restore this backup? Current data will be overwritten."
        confirmLabel="Restore"
        onConfirm={() => { if (pendingAction?.type === 'restore') void onRestore(pendingAction.id); setPendingAction(null); }}
        onCancel={() => setPendingAction(null)}
      />
      <ConfirmDialog
        open={pendingAction?.type === 'delete'}
        title="Delete Backup"
        message="Delete this backup? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { if (pendingAction?.type === 'delete') void onDelete(pendingAction.id); setPendingAction(null); }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}