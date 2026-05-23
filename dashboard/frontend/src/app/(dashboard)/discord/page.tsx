'use client';

import { useMemo } from 'react';

import { DiscordSettings } from '@/components/DiscordSettings';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

export default function DiscordPage() {
  const webhooks = useApi(() => apiClient.getDiscordWebhooks(), { refreshInterval: 20000, initialData: [] });

  const eventHistory = useMemo(() => {
    return (webhooks.data ?? [])
      .flatMap((webhook) => webhook.recentEvents ?? [])
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 10);
  }, [webhooks.data]);

  return (
    <div className="space-y-6">
      <DiscordSettings
        webhooks={webhooks.data ?? []}
        onAdd={async (data) => {
          await apiClient.addWebhook(data);
          await webhooks.refetch();
        }}
        onUpdate={async (id, data) => {
          await apiClient.updateWebhook(id, data);
          await webhooks.refetch();
        }}
        onDelete={async (id) => {
          await apiClient.deleteWebhook(id);
          await webhooks.refetch();
        }}
        onTest={async () => {
          await apiClient.testWebhook();
        }}
        onAnnouncement={async (text) => {
          await apiClient.sendAnnouncement(text);
        }}
      />
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-slate-800/80 p-5">
          <p className="section-title">Event history</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-50">Last 10 Notifications</h2>
        </div>
        <div className="divide-y divide-slate-800/80">
          {eventHistory.map((event) => (
            <div key={event.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-slate-100">{event.event}</p>
                <p className="mt-1 text-sm text-slate-400">{event.message}</p>
              </div>
              <div className="text-right text-sm text-slate-400">
                <p className="capitalize text-slate-200">{event.status}</p>
                <p>{new Date(event.createdAt).toLocaleString()}</p>
              </div>
            </div>
          ))}
          {eventHistory.length === 0 ? <div className="p-10 text-center text-slate-400">No Discord notifications sent yet.</div> : null}
        </div>
      </div>
    </div>
  );
}
