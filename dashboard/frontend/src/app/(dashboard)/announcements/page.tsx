'use client';

import { Megaphone, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

const preRestartOptions = [1, 2, 5, 10, 15] as const;

export default function AnnouncementsPage() {
  const [message, setMessage] = useState('');
  const [sender, setSender] = useState('Server');
  const [minutes, setMinutes] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const history = useApi(() => apiClient.getAnnouncementHistory(), { refreshInterval: 15000, initialData: [] });

  const canSend = useMemo(() => message.trim().length > 0 && !busy, [busy, message]);

  const refreshHistory = async () => {
    await history.refetch();
  };

  const handleSend = async () => {
    if (!message.trim()) {
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const response = await apiClient.sendGameAnnouncement(message.trim(), sender.trim() || undefined);
      setFeedback({ type: response.success ? 'success' : 'error', text: response.message });
      if (response.success) {
        setMessage('');
      }
      await refreshHistory();
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to send announcement' });
    } finally {
      setBusy(false);
    }
  };

  const handlePreRestart = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await apiClient.sendPreRestartWarning(minutes);
      setFeedback({ type: response.success ? 'success' : 'error', text: response.success ? 'Pre-restart warning sent.' : 'Failed to send pre-restart warning.' });
      await refreshHistory();
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to send pre-restart warning' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-panel p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <p className="section-title">Broadcast console</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-50">In-game announcements</h1>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-100">Message</span>
            <input
              className="dune-input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Attention, sleepers. Maintenance begins at sunset..."
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-100">Sender</span>
            <input className="dune-input" value={sender} onChange={(event) => setSender(event.target.value)} placeholder="Server" />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="dune-button" onClick={() => void handleSend()} disabled={!canSend}>
            <Megaphone className="mr-2 h-4 w-4" /> Send announcement
          </button>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-3">
            <select className="dune-input min-w-[120px]" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
              {preRestartOptions.map((option) => (
                <option key={option} value={option}>
                  {option} minute{option === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            <button type="button" className="dune-button-muted" onClick={() => void handlePreRestart()} disabled={busy}>
              <RotateCcw className="mr-2 h-4 w-4" /> Pre-restart warning
            </button>
          </div>
        </div>

        {feedback ? (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
            {feedback.text}
          </div>
        ) : null}
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800/80 p-5">
          <div>
            <p className="section-title">Recent activity</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-50">Announcement history</h2>
          </div>
          <button type="button" className="dune-button-muted" onClick={() => void refreshHistory()} disabled={history.loading}>
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800/80 text-left text-sm">
            <thead className="bg-slate-950/40 text-slate-400">
              <tr>
                <th className="px-5 py-3 font-medium">Message</th>
                <th className="px-5 py-3 font-medium">Sender</th>
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {(history.data ?? []).map((entry, index) => (
                <tr key={`${entry.timestamp}-${index}`} className="align-top text-slate-300">
                  <td className="px-5 py-4">
                    <div className="max-w-2xl">
                      <p>{entry.message}</p>
                      {entry.error ? <p className="mt-1 text-xs text-red-300">{entry.error}</p> : null}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-200">{entry.sender}</td>
                  <td className="px-5 py-4 text-slate-400">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${entry.status === 'sent' ? 'bg-emerald-500/15 text-emerald-200' : entry.status === 'failed' ? 'bg-red-500/15 text-red-200' : 'bg-amber-500/15 text-amber-200'}`}
                    >
                      {entry.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!history.loading && (history.data ?? []).length === 0 ? <div className="p-10 text-center text-slate-400">No announcements have been sent yet.</div> : null}
      </div>
    </div>
  );
}
