'use client';

import { Power } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useToast } from '@/components/ToastProvider';
import { apiClient } from '@/lib/api';

const WARNING_OPTIONS = [0, 1, 2, 5, 10, 15] as const;

export function ShutdownPanel() {
  const { toast } = useToast();
  const [warningMinutes, setWarningMinutes] = useState<number>(5);
  const [skipBackup, setSkipBackup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<string>('idle');
  const [details, setDetails] = useState<Array<{ ts: string; msg: string }>>([]);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await apiClient.getShutdownStatus();
        if (cancelled) return;
        setPhase(status.phase);
        setDetails(status.details ?? []);
        if (status.phase === 'ready_for_host_shutdown' || status.phase === 'error' || status.phase === 'idle') {
          setPolling(false);
        }
      } catch {
        // ignore transient
      }
    };
    void tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [polling]);

  async function handleSubmit() {
    if (submitting) return;
    const message =
      warningMinutes === 0
        ? 'Trigger IMMEDIATE shutdown? Players will be disconnected NOW.'
        : `Begin shutdown sequence with ${warningMinutes} minute warning?`;
    if (!window.confirm(message)) return;
    setSubmitting(true);
    try {
      await apiClient.prepareShutdown({
        warning_minutes: warningMinutes,
        skip_backup: skipBackup,
        stop_game_servers: true,
      });
      showToastSuccess('Shutdown started: phase 1 running. Watch progress below.');
      setPolling(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      showToastError(`Failed to start shutdown: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  function showToastSuccess(msg: string) {
    toast(msg, 'success');
  }
  function showToastError(msg: string) {
    toast(msg, 'error');
  }

  const isRunning = polling || (phase !== 'idle' && phase !== 'ready_for_host_shutdown' && phase !== 'error');

  return (
    <section className="glass-panel p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Power className="h-5 w-5 text-rose-400 mt-0.5" aria-hidden />
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-th-text">Graceful Host Shutdown</h3>
          <p className="text-sm text-th-text/70">
            Phase 1 (this button): in-game warnings → final backup → stop game + infra containers. Phase 2 (operator
            on the host): run <code className="px-1 rounded bg-th-surface/60">./dune shutdown-host --confirm</code> to
            stop the dashboard and power the machine off. Use this when you need to physically move the device.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="block mb-1 text-th-text/80">Warning before shutdown</span>
          <select
            value={warningMinutes}
            onChange={(e) => setWarningMinutes(Number(e.target.value))}
            disabled={isRunning}
            className="dune-input w-full"
            aria-label="Warning minutes"
          >
            {WARNING_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Immediate (no warning)' : `${m} minute${m === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm self-end">
          <input
            type="checkbox"
            checked={skipBackup}
            onChange={(e) => setSkipBackup(e.target.checked)}
            disabled={isRunning}
            className="h-4 w-4"
          />
          <span>Skip final backup (faster, riskier)</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || isRunning}
          className="dune-button bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 disabled:opacity-50"
        >
          {submitting ? 'Starting...' : isRunning ? 'In progress...' : 'Begin shutdown sequence'}
        </button>
        <span className="text-sm text-th-text/70">
          Current phase: <code className="px-1 rounded bg-th-surface/60">{phase}</code>
        </span>
      </div>

      {phase === 'ready_for_host_shutdown' && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="font-semibold">Phase 1 complete.</p>
          <p>
            Now SSH to the host and run:{' '}
            <code className="px-1 rounded bg-th-surface/60">./dune shutdown-host --warning 0 --confirm</code> to power
            the machine off, or <code className="px-1 rounded bg-th-surface/60">./dune shutdown-host --no-poweroff</code>{' '}
            to leave the host running.
          </p>
        </div>
      )}

      {details.length > 0 && (
        <details className="rounded-lg bg-th-surface/40 p-3 text-sm" open>
          <summary className="cursor-pointer font-medium">Progress log ({details.length})</summary>
          <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
            {details.map((d, i) => (
              <li key={i} className="text-th-text/80">
                <span className="text-th-text/50">{new Date(d.ts).toLocaleTimeString()}</span> — {d.msg}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
