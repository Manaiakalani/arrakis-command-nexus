import { Suspense } from 'react';

import { serverFetch } from '@/lib/server-api';

import SettingsClient from './SettingsClient';

type SettingsData = Record<string, Record<string, unknown>>;

interface AdminEntry {
  id: number;
  username: string;
  role: string;
  enabled: boolean;
  createdAt: string | null;
  lastLogin: string | null;
}

async function SettingsContent() {
  let settings: SettingsData = {};
  let admins: AdminEntry[] = [];

  try {
    [settings, admins] = await Promise.all([
      serverFetch<SettingsData>('/settings'),
      serverFetch<AdminEntry[]>('/settings/admins'),
    ]);
  } catch {
    // Fall through — client component handles loading from scratch
  }

  return (
    <SettingsClient
      initialSettings={settings}
      initialAdmins={admins}
    />
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
