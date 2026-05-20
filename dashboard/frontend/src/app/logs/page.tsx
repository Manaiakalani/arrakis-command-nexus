'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

import { LogStream } from '@/components/LogStream';
import { apiClient } from '@/lib/api';

export default function LogsPage() {
  const [service, setService] = useState('all');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="section-title">Live telemetry</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-50">Service logs</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={service} onChange={(event) => setService(event.target.value)} className="dune-input min-w-[200px]">
            <option value="all">All services</option>
            <option value="gateway">Gateway</option>
            <option value="director">Director</option>
            <option value="discord">Discord</option>
            <option value="database">Database</option>
          </select>
          <a href="/api/logs/download" className="dune-button-muted">
            <Download className="mr-2 h-4 w-4" /> Download logs
          </a>
        </div>
      </div>
      <LogStream endpoint={apiClient.getLogStreamUrl()} selectedService={service} onServiceChange={setService} />
    </div>
  );
}
