'use client';

import { AlertCircle, Archive, Bell, CheckCircle2, Clock, Database, Download, Loader2, RefreshCw, RotateCcw, Settings2, Terminal, ThumbsUp, Wrench, Zap, ZapOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/ToastProvider';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

type UpdatePhase = 'idle' | 'backup' | 'download' | 'apply' | 'verify' | 'done' | 'failed';

const PHASE_STEPS: { key: UpdatePhase; label: string }[] = [
  { key: 'backup', label: 'Backup' },
  { key: 'download', label: 'Download' },
  { key: 'apply', label: 'Apply' },
  { key: 'verify', label: 'Verify' },
];

export default function UpdatesPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{
    current_tag: string;
    current_build: string | null;
    latest_build: string | null;
    update_available: boolean;
    last_check: string | null;
    auto_update_enabled: boolean;
    check_interval_hours: number;
    steam_app_id: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [marking, setMarking] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [updateRunning, setUpdateRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hostInfo, setHostInfo] = useState<{ ssh_user: string; ssh_host: string; server_dir: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [preUpdateBackupId, setPreUpdateBackupId] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiClient.getUpdateStatus();
      setStatus(data);
      try {
        const hi = await apiClient.getUpdateHostInfo();
        setHostInfo(hi);
      } catch {
        // Non-fatal: if host-info fails we just render placeholders.
      }
    } catch (error) {
      toast('Failed to load update status', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const checkForUpdates = async () => {
    setChecking(true);
    const previousLastCheck = status?.last_check ?? null;
    try {
      // POST /updates/check now returns immediately (check runs in background)
      await apiClient.checkForUpdates();
      toast('Checking for updates in the background\u2026', 'success');
      // Poll /updates/status until last_check advances (up to 90s).
      // Stash the interval in pollRef so unmount cleanup can clear it.
      const deadline = Date.now() + 90_000;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const fresh = await apiClient.getUpdateStatus();
          setStatus(fresh);
          if (fresh.last_check !== previousLastCheck || Date.now() > deadline) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            setChecking(false);
            if (fresh.update_available) {
              toast('Update available! See instructions below.', 'warning');
            } else if (fresh.last_check !== previousLastCheck) {
              toast('Server is up to date', 'success');
            }
          }
        } catch {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setChecking(false);
        }
      }, 5_000);
    } catch (error: any) {
      toast(error?.message || 'Failed to check for updates', 'error');
      setChecking(false);
    }
  };

  const markAsCurrent = async () => {
    setMarking(true);
    try {
      const result = await apiClient.markUpdateAsCurrent();
      if (result.success) {
        toast('Server marked as up-to-date — update banner cleared', 'success');
        await loadStatus();
      } else {
        toast(result.error || 'Failed to mark as current', 'error');
      }
    } catch (error: any) {
      toast(error?.message || 'Failed to mark as current', 'error');
      console.error(error);
    } finally {
      setMarking(false);
    }
  };

  const triggerUpdate = async () => {
    if (!window.confirm('This will create a full backup, download the latest server files, load new Docker images, and restart game containers. Continue?')) return;
    setTriggering(true);
    setUpdatePhase('backup');
    try {
      // Phase 1: Pre-update backup
      try {
        const backup = await apiClient.createBackup('full');
        setPreUpdateBackupId(backup.id);
        toast('Pre-update backup created', 'success');
      } catch {
        toast('Pre-update backup failed — continuing with update', 'warning');
      }

      // Phase 2: Trigger download + apply
      setUpdatePhase('download');
      const result = await apiClient.triggerUpdate();
      if (result.status === 'started') {
        toast('Update started — monitoring progress…', 'success');
        setUpdateRunning(true);
        setUpdatePhase('apply');
        // Poll for completion
        pollRef.current = setInterval(async () => {
          try {
            const triggerStatus = await apiClient.getTriggerStatus();
            if (triggerStatus.status === 'done') {
              clearInterval(pollRef.current!);
              setUpdateRunning(false);
              setUpdatePhase('verify');
              if (triggerStatus.result?.success) {
                toast(`Update complete! New tag: ${triggerStatus.result.new_tag || 'unknown'}`, 'success');
                setUpdatePhase('done');
              } else {
                toast(triggerStatus.result?.error || 'Update completed with errors', 'error');
                setUpdatePhase('failed');
              }
              await loadStatus();
            } else if (triggerStatus.status === 'failed') {
              clearInterval(pollRef.current!);
              setUpdateRunning(false);
              setUpdatePhase('failed');
              toast(triggerStatus.error || 'Update failed', 'error');
              await loadStatus();
            }
          } catch (e) {
            console.error('Poll error', e);
          }
        }, 5000);
      } else {
        setUpdatePhase('failed');
        toast(result.error || 'Failed to start update', 'error');
      }
    } catch (error: any) {
      setUpdatePhase('failed');
      toast(error?.message || 'Failed to trigger update', 'error');
      console.error(error);
    } finally {
      setTriggering(false);
    }
  };

  const handleRollback = async () => {
    if (!preUpdateBackupId) {
      toast('No pre-update backup available for rollback', 'error');
      return;
    }
    if (!window.confirm('Restore the pre-update backup? This will revert all changes made during the update.')) return;
    setRollingBack(true);
    try {
      await apiClient.restoreBackup(preUpdateBackupId);
      toast('Rollback complete — pre-update backup restored', 'success');
      setUpdatePhase('idle');
      await loadStatus();
    } catch (error: any) {
      toast(error?.message || 'Rollback failed', 'error');
    } finally {
      setRollingBack(false);
    }
  };

  const toggleAutoUpdate = async () => {
    if (!status) return;
    const newValue = !status.auto_update_enabled;
    if (newValue && !window.confirm('Enabling auto-update will automatically download server files and restart containers when a new build is detected. Continue?')) return;
    try {
      const result = await apiClient.setAutoUpdate(newValue);
      setStatus((prev) => prev ? { ...prev, auto_update_enabled: result.auto_update_enabled } : prev);
      toast(result.auto_update_enabled ? 'Auto-update enabled' : 'Auto-update disabled', 'success');
    } catch (error: any) {
      toast(error?.message || 'Failed to update setting', 'error');
    }
  };

  useEffect(() => {
    void loadStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadStatus]);

  const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Never';
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return 'Invalid date';
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="inline-flex items-center gap-3 text-3xl font-bold text-th-text"><Download aria-hidden="true" className="h-7 w-7 text-amber-600 dark:text-amber-300" /> Server Updates</h1>
        <p className="mt-1 text-sm text-th-text-m">Check for and manage Dune Awakening server updates</p>
      </div>

      {/* Status Card */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-th-text"><RefreshCw aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Update Status</h2>
          <div className="flex flex-wrap items-center gap-2">
            {status?.update_available && (
              <>
                <button
                  type="button"
                  onClick={() => void markAsCurrent()}
                  disabled={marking || loading}
                  className="dune-button-secondary"
                >
                  <ThumbsUp aria-hidden="true" className={cn('mr-1.5 h-4 w-4', marking && 'animate-pulse')} />
                  {marking ? 'Saving…' : 'Mark as Current'}
                </button>
                <button
                  type="button"
                  onClick={() => void triggerUpdate()}
                  disabled={triggering || updateRunning || loading}
                  className="dune-button bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  <Download aria-hidden="true" className={cn('mr-1.5 h-4 w-4', (triggering || updateRunning) && 'animate-bounce')} />
                  {updateRunning ? 'Updating…' : triggering ? 'Starting…' : 'Apply Update'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void checkForUpdates()}
              disabled={checking || loading || updateRunning}
              className="dune-button"
            >
              <RefreshCw aria-hidden="true" className={cn('mr-1.5 h-4 w-4', checking && 'animate-spin')} />
              {checking ? 'Checking…' : 'Check for Updates'}
            </button>
          </div>
        </div>

        {/* Update progress phases */}
        {updatePhase !== 'idle' && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
              {updatePhase !== 'done' && updatePhase !== 'failed' && (
                <Loader2 aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin text-blue-500" />
              )}
              {updatePhase === 'done' && <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-500" />}
              {updatePhase === 'failed' && <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-red-500" />}
              <p className="text-sm font-semibold text-blue-600 dark:text-blue-300">
                {updatePhase === 'done' ? 'Update completed successfully' : updatePhase === 'failed' ? 'Update failed' : 'Update in progress…'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {PHASE_STEPS.map((step, i) => {
                const stepIdx = PHASE_STEPS.findIndex((s) => s.key === updatePhase);
                const currentIdx = updatePhase === 'done' ? PHASE_STEPS.length : updatePhase === 'failed' ? stepIdx : stepIdx;
                const isDone = i < currentIdx || updatePhase === 'done';
                const isCurrent = i === currentIdx && updatePhase !== 'done' && updatePhase !== 'failed';
                const isFailed = i === currentIdx && updatePhase === 'failed';
                return (
                  <div key={step.key} className="flex flex-1 flex-col items-center gap-1">
                    <div className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                      isDone ? 'bg-emerald-500/20 text-emerald-400' : isCurrent ? 'bg-blue-500/20 text-blue-400' : isFailed ? 'bg-red-500/20 text-red-400' : 'bg-th-surface-s text-th-text-m',
                    )}>
                      {isDone ? <CheckCircle2 className="h-4 w-4" /> : isCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> : i + 1}
                    </div>
                    <span className={cn('text-[10px] uppercase tracking-wider', isDone ? 'text-emerald-400' : isCurrent ? 'text-blue-400' : 'text-th-text-m')}>{step.label}</span>
                  </div>
                );
              })}
            </div>
            {(updatePhase === 'done' || updatePhase === 'failed') && preUpdateBackupId && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleRollback()}
                  disabled={rollingBack}
                  className="dune-button-muted inline-flex items-center gap-1.5"
                >
                  <RotateCcw aria-hidden="true" className={cn('h-4 w-4', rollingBack && 'animate-spin')} />
                  {rollingBack ? 'Rolling back…' : 'Rollback to Pre-Update Backup'}
                </button>
                <span className="text-xs text-th-text-m">Backup: {preUpdateBackupId}</span>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-th-text-m">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading status…
          </div>
        ) : status ? (
          <div className="mt-6 space-y-4">
            {/* Update Available Banner */}
            {status.update_available && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-500" />
                <div className="flex-1">
                  <p className="font-semibold text-amber-600 dark:text-amber-300">Update Available</p>
                  <p className="mt-1 text-sm text-th-text-m">
                    A new server build is available on Steam (build {status.latest_build}). Click{' '}
                    <strong>Apply Update</strong> to auto-update, or follow the manual steps below.
                  </p>
                </div>
              </div>
            )}

            {/* Up to date banner */}
            {!status.update_available && status.latest_build && (
              <div className="flex items-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 p-4">
                <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-green-500" />
                <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                  Server is up to date (Steam build {status.latest_build})
                </p>
              </div>
            )}

            {/* Info Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Terminal aria-hidden="true" className="h-3.5 w-3.5" /> Installed Baseline
                </div>
                <p className="mt-2 font-mono text-lg text-th-text">
                  {status.current_build || <span className="text-th-text-m italic text-sm">Unknown (check now to set)</span>}
                </p>
                <p className="mt-1 text-xs text-th-text-s">Docker image: {status.current_tag}</p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Download aria-hidden="true" className="h-3.5 w-3.5" /> Latest Steam Build
                </div>
                <p className="mt-2 font-mono text-lg text-th-text">
                  {status.latest_build || <span className="text-th-text-m italic text-sm">Not checked yet</span>}
                </p>
                <p className="mt-1 text-xs text-th-text-s">App ID: {status.steam_app_id}</p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Clock aria-hidden="true" className="h-3.5 w-3.5" /> Last Checked
                </div>
                <p className="mt-2 text-sm text-th-text">{formatDate(status.last_check)}</p>
                <p className="mt-1 text-xs text-th-text-s">
                  Auto-check every {status.check_interval_hours}h
                </p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> Status
                </div>
                <p className={cn('mt-2 text-sm font-medium', status.update_available ? 'text-amber-600 dark:text-amber-300' : 'text-green-600 dark:text-green-400')}>
                  {status.update_available ? 'Update Available' : 'Up to Date'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-th-text-m">Failed to load status</p>
        )}
      </div>

      {/* Auto-Update Settings */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-th-text"><Settings2 aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Automatic Updates</h2>
            <p className="mt-1 text-sm text-th-text-m">
              When enabled, the dashboard will automatically download, load, and apply server updates when a new
              Steam build is detected. A backup is created before restarting. Discord notifications are sent
              before and after the update.
            </p>
            {status?.auto_update_enabled && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                ⚠️ Auto-update is active — game servers will restart automatically when an update is detected.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void toggleAutoUpdate()}
            disabled={loading || !status}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors',
              status?.auto_update_enabled
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'
                : 'border-th-border bg-th-surface/40 text-th-text-m hover:bg-th-surface'
            )}
          >
            {status?.auto_update_enabled ? (
              <><Zap aria-hidden="true" className="h-4 w-4" /> Auto-Update On</>
            ) : (
              <><ZapOff aria-hidden="true" className="h-4 w-4" /> Auto-Update Off</>
            )}
          </button>
        </div>
      </div>

      {/* Manual Update Instructions */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-th-text"><Wrench aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Manual Update</h2>
        <p className="mt-2 text-sm text-th-text-m">
          Use <strong>Apply Update</strong> above for one-click updates, or run these steps manually on the host:
        </p>

        <div className="mt-4 space-y-4">
          {[
            { label: 'SSH into the host server', cmd: `ssh ${hostInfo?.ssh_user ?? '<your-user>'}@${hostInfo?.ssh_host ?? '<your-host>'}` },
            { label: 'Navigate to the server directory', cmd: `cd ${hostInfo?.server_dir ?? '~/dune-server-docker'}` },
            { label: 'Run the update script', cmd: './dune update', note: 'Downloads the latest server files via SteamCMD, loads new Docker images, and optionally restarts the server.' },
          ].map((step, index) => (
            <div key={index} className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-600 dark:text-amber-300">
                {index + 1}
              </div>
              <div>
                <p className="font-semibold text-th-text">{step.label}</p>
                <pre className="mt-2 overflow-x-auto rounded-lg border border-th-border bg-th-surface-s/80 dark:bg-black/30 p-3 text-xs font-mono text-th-text-m">
                  {step.cmd}
                </pre>
                {step.note && <p className="mt-2 text-xs text-th-text-s">{step.note}</p>}
              </div>
            </div>
          ))}

          <div className="mt-6 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-blue-500" />
              <ul className="space-y-1 text-xs text-th-text-m">
                <li>• The update process downloads new server files from Steam</li>
                <li>• Updating requires restarting the server (brief downtime)</li>
                <li>• Players should be notified before updating — use the announcements feature</li>
                <li>• A backup is automatically created before applying updates</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Update Notifications */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-th-text"><Bell aria-hidden="true" className="h-5 w-5 text-amber-600 dark:text-amber-300" /> Update Notifications</h2>
        <p className="mt-2 text-sm text-th-text-m">
          Configure Discord webhooks in the{' '}
          <a href="/discord" className="text-amber-600 underline hover:text-amber-700 dark:text-amber-400">Discord page</a>{' '}
          to receive notifications when updates are available or applied automatically.
        </p>
        <p className="mt-2 text-xs text-th-text-s">
          The system checks for updates every {status?.check_interval_hours || 6} hours automatically.
        </p>
      </div>

      {/* Technical Details */}
      <details className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <summary className="cursor-pointer text-lg font-semibold text-th-text hover:text-amber-600">
          Technical Details
        </summary>
        <div className="mt-4 space-y-2 text-sm text-th-text-m">
          <p>
            <strong>Update Detection:</strong> Uses SteamCMD to query Steam for the latest public build
            ID of the Dune Awakening dedicated server (App ID {status?.steam_app_id}). Compares the
            Steam build ID against a stored baseline — not the Docker image tag — so comparisons are
            always apples-to-apples.
          </p>
          <p>
            <strong>Auto-Update Process:</strong> When triggered (manually or automatically), the dashboard
            runs steamcmd to download new server files, loads the new Docker image tarballs, updates
            the DUNE_IMAGE_TAG in .env, then restarts game server containers via the Docker API.
          </p>
          <p>
            <strong>Baseline:</strong> Set automatically on the first successful check. Reset by
            clicking <strong>Mark as Current</strong> after a manual update.
          </p>
        </div>
      </details>
    </div>
  );
}

