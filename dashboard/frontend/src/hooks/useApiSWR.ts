'use client';

import useSWR, { type KeyedMutator } from 'swr';

// ---------------------------------------------------------------------------
// useApiSWR — drop-in wrapper that maps the old useApi interface to SWR
// ---------------------------------------------------------------------------

interface UseApiSWROptions<T> {
  /** When false the request is skipped (conditional fetching). */
  enabled?: boolean;
  /** Override the global refreshInterval (ms). */
  refreshInterval?: number;
  /** Seed value shown while the first request is in flight. */
  initialData?: T;
}

interface UseApiSWRReturn<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  /** Trigger an immediate revalidation (same as calling mutate()). */
  refetch: () => Promise<T | undefined>;
  /** Full SWR mutate — use for optimistic updates (e.g. SSE patches). */
  mutate: KeyedMutator<T>;
  /** Update local cache without revalidation (mirrors old useApi.setData). */
  setData: (updater: T | ((prev: T | undefined) => T | undefined)) => void;
}

/**
 * Thin wrapper around `useSWR` that mirrors the return shape of the
 * legacy `useApi` hook so migrated call-sites require minimal changes.
 *
 * @param key   Stable string key for the SWR cache (use the API path).
 *              Pass `null` to skip the request (same as `enabled: false`).
 * @param fetcher  Async function that returns the data — typically a
 *                 lambda like `() => apiClient.getPlayers()`.
 * @param options  Optional overrides matching the old UseApiOptions shape.
 */
export function useApiSWR<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseApiSWROptions<T> = {},
): UseApiSWRReturn<T> {
  const { enabled = true, refreshInterval, initialData } = options;

  const effectiveKey = enabled ? key : null;

  const { data, error, isLoading, mutate } = useSWR<T, Error>(
    effectiveKey,
    // SWR passes the key as the first arg to the fetcher, but our
    // callers already close over the apiClient method — just call it.
    () => fetcher(),
    {
      refreshInterval,
      fallbackData: initialData,
    },
  );

  const refetch = async () => {
    const result = await mutate();
    return result;
  };

  const setData = (updater: T | ((prev: T | undefined) => T | undefined)) => {
    if (typeof updater === 'function') {
      void mutate((prev) => (updater as (prev: T | undefined) => T | undefined)(prev), { revalidate: false });
    } else {
      void mutate(updater, { revalidate: false });
    }
  };

  return {
    data,
    loading: isLoading,
    error: error ?? null,
    refetch,
    mutate,
    setData,
  };
}
