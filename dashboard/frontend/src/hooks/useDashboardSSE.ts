'use client';

import { useCallback, useRef } from 'react';

import { useSSE } from './useSSE';

import type { DashboardOverview } from '@/lib/types';

const SSE_EVENT_TYPES = [
  'connected',
  'status-update',
  'map-update',
  'metrics-update',
  'player-update',
] as const;

type SSEEventType = (typeof SSE_EVENT_TYPES)[number];

interface UseDashboardSSEOptions {
  /** Whether SSE should be active */
  enabled?: boolean;
  /** Called with a partial DashboardOverview to merge into state */
  onUpdate: (patch: Partial<DashboardOverview>) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Connects to the SSE proxy route (/api/events/stream) which injects
 * the admin token server-side. No client-side token needed.
 * Falls back silently — the parent component keeps SWR polling as baseline.
 */
export function useDashboardSSE(options: UseDashboardSSEOptions) {
  const { enabled = true, onUpdate } = options;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const handleEvent = useCallback(
    (event: { type: string; data: unknown }) => {
      const update = onUpdateRef.current;
      const eventType = event.type as SSEEventType;
      const data = event.data;

      switch (eventType) {
        case 'status-update':
          if (isRecord(data)) {
            update({ status: data as unknown as DashboardOverview['status'] });
          }
          break;
        case 'map-update':
          if (Array.isArray(data)) {
            update({ maps: data as unknown as DashboardOverview['maps'] });
          }
          break;
        case 'metrics-update':
          if (isRecord(data)) {
            update({ metrics: data as unknown as DashboardOverview['metrics'] });
          }
          break;
        case 'player-update':
          if (isRecord(data) && typeof data.playersOnline === 'number') {
            update({
              status: { playersOnline: data.playersOnline } as unknown as DashboardOverview['status'],
            });
          }
          break;
        case 'connected':
          break;
        default:
          break;
      }
    },
    [],
  );

  // Use the Next.js SSE proxy route — token is injected server-side
  const { status, retryCount } = useSSE('/api/events/stream', {
    enabled,
    eventTypes: [...SSE_EVENT_TYPES],
    onEvent: handleEvent,
  });

  return { sseStatus: status, sseRetryCount: retryCount };
}