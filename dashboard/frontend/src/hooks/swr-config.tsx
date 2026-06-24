'use client';

import { type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import type { SWRConfiguration } from 'swr';

import { apiClient } from '@/lib/api';

/**
 * Default fetcher for SWR — delegates to the ApiClient generic GET.
 * SWR keys that are API paths (e.g. "/overview") will be fetched
 * through this automatically unless a per-hook fetcher overrides it.
 */
export const swrFetcher = <T,>(path: string): Promise<T> => {
  return apiClient.get<T>(path);
};

/**
 * App-wide SWR defaults.
 *
 * - refreshInterval  30 s  (SSE handles real-time; polling is the fallback)
 * - revalidateOnFocus  true  (replaces our custom visibilitychange code)
 * - dedupingInterval  10 s  (replaces the manual dedup Map in useApi)
 */
export const swrDefaults: SWRConfiguration = {
  fetcher: swrFetcher,
  refreshInterval: 30_000,
  revalidateOnFocus: true,
  dedupingInterval: 10_000,
  revalidateOnReconnect: true,
  errorRetryCount: 3,
};

export function SWRProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={swrDefaults}>{children}</SWRConfig>;
}
