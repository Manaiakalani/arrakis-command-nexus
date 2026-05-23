'use client';

import { ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

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

export function BackupList({ backups, onCreate, onRestore, onDelete }: BackupListProps) {
  const [scope, setScope] = useState('full');

  return (
    <div className="glass-panel overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-800/80 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="section-title">Recovery vault</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-50">Backup inventory</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={scope} onChange={(event) => setScope(event.target.value)} className="dune-input min-w-[180px]" aria-label="Backup scope">
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
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900/50 text-xs uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th className="px-5 py-4 font-medium">Name</th>
              <th className="px-5 py-4 font-medium">Date</th>
              <th className="px-5 py-4 font-medium">Size</th>
              <th className="px-5 py-4 font-medium">Scope</th>
              <th className="px-5 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {backups.map((backup) => (
              <tr key={backup.id} className="transition-colors hover:bg-slate-900/50">
                <td className="px-5 py-4 text-slate-100">{backup.name}</td>
                <td className="px-5 py-4 tabular-nums text-slate-300">{new Date(backup.createdAt).toLocaleString()}</td>
                <td className="px-5 py-4 tabular-nums text-slate-300">{formatBytes(backup.sizeBytes)}</td>
                <td className="px-5 py-4 text-slate-300 capitalize">{backup.scope}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="dune-button-muted px-3 py-2 text-xs" onClick={() => window.confirm('Restore this backup?') && void onRestore(backup.id)}>
                      <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Restore
                    </button>
                    <button type="button" className="dune-button-muted px-3 py-2 text-xs text-red-300" onClick={() => window.confirm('Delete this backup?') && void onDelete(backup.id)}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {backups.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-slate-400">No backups yet. Create a fresh snapshot before the next sandstorm.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
