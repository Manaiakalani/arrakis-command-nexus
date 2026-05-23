'use client';

import { Plus, Send, TestTube2, Trash2, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { DiscordWebhook } from '@/lib/types';

const availableEvents = ['server-start', 'server-stop', 'backup-complete', 'player-ban', 'map-restart'];

interface DiscordSettingsProps {
  webhooks: DiscordWebhook[];
  onAdd: (data: Omit<DiscordWebhook, 'id'>) => Promise<void> | void;
  onUpdate: (id: string, data: Partial<DiscordWebhook>) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onTest: () => Promise<void> | void;
  onAnnouncement: (text: string) => Promise<void> | void;
}

export function DiscordSettings({ webhooks, onAdd, onUpdate, onDelete, onTest, onAnnouncement }: DiscordSettingsProps) {
  const [drafts, setDrafts] = useState<DiscordWebhook[]>(webhooks);
  const [announcement, setAnnouncement] = useState('');
  const [newWebhook, setNewWebhook] = useState({ name: 'Operations Feed', url: '', enabled: true, events: availableEvents });

  useEffect(() => {
    setDrafts(webhooks);
  }, [webhooks]);

  const updateDraft = (id: string, patch: Partial<DiscordWebhook>) => {
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
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-300">
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
                  <button type="button" className="dune-button-muted px-3 py-2 text-xs text-red-300" onClick={() => window.confirm('Remove this webhook?') && void onDelete(webhook.id)}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {availableEvents.map((eventName) => {
                  const enabled = webhook.events.includes(eventName);
                  return (
                    <label key={eventName} className="flex items-center justify-between rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3 text-sm text-th-text-s">
                      <span>{eventName}</span>
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
                <button type="button" className="dune-button" onClick={() => void onUpdate(webhook.id, webhook)}>
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
          <h3 className="mt-1 text-lg font-semibold text-th-text">Send Announcement</h3>
          <textarea className="dune-input mt-4 min-h-[200px]" value={announcement} onChange={(event) => setAnnouncement(event.target.value)} placeholder="Attention, sleepers. Maintenance begins at sunset\u2026" />
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
    </div>
  );
}
