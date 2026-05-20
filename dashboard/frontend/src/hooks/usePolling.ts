'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UsePollingOptions {
  enabled?: boolean;
  immediate?: boolean;
}

export function usePolling(callback: () => void | Promise<void>, interval = 5000, options: UsePollingOptions = {}) {
  const { enabled = true, immediate = true } = options;
  const callbackRef = useRef(callback);
  const [isPaused, setIsPaused] = useState(!enabled);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    setIsPaused(!enabled);
  }, [enabled]);

  useEffect(() => {
    if (isPaused) {
      return;
    }

    if (immediate) {
      void callbackRef.current();
    }

    const id = window.setInterval(() => {
      void callbackRef.current();
    }, interval);

    return () => window.clearInterval(id);
  }, [immediate, interval, isPaused]);

  const pause = useCallback(() => setIsPaused(true), []);
  const resume = useCallback(() => setIsPaused(false), []);

  return { isPaused, pause, resume };
}
