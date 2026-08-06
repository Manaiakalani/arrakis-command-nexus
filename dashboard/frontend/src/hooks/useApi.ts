'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Module-level request deduplication cache
// ---------------------------------------------------------------------------
interface InflightEntry {
  promise: Promise<unknown>;
  subscribers: number;
}

const inflight = new Map<string, InflightEntry>();

function dedupedFetch<T>(key: string, fn: () => Promise<T>, force = false): Promise<T> {
  const existing = inflight.get(key);
  if (existing && !force) {
    existing.subscribers++;
    return existing.promise as Promise<T>;
  }

  const promise = fn().finally(() => {
    // Only delete if this is still the active entry (force may have replaced it)
    const current = inflight.get(key);
    if (current && current.promise === promise) {
      inflight.delete(key);
    }
  });

  inflight.set(key, { promise, subscribers: 1 });
  return promise;
}

// ---------------------------------------------------------------------------
// Focus-awareness helpers
// ---------------------------------------------------------------------------
type VisibilityCallback = () => void;
const visibilityListeners = new Set<VisibilityCallback>();
let visibilityListenerAttached = false;

function ensureVisibilityListener() {
  if (visibilityListenerAttached || typeof document === 'undefined') return;
  visibilityListenerAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      visibilityListeners.forEach((cb) => cb());
    }
  });
}

function subscribeVisibility(cb: VisibilityCallback): () => void {
  ensureVisibilityListener();
  visibilityListeners.add(cb);
  return () => {
    visibilityListeners.delete(cb);
  };
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
interface UseApiOptions<T> {
  enabled?: boolean;
  refreshInterval?: number;
  initialData?: T;
  /** When any element changes, the fetcher is re-invoked immediately. */
  deps?: unknown[];
  /** Custom deduplication key. Defaults to fetcher.toString(). */
  dedupKey?: string;
}

/**
 * @deprecated Migrate to {@link useApiSWR} from './useApiSWR' or use
 * `useSWR` directly.  SWR provides built-in deduplication, focus-aware
 * polling, and key-based caching — all of which this hook reimplements
 * manually.  This file is kept as a fallback while remaining pages are
 * migrated.
 */
export function useApi<T>(fetcher: () => Promise<T>, options: UseApiOptions<T> = {}) {
  const { enabled = true, refreshInterval, initialData, deps, dedupKey } = options;
  const fetcherRef = useRef(fetcher);
  const enabledRef = useRef(enabled);
  const isMountedRef = useRef(true);
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const hasData = useRef(initialData !== undefined);

  // Stable dedup key — falls back to fetcher source text and deps.
  const stringifiedDeps = deps ? JSON.stringify(deps) : '';
  const keyRef = useRef(dedupKey ?? `${fetcher.toString()}_${stringifiedDeps}`);
  useEffect(() => {
    keyRef.current = dedupKey ?? `${fetcher.toString()}_${stringifiedDeps}`;
  }, [dedupKey, fetcher, stringifiedDeps]);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (rethrow = true, force = false) => {
    if (!enabledRef.current) {
      return undefined;
    }

    try {
      if (!hasData.current && isMountedRef.current) {
        setLoading(true);
      }

      const next = await dedupedFetch(keyRef.current, () => fetcherRef.current(), force);
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

  // Initial fetch + dep-driven refetch
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...(deps ?? [])]);

  // Polling: pause while tab hidden, resume + immediate refetch on focus
  useEffect(() => {
    if (!enabled || !refreshInterval) {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        void run(false);
      }, refreshInterval);
    };

    const stopPolling = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    // Only start polling if tab is currently visible
    if (!isDocumentHidden()) {
      startPolling();
    }

    // Handle tab visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        void run(false); // refetch immediately on focus
        startPolling();
      }
    };

    const hasDocument = typeof document !== 'undefined';
    if (hasDocument) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      stopPolling();
      if (hasDocument) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, refreshInterval, run]);

  // Refetch on tab re-focus even without polling
  useEffect(() => {
    if (!enabled || refreshInterval) return;
    return subscribeVisibility(() => {
      void run(false);
    });
  }, [enabled, run, refreshInterval]);

  const forceRefetch = useCallback(() => run(true, true), [run]);

  return {
    data,
    loading,
    error,
    setData,
    refetch: run,
    /** Refetch bypassing deduplication. Use after mutations to ensure fresh data. */
    forceRefetch,
  };
}
