'use client';

import { Plus, Send, TestTube2, Trash2, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { DiscordWebhook } from '@/lib/types';

const availableEvents = ['server-start', 'server-stop', 'server-crash', 'player-join', 'player-leave', 'update-available', 'backup', 'scheduled-restart', 'admin-action', 'resource-alert'];

const eventLabels: Record<string, string> = {
  'server-start': 'Server Start',
  'server-stop': 'Server Stop',
  'server-crash': 'Server Crash',
  'player-join': 'Player Join',
  'player-leave': 'Player Leave',
  'update-available': 'Update Available',
  'backup': 'Backup Created / Failed',
  'scheduled-restart': 'Scheduled Restart',
  'admin-action': 'Admin Action (grants, teleports, kicks, bans)',
  'resource-alert': 'Resource Alert (memory / CPU pressure)',
};

interface DiscordSettingsProps {
  webhooks: DiscordWebhook[];
  onAdd: (data: Omit<DiscordWebhook, 'id'>) => Promise<void> | void;
  onUpdate: (id: string, data: Partial<DiscordWebhook>) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onTest: () => Promise<void> | void;
  onAnnouncement: (text: string) => Promise<void> | void;
}

export function DiscordSettings({ webhooks, onAdd, onUpdate, onDelete, onTest, onAnnouncement }: DiscordSettingsProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DiscordWebhook[]>(webhooks);
  const [announcement, setAnnouncement] = useState('');
  const [newWebhook, setNewWebhook] = useState({ name: 'Operations Feed', url: '', enabled: true, events: availableEvents });
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Prune dirty IDs for webhooks no longer present (deleted server-side)
    const serverIds = new Set(webhooks.map((w) => w.id));
    setDirtyIds((current) => {
      const pruned = new Set([...current].filter((id) => serverIds.has(id)));
      return pruned.size === current.size ? current : pruned;
    });
    // Merge server data while preserving locally-edited fields
    setDrafts((current) => {
      if (dirtyIds.size === 0) return webhooks;
      return webhooks.map((incoming) => {
        if (dirtyIds.has(incoming.id)) {
          const local = current.find((d) => d.id === incoming.id);
          if (!local) return incoming;
          // Preserve only editable fields; let server-owned fields (health, recentEvents) update
          return { ...incoming, name: local.name, enabled: local.enabled, events: local.events };
        }
        return incoming;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webhooks]);

  const updateDraft = (id: string, patch: Partial<DiscordWebhook>) => {
    setDirtyIds((current) => new Set(current).add(id));
    setDrafts((current) => current.map((webhook) => (webhook.id === id ? { ...webhook, ...patch } : webhook)));
  };

  return (
    <div className="space-y-6">
      <div className="glass-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="flex-1">
            <span className="mb-2 block text-sm font-medium text-th-text">Webhook name</span>
            <input className="dune-input" name="webhook-name" autoComplete="off" value={newWebhook.name} onChange={(event) => setNewWebhook((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="flex-[2]">
            <span className="mb-2 block text-sm font-medium text-th-text">Webhook URL</span>
            <input className="dune-input" name="webhook-url" type="url" autoComplete="off" spellCheck={false} value={newWebhook.url} onChange={(event) => setNewWebhook((current) => ({ ...current, url: event.target.value }))} placeholder="https://discord.com/api/webhooks/&#x2026;" />
          </label>
          <button
            type="button"
            className="dune-button"
            onClick={() => {
              if (newWebhook.url) {
                void onAdd({ ...newWebhook, isHealthy: true, lastTriggeredAt: null, recentEvents: [] });
                setNewWebhook({ name: 'Operations Feed', url: '', enabled: true, events: availableEvents });
              }
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add webhook
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-4">
          {drafts.map((webhook) => (
            <div key={webhook.id} className="glass-panel p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-600 dark:text-amber-300">
                    <Webhook className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-th-text">{webhook.name}</h3>
                    <p className="mt-1 text-sm text-th-text-m break-all">{webhook.url}</p>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-th-border bg-th-surface-s/70 px-3 py-1 text-xs text-th-text-s">
                      <span className={`h-2 w-2 rounded-full ${webhook.isHealthy ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      {webhook.isHealthy ? 'Connected' : 'Attention needed'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 rounded-full border border-th-border bg-th-surface-s/70 px-3 py-2 text-xs text-th-text-s">
                    <input type="checkbox" checked={webhook.enabled} onChange={(event) => updateDraft(webhook.id, { enabled: event.target.checked })} className="accent-amber-400" />
                    Enabled
                  </label>
                  <button type="button" className="dune-button-muted px-3 py-2 text-xs text-red-700 dark:text-red-300" onClick={() => setPendingDeleteId(webhook.id)}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {availableEvents.map((eventName) => {
                  const enabled = webhook.events.includes(eventName);
                  return (
                    <label key={eventName} className="flex items-center justify-between rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3 text-sm text-th-text-s">
                      <span>{eventLabels[eventName] ?? eventName}</span>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                          const nextEvents = event.target.checked
                            ? [...webhook.events, eventName]
                            : webhook.events.filter((value) => value !== eventName);
                          updateDraft(webhook.id, { events: nextEvents });
                        }}
                        className="accent-amber-400"
                      />
                    </label>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className="dune-button" onClick={async () => { await onUpdate(webhook.id, { name: webhook.name, enabled: webhook.enabled, events: webhook.events }); setDirtyIds((current) => { const next = new Set(current); next.delete(webhook.id); return next; }); }}>
                  Save webhook
                </button>
                <button type="button" className="dune-button-muted" onClick={() => void onTest()}>
                  <TestTube2 className="mr-2 h-4 w-4" /> Send test
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="glass-panel p-5">
          <p className="section-title">Manual broadcast</p>
          <h3 className="mt-1 text-lg font-semibold text-th-text">Send announcement</h3>
          <textarea className="dune-input mt-4 min-h-[200px]" value={announcement} onChange={(event) => setAnnouncement(event.target.value)} placeholder="Attention, sleepers. Maintenance begins at sunset…" />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="dune-button"
              onClick={() => {
                if (announcement.trim()) {
                  void onAnnouncement(announcement.trim());
                  setAnnouncement('');
                }
              }}
            >
              <Send className="mr-2 h-4 w-4" /> Send announcement
            </button>
            <button type="button" className="dune-button-muted" onClick={() => void onTest()}>
              <TestTube2 className="mr-2 h-4 w-4" /> Test embed
            </button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Remove Webhook"
        message="Remove this webhook? It will no longer receive notifications."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => { if (pendingDeleteId !== null) void onDelete(pendingDeleteId); setPendingDeleteId(null); }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
