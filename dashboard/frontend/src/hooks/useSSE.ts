'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

interface SSEEvent<T = unknown> {
  type: string;
  data: T;
}

interface UseSSEOptions {
  enabled?: boolean;
  /** Auth token appended as ?token= query param */
  token?: string;
  /** Event types to listen for (in addition to generic 'message') */
  eventTypes?: string[];
  /** Called for every incoming typed event */
  onEvent?: (event: SSEEvent) => void;
  /** Max reconnect attempts before falling back (0 = unlimited) */
  maxRetries?: number;
}

const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
const JITTER_FACTOR = 0.3;

function backoffMs(attempt: number): number {
  const base = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(500, base + jitter);
}

export function useSSE(endpoint: string, options: UseSSEOptions = {}) {
  const {
    enabled = true,
    token,
    eventTypes = [],
    onEvent,
    maxRetries = 0,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('closed');
  const [retryCount, setRetryCount] = useState(0);
  const reconnectRef = useRef<number | undefined>(undefined);
  const onEventRef = useRef(onEvent);
  const attemptRef = useRef(0);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) {
      setStatus('closed');
      return;
    }

    let source: EventSource | null = null;
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      setStatus('connecting');

      const url = token ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : endpoint;
      source = new EventSource(url);

      source.onopen = () => {
        if (!mounted) return;
        setStatus('open');
        attemptRef.current = 0;
        setRetryCount(0);
      };

      const handleEvent = (event: MessageEvent) => {
        if (!mounted || !onEventRef.current) return;
        try {
          const data = JSON.parse(event.data);
          onEventRef.current({ type: event.type, data });
        } catch {
          onEventRef.current({ type: event.type, data: event.data });
        }
      };

      // Listen for generic messages
      source.onmessage = handleEvent;

      // Listen for each typed event
      for (const eventType of eventTypes) {
        source.addEventListener(eventType, handleEvent as EventListener);
      }

      source.onerror = () => {
        if (!mounted) return;

        source?.close();
        setStatus('error');

        if (maxRetries > 0 && attemptRef.current >= maxRetries) {
          setStatus('closed');
          return;
        }

        const delay = backoffMs(attemptRef.current);
        attemptRef.current += 1;
        setRetryCount(attemptRef.current);

        reconnectRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectRef.current !== undefined) {
        window.clearTimeout(reconnectRef.current);
      }
      source?.close();
      setStatus('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, endpoint, token, maxRetries, JSON.stringify(eventTypes)]);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    setRetryCount(0);
  }, []);

  return { status, retryCount, reconnect };
}
