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
  const { enabled = true, maxMessages = 250, parse = defaultParser } = options;
  const [messages, setMessages] = useState<T[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const reconnectRef = useRef<number>();

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

      source.onmessage = (event) => {
        if (!mounted) {
          return;
        }

        const parsed = parse(event.data);
        setMessages((current) => {
          const next = [...current, parsed];
          return next.slice(-maxMessages);
        });
      };

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
  }, [enabled, endpoint, maxMessages, parse]);

  return { messages, status, setMessages };
}
