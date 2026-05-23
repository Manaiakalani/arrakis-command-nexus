'use client';

import { useEffect, useRef, useState } from 'react';

type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

interface UseSSEOptions<T> {
  enabled?: boolean;
  maxMessages?: number;
  parse?: (raw: string) => T;
}

function defaultParser<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

export function useSSE<T = string>(endpoint: string, options: UseSSEOptions<T> = {}) {
  const { enabled = true, maxMessages = 250, parse } = options;
  const [messages, setMessages] = useState<T[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const reconnectRef = useRef<number>();
  const parseRef = useRef(parse ?? defaultParser<T>);

  useEffect(() => {
    parseRef.current = parse ?? defaultParser<T>;
  }, [parse]);

  useEffect(() => {
    if (!enabled) {
      setStatus('closed');
      return;
    }

    let source: EventSource | null = null;
    let mounted = true;

    const connect = () => {
      setStatus('connecting');
      source = new EventSource(endpoint);

      source.onopen = () => {
        if (mounted) {
          setStatus('open');
        }
      };

      const handleEvent = (event: MessageEvent) => {
        if (!mounted) {
          return;
        }

        const parsed = parseRef.current(event.data);
        setMessages((current) => {
          const next = [...current, parsed];
          return next.slice(-maxMessages);
        });
      };

      // Listen for both unnamed ("message") and named events ("log")
      source.onmessage = handleEvent;
      source.addEventListener('log', handleEvent);

      source.onerror = () => {
        if (!mounted) {
          return;
        }

        setStatus('error');
        source?.close();
        reconnectRef.current = window.setTimeout(connect, 2500);
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
      }
      source?.close();
      setStatus('closed');
    };
  }, [enabled, endpoint, maxMessages]);

  return { messages, status, setMessages };
}
