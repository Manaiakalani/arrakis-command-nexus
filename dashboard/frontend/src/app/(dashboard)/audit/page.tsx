'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
} from 'lucide-react';

import { useToast } from '@/components/ToastProvider';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';
const TOKEN =
  typeof window !== 'undefined' ? localStorage.getItem('admin_token') ?? '' : '';

interface AuditEntry {
  id: number;
  action: string;
  details: Record<string, unknown>;
  performed_by: string;
  created_at: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  player_login: 'Player Login',
  player_logout: 'Player Logout',
  player_kick: 'Player Kicked',
  player_ban_add: 'Player Banned',
  player_ban_remove: 'Ban Removed',
  allowlist_add: 'Allowlist Add',
  allowlist_remove: 'Allowlist Remove',
  item_grant: 'Item Granted',
  solari_grant: 'Solari Granted',
  teleport: 'Teleport',
  character_update: 'Character Update',
  health_set: 'Health Set',
  config_update: 'Config Changed',
  config_drift_accept: 'Drift Accepted',
  backup_create: 'Backup Created',
  backup_restore: 'Backup Restored',
  announcement_send: 'Announcement Sent',
  discord_webhook_add: 'Webhook Added',
};

const ACTION_COLORS: Record<string, string> = {
  player_login: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  player_logout: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  player_kick: 'bg-red-500/20 text-red-400 border-red-500/30',
  player_ban_add: 'bg-red-500/20 text-red-400 border-red-500/30',
  player_ban_remove: 'bg-green-500/20 text-green-400 border-green-500/30',
  allowlist_add: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  item_grant: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  solari_grant: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  teleport: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  config_update: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const CATEGORY_LABELS: Record<string, string> = {
  player: 'Player Actions',
  character: 'Character Actions',
  config: 'Config Changes',
  system: 'System Actions',
};

const PAGE_SIZE = 25;

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDetails(details: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (k === 'changes' && typeof v === 'object' && v) {
      const changes = v as Record<string, unknown>;
      const keys = Object.keys(changes);
      parts.push(`${keys.length} setting${keys.length !== 1 ? 's' : ''} changed`);
    } else {
      parts.push(`${k}: ${String(v)}`);
    }
  }
  return parts.join(' | ');
}

export default function AuditPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>('');
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (category) params.set('category', category);

      const res = await fetch(`${API}/api/audit?${params}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      toast('Failed to load audit trail', 'error');
    } finally {
      setLoading(false);
    }
  }, [offset, category, toast]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/audit/summary`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.by_action ?? {});
      }
    } catch {
      toast('Failed to load audit summary', 'error');
    }
  }, [toast]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-7 w-7 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold text-th-text">Audit Trail</h1>
            <p className="text-sm text-th-text-m">
              Track all admin actions, config changes, and player events
            </p>
          </div>
        </div>
        <button
          onClick={() => { fetchAudit(); fetchSummary(); }}
          className="dune-button-muted flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
          const catActions = {
            player: ['player_login', 'player_logout', 'player_kick', 'player_ban_add', 'player_ban_remove', 'allowlist_add'],
            character: ['item_grant', 'solari_grant', 'teleport', 'character_update', 'health_set'],
            config: ['config_update', 'config_drift_accept'],
            system: ['backup_create', 'backup_restore', 'announcement_send', 'discord_webhook_add'],
          }[cat] ?? [];
          const count = catActions.reduce((sum, a) => sum + (summary[a] ?? 0), 0);
          return (
            <button
              key={cat}
              onClick={() => { setCategory(category === cat ? '' : cat); setOffset(0); }}
              className={`rounded-xl border p-4 text-left transition-colors ${
                category === cat
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-th-border/50 bg-th-surface-s/40 hover:bg-th-surface/70'
              }`}
            >
              <p className="text-xs text-th-text-m">{label}</p>
              <p className="text-2xl font-bold text-th-text">{count}</p>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 text-sm text-th-text-m">
        <Filter className="h-4 w-4" />
        <span>
          {category ? `Filtered: ${CATEGORY_LABELS[category] ?? category}` : 'All events'}
        </span>
        <span className="ml-auto">{total} total entries</span>
      </div>

      {/* Table */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-th-text-m">Loading audit trail...</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-th-text-m">No audit entries found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-th-border/50 text-th-text-m">
                <th className="px-4 py-3 text-left font-medium">Time</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3 text-left font-medium">Details</th>
                <th className="px-4 py-3 text-left font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-th-border-m/50">
              {entries.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  className="hover:bg-th-surface-s/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-th-text-m whitespace-nowrap">
                    {formatDate(e.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${
                        ACTION_COLORS[e.action] ?? 'bg-th-surface-s/30 text-th-text-s border-th-border/30'
                      }`}
                    >
                      {ACTION_LABELS[e.action] ?? e.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-th-text-s max-w-md">
                    {expandedId === e.id ? (
                      <pre className="whitespace-pre-wrap text-xs text-th-text-s bg-th-bg-s/60 rounded p-2 mt-1">
                        {JSON.stringify(e.details, null, 2)}
                      </pre>
                    ) : (
                      <span className="truncate block max-w-md">{formatDetails(e.details)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-th-text-m whitespace-nowrap">
                    {e.performed_by}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-th-text-m">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="dune-button-muted flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="dune-button-muted flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
