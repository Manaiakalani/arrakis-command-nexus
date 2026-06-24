import { Suspense } from 'react';

import { serverFetch } from '@/lib/server-api';

import UpdatesClient from './UpdatesClient';

interface UpdateStatus {
  current_tag: string;
  current_build: string | null;
  latest_build: string | null;
  update_available: boolean;
  last_check: string | null;
  auto_update_enabled: boolean;
  check_interval_hours: number;
  steam_app_id: string;
}

async function UpdatesContent() {
  let initialStatus: UpdateStatus | null = null;

  try {
    initialStatus = await serverFetch<UpdateStatus>('/updates/status');
  } catch {
    // Fall through — client component handles loading from scratch
  }

  return <UpdatesClient initialStatus={initialStatus} />;
}

export default function UpdatesPage() {
  return (
    <Suspense>
      <UpdatesContent />
    </Suspense>
  );
}
