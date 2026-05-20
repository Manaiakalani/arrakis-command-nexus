'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseApiOptions<T> {
  enabled?: boolean;
  refreshInterval?: number;
  initialData?: T;
}

export function useApi<T>(fetcher: () => Promise<T>, options: UseApiOptions<T> = {}) {
  const { enabled = true, refreshInterval, initialData } = options;
  const fetcherRef = useRef(fetcher);
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const run = useCallback(async () => {
    if (!enabled) {
      return undefined;
    }

    try {
      setLoading(true);
      const next = await fetcherRef.current();
      setData(next);
      setError(null);
      return next;
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error('Unknown request error');
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void run();
  }, [enabled, run]);

  useEffect(() => {
    if (!enabled || !refreshInterval) {
      return;
    }

    const id = window.setInterval(() => {
      void run();
    }, refreshInterval);

    return () => window.clearInterval(id);
  }, [enabled, refreshInterval, run]);

  return {
    data,
    loading,
    error,
    setData,
    refetch: run,
  };
}
