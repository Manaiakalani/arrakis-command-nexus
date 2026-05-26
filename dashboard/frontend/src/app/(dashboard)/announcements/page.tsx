'use client';

import { CalendarClock, Megaphone, Repeat, RotateCcw, Sparkles, Trash2, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Skeleton, TableSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

const preRestartOptions = [1, 2, 5, 10, 15] as const;

function formatDateTime(value?: string | null, fallback = 'Not scheduled') {
  return value ? new Date(value).toLocaleString() : fallback;
}

function getDefaultRunAt() {
  const date = new Date(Date.now() + 5 * 60 * 1000);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function previewMessage(message: string, maxLength = 72) {
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}

export default function AnnouncementsPage() {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [sender, setSender] = useState('Server');
  const [minutes, setMinutes] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [scheduledMessage, setScheduledMessage] = useState('');
  const [scheduledSender, setScheduledSender] = useState('Server');
  const [scheduleType, setScheduleType] = useState<'recurring' | 'one-shot'>('recurring');
  const [intervalMinutes, setIntervalMinutes] = useState<number>(30);
  const [runAt, setRunAt] = useState(getDefaultRunAt());
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const history = useApi(() => apiClient.getAnnouncementHistory(), { refreshInterval: 15000, initialData: [] });
  const scheduled = useApi(() => apiClient.getScheduledAnnouncements(), { refreshInterval: 15000, initialData: [] });

  const [wisdomInterval, setWisdomInterval] = useState(45);
  const [wisdomSender, setWisdomSender] = useState("Muad'Dib");
  const [wisdomBusy, setWisdomBusy] = useState(false);

  const canSend = useMemo(() => message.trim().length > 0 && !busy, [busy, message]);
  const canSchedule = useMemo(() => {
    if (!scheduledMessage.trim() || scheduling) {
      return false;
    }
    return scheduleType === 'recurring' ? intervalMinutes > 0 : runAt.trim().length > 0;
  }, [intervalMinutes, runAt, scheduleType, scheduledMessage, scheduling]);

  const refreshHistory = async () => {
    await history.refetch();
  };

  const refreshScheduled = async () => {
    await scheduled.refetch();
  };

  const handleSetupWisdom = async () => {
    setWisdomBusy(true);
    try {
      const result = await apiClient.setupWisdomScheduler({
        interval_minutes: wisdomInterval,
        sender: wisdomSender.trim() || "Muad'Dib",
        enabled: true,
      });
      toast(result.success ? 'Words of Wisdom scheduler activated!' : 'Failed to set up wisdom', result.success ? 'success' : 'error');
      await refreshScheduled();
    } catch (error) {
      toast(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setWisdomBusy(false);
    }
  };

  const handleSendWisdom = async () => {
    setWisdomBusy(true);
    try {
      const result = await apiClient.sendRandomWisdom();
      toast(result.success ? `Wisdom sent: "${result.quote.slice(0, 60)}..."` : 'Failed to send', result.success ? 'success' : 'error');
      await refreshHistory();
    } catch (error) {
      toast(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setWisdomBusy(false);
    }
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
      toast(response.message, response.success ? 'success' : 'error');
      if (response.success) {
        setMessage('');
      }
      await refreshHistory();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send announcement';
      setFeedback({ type: 'error', text: errorMessage });
      toast(`Failed to send announcement: ${errorMessage}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePreRestart = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await apiClient.sendPreRestartWarning(minutes);
      const feedbackMessage = response.success ? 'Pre-restart warning sent.' : 'Failed to send pre-restart warning.';
      setFeedback({ type: response.success ? 'success' : 'error', text: feedbackMessage });
      toast(feedbackMessage, response.success ? 'success' : 'error');
      await refreshHistory();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send pre-restart warning';
      setFeedback({ type: 'error', text: errorMessage });
      toast(`Failed to send pre-restart warning: ${errorMessage}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateScheduled = async () => {
    if (!scheduledMessage.trim()) {
      return;
    }

    const payload = scheduleType === 'recurring'
      ? {
          message: scheduledMessage.trim(),
          sender: scheduledSender.trim() || undefined,
          interval_minutes: Math.max(1, intervalMinutes),
          enabled: scheduleEnabled,
        }
      : {
          message: scheduledMessage.trim(),
          sender: scheduledSender.trim() || undefined,
          run_at: new Date(runAt).toISOString(),
          enabled: scheduleEnabled,
        };

    setScheduling(true);
    try {
      await apiClient.createScheduledAnnouncement(payload);
      setScheduledMessage('');
      setScheduledSender('Server');
      setIntervalMinutes(30);
      setRunAt(getDefaultRunAt());
      setScheduleEnabled(true);
      toast('Scheduled announcement created.', 'success');
      await refreshScheduled();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create scheduled announcement';
      toast(`Failed to create scheduled announcement: ${errorMessage}`, 'error');
    } finally {
      setScheduling(false);
    }
  };

  const handleToggleScheduled = async (announcementId: string) => {
    setRowBusyId(announcementId);
    try {
      await apiClient.toggleScheduledAnnouncement(announcementId);
      toast('Scheduled announcement updated.', 'success');
      await refreshScheduled();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update scheduled announcement';
      toast(`Failed to update scheduled announcement: ${errorMessage}`, 'error');
    } finally {
      setRowBusyId(null);
    }
  };

  const handleDeleteScheduled = async (announcementId: string) => {
    if (!window.confirm('Delete this scheduled announcement?')) {
      return;
    }

    setRowBusyId(announcementId);
    try {
      await apiClient.deleteScheduledAnnouncement(announcementId);
      toast('Scheduled announcement deleted.', 'success');
      await refreshScheduled();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete scheduled announcement';
      toast(`Failed to delete scheduled announcement: ${errorMessage}`, 'error');
    } finally {
      setRowBusyId(null);
    }
  };

  if (history.loading || scheduled.loading) {
    return <AnnouncementsPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="glass-panel p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-th-surface-s p-3 text-th-text">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <p className="section-title">Broadcast Console</p>
            <h1 className="mt-1 text-2xl font-semibold text-th-text">In-Game Announcements</h1>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-th-text">Message</span>
            <input
              className="dune-input"
              name="announcement-message"
              autoComplete="off"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Attention, sleepers. Maintenance begins at sunset&#x2026;"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-th-text">Sender</span>
            <input className="dune-input" name="announcement-sender" autoComplete="off" value={sender} onChange={(event) => setSender(event.target.value)} placeholder="Server" />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="dune-button" onClick={() => void handleSend()} disabled={!canSend}>
            <Megaphone className="mr-2 h-4 w-4" /> Send announcement
          </button>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-th-border-m bg-th-bg/50 px-3 py-3">
            <select className="dune-input min-w-[120px]" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} aria-label="Pre-restart warning minutes">
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
          <div className="mt-4 rounded-2xl border border-th-border bg-th-surface-s/80 px-4 py-3 text-sm text-th-text">
            {feedback.text}
          </div>
        ) : null}
      </div>

      {/* Words of Wisdom */}
      <div className="glass-panel p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="section-title">Words of Wisdom</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Muad&apos;Dib&apos;s Wisdom Bot</h2>
            <p className="mt-1 text-sm text-th-text-m">Dune-themed wisdom mixed with gen-z energy, broadcast throughout the day.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-th-text">Announcer name</span>
            <input
              className="dune-input"
              value={wisdomSender}
              onChange={(e) => setWisdomSender(e.target.value)}
              placeholder="Muad'Dib"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-th-text">Interval (minutes)</span>
            <input
              className="dune-input"
              type="number"
              min={1}
              value={wisdomInterval}
              onChange={(e) => setWisdomInterval(Math.max(1, Number(e.target.value) || 45))}
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="dune-button"
              onClick={() => void handleSetupWisdom()}
              disabled={wisdomBusy}
            >
              <CalendarClock className="mr-2 h-4 w-4" /> Start scheduler
            </button>
            <button
              type="button"
              className="dune-button-muted"
              onClick={() => void handleSendWisdom()}
              disabled={wisdomBusy}
            >
              <Zap className="mr-2 h-4 w-4" /> Send one now
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-th-border-m/80 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="section-title">Scheduled</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Scheduled announcements</h2>
            <p className="mt-2 text-sm text-th-text-m">Create one-time or recurring in-game announcements for maintenance windows, events, and reminders.</p>
          </div>
          <button type="button" className="dune-button-muted" onClick={() => void refreshScheduled()} disabled={scheduled.loading}>
            Refresh
          </button>
        </div>

        <div className="border-b border-th-border-m/80 p-5">
          <div className="grid gap-4 xl:grid-cols-[2fr_1fr_220px]">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-th-text">Message</span>
              <textarea
                className="dune-input min-h-28 resize-y"
                name="scheduled-announcement-message"
                value={scheduledMessage}
                onChange={(event) => setScheduledMessage(event.target.value)}
                placeholder="A coriolis storm warning will be repeated every 30 minutes."
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-th-text">Sender</span>
              <input
                className="dune-input"
                name="scheduled-announcement-sender"
                autoComplete="off"
                value={scheduledSender}
                onChange={(event) => setScheduledSender(event.target.value)}
                placeholder="Server"
              />
            </label>
            <div className="space-y-4 rounded-2xl border border-th-border bg-th-surface-s/60 p-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-th-text">Schedule type</span>
                <select className="dune-input" value={scheduleType} onChange={(event) => setScheduleType(event.target.value as 'recurring' | 'one-shot')}>
                  <option value="recurring">Recurring</option>
                  <option value="one-shot">One-time</option>
                </select>
              </label>
              {scheduleType === 'recurring' ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-th-text">Interval (minutes)</span>
                  <input className="dune-input" min={1} type="number" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Math.max(1, Number(event.target.value) || 1))} />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-th-text">Run at</span>
                  <input className="dune-input" type="datetime-local" value={runAt} onChange={(event) => setRunAt(event.target.value)} />
                </label>
              )}
              <label className="flex items-center gap-3 rounded-2xl border border-th-border bg-th-bg/50 px-4 py-3 text-sm text-th-text">
                <input checked={scheduleEnabled} className="h-4 w-4 rounded border-th-border bg-th-surface text-th-text" type="checkbox" onChange={(event) => setScheduleEnabled(event.target.checked)} />
                Enable immediately
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" className="dune-button" onClick={() => void handleCreateScheduled()} disabled={!canSchedule}>
              <CalendarClock className="mr-2 h-4 w-4" /> Create scheduled announcement
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-th-border-m/80 text-left text-sm">
            <thead className="bg-th-bg/40 text-th-text-m">
              <tr>
                <th className="px-5 py-3 font-medium">Message</th>
                <th className="px-5 py-3 font-medium">Schedule</th>
                <th className="px-5 py-3 font-medium">Next run</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-th-border-m/80">
              {(scheduled.data ?? []).map((entry) => {
                const isBusy = rowBusyId === entry.id;
                return (
                  <tr key={entry.id} className="align-top text-th-text-s">
                    <td className="px-5 py-4">
                      <div className="max-w-2xl space-y-1">
                        <p className="text-th-text">{previewMessage(entry.message)}</p>
                        <p className="text-xs text-th-text-m">From {entry.sender}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-2 text-th-text-m">
                        {entry.one_shot ? <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" /> : <Repeat className="mt-0.5 h-4 w-4 shrink-0" />}
                        <span>{entry.one_shot ? 'One-time delivery' : `Every ${entry.interval_minutes ?? 0} minute${entry.interval_minutes === 1 ? '' : 's'}`}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-th-text-m">{formatDateTime(entry.next_run_at, entry.one_shot && !entry.enabled ? 'Completed' : 'Not scheduled')}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full border border-th-border bg-th-surface-s px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-th-text">
                        {entry.enabled ? 'Enabled' : entry.one_shot && !entry.next_run_at ? 'Completed' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" className={entry.enabled ? 'dune-button-muted px-3 py-2 text-xs' : 'dune-button px-3 py-2 text-xs'} onClick={() => void handleToggleScheduled(entry.id)} disabled={isBusy}>
                          {entry.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" className="dune-button-muted px-3 py-2 text-xs" onClick={() => void handleDeleteScheduled(entry.id)} disabled={isBusy}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!scheduled.loading && (scheduled.data ?? []).length === 0 ? <div className="p-10 text-center text-th-text-m">No scheduled announcements configured.</div> : null}
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-th-border-m/80 p-5">
          <div>
            <p className="section-title">Recent activity</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Announcement History</h2>
          </div>
          <button type="button" className="dune-button-muted" onClick={() => void refreshHistory()} disabled={history.loading}>
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-th-border-m/80 text-left text-sm">
            <thead className="bg-th-bg/40 text-th-text-m">
              <tr>
                <th className="px-5 py-3 font-medium">Message</th>
                <th className="px-5 py-3 font-medium">Sender</th>
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-th-border-m/80">
              {(history.data ?? []).map((entry, index) => (
                <tr key={`${entry.timestamp}-${index}`} className="align-top text-th-text-s">
                  <td className="px-5 py-4">
                    <div className="max-w-2xl">
                      <p className="text-th-text">{entry.message}</p>
                      {entry.error ? <p className="mt-1 text-xs text-th-text-m">{entry.error}</p> : null}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-th-text-s">{entry.sender}</td>
                  <td className="px-5 py-4 text-th-text-m">{formatDateTime(entry.timestamp, 'Unknown')}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex rounded-full border border-th-border bg-th-surface-s px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-th-text">
                      {entry.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!history.loading && (history.data ?? []).length === 0 ? <div className="p-10 text-center text-th-text-m">No announcements have been sent yet.</div> : null}
      </div>
    </div>
  );
}

function AnnouncementsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="glass-panel space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-64" />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-11 w-44 rounded-xl" />
          <Skeleton className="h-16 w-72 rounded-2xl" />
        </div>
      </div>
      <div className="glass-panel space-y-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-56" />
          </div>
          <Skeleton className="h-11 w-24 rounded-xl" />
        </div>
        <div className="grid gap-4 xl:grid-cols-[2fr_1fr_220px]">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-52 w-full rounded-2xl" />
        </div>
      </div>
      <TableSkeleton rows={5} />
      <TableSkeleton rows={5} />
    </div>
  );
}
