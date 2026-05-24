'use client';

import { useMemo } from 'react';

import { DiscordSettings } from '@/components/DiscordSettings';
import { Skeleton } from '@/components/Skeleton';
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

  if (webhooks.loading) {
    return <DiscordPageSkeleton />;
  }

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
        <div className="border-b border-th-border-m/80 p-5">
          <p className="section-title">Event history</p>
          <h2 className="mt-1 text-xl font-semibold text-th-text">Last 10 Notifications</h2>
        </div>
        <div className="divide-y divide-th-border-m/80">
          {eventHistory.map((event) => (
            <div key={event.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-th-text">{event.event}</p>
                <p className="mt-1 text-sm text-th-text-m">{event.message}</p>
              </div>
              <div className="text-right text-sm text-th-text-m">
                <p className="capitalize text-th-text-s">{event.status}</p>
                <p>{new Date(event.createdAt).toLocaleString()}</p>
              </div>
            </div>
          ))}
          {eventHistory.length === 0 ? <div className="p-10 text-center text-th-text-m">No Discord notifications sent yet.</div> : null}
        </div>
      </div>
    </div>
  );
}

function DiscordPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <div className="glass-panel p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
            <div className="flex-[2] space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
            <Skeleton className="h-11 w-36 rounded-xl" />
          </div>
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="glass-panel p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-11 w-11 rounded-2xl" />
                    <div className="space-y-2">
                      <Skeleton className="h-7 w-40" />
                      <Skeleton className="h-4 w-72" />
                      <Skeleton className="h-7 w-28 rounded-full" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-28 rounded-full" />
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((__, eventIndex) => (
                    <Skeleton key={eventIndex} className="h-14 w-full rounded-2xl" />
                  ))}
                </div>
                <div className="flex gap-3">
                  <Skeleton className="h-11 w-32 rounded-xl" />
                  <Skeleton className="h-11 w-28 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
          <div className="glass-panel p-5 space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-7 w-40" />
            </div>
            <Skeleton className="h-56 w-full rounded-2xl" />
            <div className="flex gap-3">
              <Skeleton className="h-11 w-40 rounded-xl" />
              <Skeleton className="h-11 w-32 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-5 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="divide-y divide-th-border-m/80">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-64" />
              </div>
              <div className="space-y-2 text-right">
                <Skeleton className="ml-auto h-4 w-24" />
                <Skeleton className="ml-auto h-4 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
