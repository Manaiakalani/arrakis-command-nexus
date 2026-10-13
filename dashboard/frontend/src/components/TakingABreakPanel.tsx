'use client';

import { Moon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ToastProvider';
import { apiClient } from '@/lib/api';

const WARNING_OPTIONS = [0, 1, 2, 5, 10, 15] as const;

type BreakStatus = {
  helper_installed: boolean;
  phase: string;
  details?: Array<{ ts: string; msg: string }>;
  error?: string | null;
};

export function TakingABreakPanel() {
  const { toast } = useToast();
  const [warningMinutes, setWarningMinutes] = useState<number>(5);
  const [helperInstalled, setHelperInstalled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState('idle');
  const [details, setDetails] = useState<Array<{ ts: string; msg: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState(false);
  const [poweredOff, setPoweredOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiClient.getTakingABreak().then((status) => {
      if (cancelled) return;
      setHelperInstalled(status.helper_installed);
      if (status.phase && status.phase !== 'idle') {
        setPhase(status.phase);
        setDetails(status.details ?? []);
        setError(status.error ?? null);
        if (status.phase !== 'error' && status.phase !== 'powering_off') {
          setPolling(true);
        }
        if (status.phase === 'powering_off') setPoweredOff(true);
      }
    }).catch(() => {
      if (!cancelled) setHelperInstalled(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status: BreakStatus = await apiClient.getTakingABreak();
        if (cancelled) return;
        setPhase(status.phase);
        setDetails(status.details ?? []);
        setError(status.error ?? null);
        if (status.phase === 'powering_off') {
          setPoweredOff(true);
          setPolling(false);
        } else if (status.phase === 'error' || status.phase === 'idle') {
          setPolling(false);
        }
      } catch {
        if (!cancelled && poweredOff) setPolling(false);
      }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [polling, poweredOff]);

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setPoweredOff(false);
    setError(null);
    try {
      await apiClient.startTakingABreak(warningMinutes);
      toast('Taking a break started. This page stays up until the host powers off.', 'success');
      setPolling(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast(`Could not start taking a break: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const isRunning = polling || (phase !== 'idle' && phase !== 'error' && phase !== 'powering_off');
  const unavailable = helperInstalled === false;

  return (
    <section className="glass-panel p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-th-text">
            <Moon aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            Taking a break
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-th-text-m">
            Warns anyone online, saves the world on this machine, copies that save offsite, then powers the host off.
            Fuel and storms stay frozen while it is off. Turning the power button on later starts the same world.
            This does not update the game or delete bases. If either save fails, the host stays on.
          </p>
        </div>
        <span
          className={
            unavailable
              ? 'shrink-0 rounded-full border border-th-border px-3 py-1 text-xs font-semibold uppercase text-th-text-s'
              : 'shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300'
          }
        >
          {helperInstalled === null ? 'Checking…' : unavailable ? 'Helper not installed' : 'Ready'}
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-th-text">Warning before power off</span>
          <select
            value={warningMinutes}
            onChange={(event) => setWarningMinutes(Number(event.target.value))}
            disabled={isRunning || unavailable}
            className="dune-input w-full"
            aria-label="Break warning minutes"
          >
            {WARNING_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? 'Immediate (no warning)' : `${minutes} minute${minutes === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setPending(true)}
            disabled={submitting || isRunning || unavailable || helperInstalled === null}
            className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-sm font-semibold text-rose-800 transition-[color,background-color,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out-expo)] hover:bg-rose-500/25 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-100 dune-focus"
          >
            <Moon aria-hidden="true" className="h-4 w-4" />
            {submitting ? 'Starting…' : isRunning ? 'In progress…' : 'Back up and power off'}
          </button>
        </div>
      </div>

      <p className="mt-4 text-sm text-th-text-s" aria-live="polite">
        Current phase: <span className="font-medium text-th-text">{poweredOff ? 'powering off' : phase}</span>
      </p>

      {unavailable && (
        <p className="mt-3 rounded-xl border border-th-border bg-th-surface-s/60 px-3 py-2 text-sm text-th-text-s">
          This machine cannot power itself off from the dashboard yet. On the host, run{' '}
          <code className="break-all rounded bg-th-surface/60 px-1">sudo DUNE_OFFSITE_BACKUP=/usr/local/sbin/dune-offsite-backup.sh ./scripts/install-taking-a-break.sh</code>.
        </p>
      )}

      {poweredOff && (
        <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
          The save was copied. The host is powering off, and this page will disconnect. Turn the power button on when you want to play. The world starts itself.
        </p>
      )}

      {error && phase === 'error' && (
        <p className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-100">
          {error}
        </p>
      )}

      {details.length > 0 && (
        <details className="mt-4 rounded-xl bg-th-surface-s/60 p-3 text-sm" open>
          <summary className="cursor-pointer font-medium text-th-text">Progress ({details.length})</summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {details.map((entry, index) => (
              <li key={`${entry.ts}-${index}`} className="text-th-text-s">
                <span className="text-th-text-m">{new Date(entry.ts).toLocaleTimeString()}</span>
                {' — '}
                {entry.msg}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={pending}
        title={warningMinutes === 0 ? 'Power off now?' : `Warn for ${warningMinutes} minute${warningMinutes === 1 ? '' : 's'}, then power off?`}
        message={
          warningMinutes === 0
            ? 'Players are disconnected now. The world is saved here and copied offsite. If either save fails, the host stays on. Otherwise this machine powers off. Turn it back on when you want to play.'
            : `Players get a ${warningMinutes} minute warning. The world is saved here and copied offsite. If either save fails, the host stays on. Otherwise this machine powers off. Turn it back on when you want to play.`
        }
        confirmLabel="Back up and power off"
        variant="danger"
        onCancel={() => setPending(false)}
        onConfirm={() => {
          setPending(false);
          void handleSubmit();
        }}
      />
    </section>
  );
}
