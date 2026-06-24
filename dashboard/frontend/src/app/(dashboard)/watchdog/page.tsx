import { Suspense } from 'react';

import { serverFetch } from '@/lib/server-api';
import type { MapStatus, WatchdogCrashEvent, WatchdogStatus } from '@/lib/types';

import WatchdogClient from './WatchdogClient';

async function WatchdogContent() {
  let status: WatchdogStatus = { enabled: false, autoRestart: true, intervalSeconds: 30, monitoredContainers: 0 };
  let crashes: WatchdogCrashEvent[] = [];
  let maps: MapStatus[] = [];

  try {
    [status, crashes, maps] = await Promise.all([
      serverFetch<WatchdogStatus>('/watchdog/status'),
      serverFetch<WatchdogCrashEvent[]>('/watchdog/crashes'),
      serverFetch<MapStatus[]>('/maps'),
    ]);
  } catch {
    // Fall through with defaults — client component handles errors via polling
  }

  return (
    <WatchdogClient
      initialStatus={status}
      initialCrashes={crashes}
      initialMaps={maps}
    />
  );
}

export default function WatchdogPage() {
  return (
    <Suspense>
      <WatchdogContent />
    </Suspense>
  );
}
