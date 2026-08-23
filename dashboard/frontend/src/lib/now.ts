'use client';

import { useSyncExternalStore } from 'react';

/**
 * A ticking timestamp for render. Date.now() during render trips the React
 * compiler purity rule; subscribing through useSyncExternalStore is the
 * supported way to read a clock in a Client Component.
 */
export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      const id = window.setInterval(onStoreChange, intervalMs);
      return () => window.clearInterval(id);
    },
    () => Date.now(),
    () => 0,
  );
}
