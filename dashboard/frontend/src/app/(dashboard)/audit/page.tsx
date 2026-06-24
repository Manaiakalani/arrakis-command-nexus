import { Suspense } from 'react';

import { serverFetch } from '@/lib/server-api';

import AuditClient from './AuditClient';

interface AuditEntry {
  id: number;
  action: string;
  details: Record<string, unknown>;
  performed_by: string;
  created_at: string | null;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

interface AuditSummary {
  by_action: Record<string, number>;
}

async function AuditContent() {
  let entries: AuditEntry[] = [];
  let total = 0;
  let summary: Record<string, number> = {};

  try {
    const [auditData, summaryData] = await Promise.all([
      serverFetch<AuditResponse>('/audit?limit=25&offset=0'),
      serverFetch<AuditSummary>('/audit/summary'),
    ]);
    entries = auditData.entries ?? [];
    total = auditData.total ?? 0;
    summary = summaryData.by_action ?? {};
  } catch {
    // Fall through with empty data — client component handles the empty state
  }

  return (
    <AuditClient
      initialEntries={entries}
      initialTotal={total}
      initialSummary={summary}
    />
  );
}

export default function AuditPage() {
  return (
    <Suspense>
      <AuditContent />
    </Suspense>
  );
}
