'use client';

import { useSyncExternalStore } from 'react';

/**
 * A ticking timestamp for render. Date.now() during render trips the React
 * compiler purity rule; subscribing through useSyncExternalStore is the
 * supported way to read a clock in a Client Component.
 *
 * getSnapshot must return a cached value between ticks. Returning Date.now()
 * directly changes every millisecond and React 19 loops ("Maximum update
 * depth exceeded") on any page that calls useNow.
 */

type NowStore = {
  value: number;
  listeners: Set<() => void>;
  timer: number | null;
};

const stores = new Map<number, NowStore>();

function storeFor(intervalMs: number): NowStore {
  let store = stores.get(intervalMs);
  if (!store) {
    store = { value: Date.now(), listeners: new Set(), timer: null };
    stores.set(intervalMs, store);
  }
  return store;
}

function subscribeToNow(intervalMs: number, onStoreChange: () => void) {
  const store = storeFor(intervalMs);
  store.listeners.add(onStoreChange);
  if (store.timer === null && typeof window !== 'undefined') {
    store.timer = window.setInterval(() => {
      store.value = Date.now();
      store.listeners.forEach((listener) => listener());
    }, intervalMs);
  }
  return () => {
    store.listeners.delete(onStoreChange);
    if (store.listeners.size === 0 && store.timer !== null) {
      window.clearInterval(store.timer);
      store.timer = null;
    }
  };
}

export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (onStoreChange) => subscribeToNow(intervalMs, onStoreChange),
    () => storeFor(intervalMs).value,
    () => 0,
  );
}
