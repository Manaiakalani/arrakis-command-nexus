'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseApiOptions<T> {
  enabled?: boolean;
  refreshInterval?: number;
  initialData?: T;
  /** When any element changes, the fetcher is re-invoked immediately. */
  deps?: unknown[];
}

export function useApi<T>(fetcher: () => Promise<T>, options: UseApiOptions<T> = {}) {
  const { enabled = true, refreshInterval, initialData, deps } = options;
  const fetcherRef = useRef(fetcher);
  const enabledRef = useRef(enabled);
  const isMountedRef = useRef(true);
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const hasData = useRef(initialData !== undefined);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const run = useCallback(async (rethrow = true) => {
    if (!enabledRef.current) {
      return undefined;
    }

    try {
      if (!hasData.current && isMountedRef.current) {
        setLoading(true);
      }

      const next = await fetcherRef.current();
      if (!isMountedRef.current) {
        return next;
      }

      setData(next);
      hasData.current = true;
      setError(null);
      return next;
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error('Unknown request error');
      if (isMountedRef.current) {
        setError(nextError);
      }
      if (rethrow) throw nextError;
      return undefined;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...(deps ?? [])]);

  useEffect(() => {
    if (!enabled || !refreshInterval) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void run(false);
    }, refreshInterval);

    return () => window.clearInterval(intervalId);
  }, [enabled, refreshInterval, run]);

  return {
    data,
    loading,
    error,
    setData,
    refetch: run,
  };
}
