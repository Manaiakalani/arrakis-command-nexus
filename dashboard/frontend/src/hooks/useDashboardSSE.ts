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
  /** Auth token for the SSE connection */
  token?: string;
  /** Called with a partial DashboardOverview to merge into state */
  onUpdate: (patch: Partial<DashboardOverview>) => void;
}

/**
 * Connects to the SSE stream and patches DashboardOverview state
 * as events arrive. Falls back silently — the parent component
 * keeps the useApi polling as a baseline.
 */
export function useDashboardSSE(options: UseDashboardSSEOptions) {
  const { enabled = true, token, onUpdate } = options;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const handleEvent = useCallback(
    (event: { type: string; data: unknown }) => {
      const update = onUpdateRef.current;
      const eventType = event.type as SSEEventType;
      const data = event.data;

      switch (eventType) {
        case 'status-update':
          update({ status: data as unknown as DashboardOverview['status'] });
          break;
        case 'map-update':
          update({ maps: data as unknown as DashboardOverview['maps'] });
          break;
        case 'metrics-update':
          update({ metrics: data as unknown as DashboardOverview['metrics'] });
          break;
        case 'player-update':
          // player-update only contains { playersOnline: number }
          // Merge it into the status sub-object
          update({
            status: { playersOnline: (data as unknown as { playersOnline: number }).playersOnline } as DashboardOverview['status'],
          });
          break;
        case 'connected':
          // No state update needed — just confirms connection
          break;
        default:
          break;
      }
    },
    [],
  );

  const apiBase =
    typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? '/api')
      : '/api';

  const { status, retryCount } = useSSE(`${apiBase}/events/stream`, {
    enabled: enabled && !!token,
    token,
    eventTypes: [...SSE_EVENT_TYPES],
    onEvent: handleEvent,
  });

  return { sseStatus: status, sseRetryCount: retryCount };
}