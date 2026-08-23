'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UsePollingOptions {
  enabled?: boolean;
  immediate?: boolean;
}

export function usePolling(callback: () => void | Promise<void>, interval = 5000, options: UsePollingOptions = {}) {
  const { enabled = true, immediate = true } = options;
  const callbackRef = useRef(callback);
  const [forcedPause, setForcedPause] = useState(false);
  const isPaused = !enabled || forcedPause;

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

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

  const pause = useCallback(() => setForcedPause(true), []);
  const resume = useCallback(() => setForcedPause(false), []);

  return { isPaused, pause, resume };
}
