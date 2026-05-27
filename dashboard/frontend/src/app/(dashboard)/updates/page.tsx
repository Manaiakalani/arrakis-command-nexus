'use client';

import { AlertCircle, CheckCircle2, Clock, Download, Loader2, RefreshCw, Terminal, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useToast } from '@/components/ToastProvider';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

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
  const [loading, setLoading] = useState(true);

  const loadStatus = async () => {
    try {
      const data = await apiClient.getUpdateStatus();
      setStatus(data);
    } catch (error) {
      toast('Failed to load update status', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const result = await apiClient.checkForUpdates();
      if (result.success) {
        toast(
          result.update_available
            ? 'Update available! See instructions below.'
            : 'Server is up to date',
          result.update_available ? 'warning' : 'success'
        );
        await loadStatus();
      } else {
        toast(result.error || 'Failed to check for updates', 'error');
      }
    } catch (error: any) {
      toast(error?.message || 'Failed to check for updates', 'error');
      console.error(error);
    } finally {
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

  useEffect(() => {
    void loadStatus();
  }, []);

  const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Never';
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return 'Invalid date';
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-th-text">Server Updates</h1>
        <p className="mt-1 text-sm text-th-text-m">Check for and manage Dune Awakening server updates</p>
      </div>

      {/* Status Card */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-th-text">Update Status</h2>
          <div className="flex flex-wrap items-center gap-2">
            {status?.update_available && (
              <button
                type="button"
                onClick={() => void markAsCurrent()}
                disabled={marking || loading}
                className="dune-button-secondary"
              >
                <ThumbsUp className={cn('mr-1.5 h-4 w-4', marking && 'animate-pulse')} />
                {marking ? 'Saving...' : 'Mark as Current'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void checkForUpdates()}
              disabled={checking || loading}
              className="dune-button"
            >
              <RefreshCw className={cn('mr-1.5 h-4 w-4', checking && 'animate-spin')} />
              {checking ? 'Checking...' : 'Check for Updates'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-th-text-m">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading status...
          </div>
        ) : status ? (
          <div className="mt-6 space-y-4">
            {/* Update Available Banner */}
            {status.update_available && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
                <div className="flex-1">
                  <p className="font-semibold text-amber-600 dark:text-amber-300">Update Available</p>
                  <p className="mt-1 text-sm text-th-text-m">
                    A new server build is available on Steam (build {status.latest_build}). Follow the
                    instructions below to update, then click <strong>Mark as Current</strong> to dismiss
                    this notification.
                  </p>
                </div>
              </div>
            )}

            {/* Up to date banner */}
            {!status.update_available && status.latest_build && (
              <div className="flex items-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                  Server is up to date (Steam build {status.latest_build})
                </p>
              </div>
            )}

            {/* Info Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Terminal className="h-3.5 w-3.5" /> Installed Baseline
                </div>
                <p className="mt-2 font-mono text-lg text-th-text">
                  {status.current_build || <span className="text-th-text-m italic text-sm">Unknown (check now to set)</span>}
                </p>
                <p className="mt-1 text-xs text-th-text-s">Docker image: {status.current_tag}</p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Download className="h-3.5 w-3.5" /> Latest Steam Build
                </div>
                <p className="mt-2 font-mono text-lg text-th-text">
                  {status.latest_build || (
                    <span className="text-th-text-m italic text-sm">Not checked yet</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-th-text-s">App ID: {status.steam_app_id}</p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Clock className="h-3.5 w-3.5" /> Last Checked
                </div>
                <p className="mt-2 text-sm text-th-text">{formatDate(status.last_check)}</p>
                <p className="mt-1 text-xs text-th-text-s">
                  Auto-check every {status.check_interval_hours}h
                </p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Status
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

      {/* Update Instructions */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <h2 className="text-lg font-semibold text-th-text">How to Update</h2>
        <p className="mt-2 text-sm text-th-text-m">
          Server updates must be performed manually on the host machine. Follow these steps:
        </p>

        <div className="mt-4 space-y-4">
          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-600 dark:text-amber-300">
              1
            </div>
            <div>
              <p className="font-semibold text-th-text">SSH into the host server</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-th-border bg-black/30 p-3 text-xs font-mono text-th-text-m">
                ssh dunebrah@daspicebox
              </pre>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-600 dark:text-amber-300">
              2
            </div>
            <div>
              <p className="font-semibold text-th-text">Navigate to the server directory</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-th-border bg-black/30 p-3 text-xs font-mono text-th-text-m">
                cd ~/dune-server-docker
              </pre>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-600 dark:text-amber-300">
              3
            </div>
            <div>
              <p className="font-semibold text-th-text">Run the update script</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-th-border bg-black/30 p-3 text-xs font-mono text-th-text-m">
                ./dune update
              </pre>
              <p className="mt-2 text-xs text-th-text-s">
                Downloads the latest server files via SteamCMD, loads new Docker images, and optionally restarts the server.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-sm font-bold text-green-600 dark:text-green-400">
              4
            </div>
            <div>
              <p className="font-semibold text-th-text">Dismiss the update notification</p>
              <p className="mt-1 text-sm text-th-text-m">
                Click the <strong>Mark as Current</strong> button above to record the new build as the installed baseline and clear the update banner.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-blue-500" />
              <div>
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-300">Important</p>
                <ul className="mt-2 space-y-1 text-xs text-th-text-m">
                  <li>• The update process downloads new server files from Steam</li>
                  <li>• Updating requires restarting the server (brief downtime)</li>
                  <li>• Players should be notified before updating</li>
                  <li>• Always create a backup before updating</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Update Notifications */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <h2 className="text-lg font-semibold text-th-text">Update Notifications</h2>
        <p className="mt-2 text-sm text-th-text-m">
          Configure Discord webhooks in the <a href="/discord" className="text-amber-600 underline hover:text-amber-700 dark:text-amber-400">Discord page</a> to receive notifications when updates are available.
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
            <strong>Baseline:</strong> Set automatically on the first successful check. Reset by
            clicking <strong>Mark as Current</strong> after updating.
          </p>
          <p>
            <strong>No Auto-Download:</strong> Checking for updates does not download anything. The
            actual update must be triggered manually via the update script.
          </p>
        </div>
      </details>
    </div>
  );
}


  const loadStatus = async () => {
    try {
      const data = await apiClient.getUpdateStatus();
      setStatus(data);
    } catch (error) {
      toast('Failed to load update status', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const result = await apiClient.checkForUpdates();
      if (result.success) {
        toast(
          result.update_available
            ? 'Update available! See instructions below.'
            : 'Server is up to date',
          result.update_available ? 'warning' : 'success'
        );
        await loadStatus();
      } else {
        toast(result.error || 'Failed to check for updates', 'error');
      }
    } catch (error: any) {
      toast(error?.message || 'Failed to check for updates', 'error');
      console.error(error);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Never';
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return 'Invalid date';
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-th-text">Server Updates</h1>
        <p className="mt-1 text-sm text-th-text-m">Check for and manage Dune Awakening server updates</p>
      </div>

      {/* Status Card */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-th-text">Update Status</h2>
          <button
            type="button"
            onClick={() => void checkForUpdates()}
            disabled={checking || loading}
            className="dune-button"
          >
            <RefreshCw className={cn('mr-1.5 h-4 w-4', checking && 'animate-spin')} />
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-th-text-m">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading status...
          </div>
        ) : status ? (
          <div className="mt-6 space-y-4">
            {/* Update Available Banner */}
            {status.update_available && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="font-semibold text-amber-600 dark:text-amber-300">Update Available</p>
                  <p className="mt-1 text-sm text-th-text-m">
                    A new server build is available. Follow the instructions below to update.
                  </p>
                </div>
              </div>
            )}

            {/* Info Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Terminal className="h-3.5 w-3.5" /> Current Build
                </div>
                <p className="mt-2 font-mono text-lg text-th-text">{status.current_build || status.current_tag}</p>
                <p className="mt-1 text-xs text-th-text-s">Image tag: {status.current_tag}</p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Download className="h-3.5 w-3.5" /> Latest Build
                </div>
                <p className="mt-2 font-mono text-lg text-th-text">
                  {status.latest_build || (
                    <span className="text-th-text-m italic">Unknown</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-th-text-s">Steam App ID: {status.steam_app_id}</p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <Clock className="h-3.5 w-3.5" /> Last Checked
                </div>
                <p className="mt-2 text-sm text-th-text">{formatDate(status.last_check)}</p>
              </div>

              <div className="rounded-2xl border border-th-border bg-th-surface/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-th-text-m">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Status
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

      {/* Update Instructions */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <h2 className="text-lg font-semibold text-th-text">How to Update</h2>
        <p className="mt-2 text-sm text-th-text-m">
          Server updates must be performed manually on the host machine. Follow these steps:
        </p>

        <div className="mt-4 space-y-4">
          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-600 dark:text-amber-300">
              1
            </div>
            <div>
              <p className="font-semibold text-th-text">SSH into the host server</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-th-border bg-black/30 p-3 text-xs font-mono text-th-text-m">
                ssh dunebrah@daspicebox
              </pre>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-600 dark:text-amber-300">
              2
            </div>
            <div>
              <p className="font-semibold text-th-text">Navigate to the server directory</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-th-border bg-black/30 p-3 text-xs font-mono text-th-text-m">
                cd ~/dune-server-docker
              </pre>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-600 dark:text-amber-300">
              3
            </div>
            <div>
              <p className="font-semibold text-th-text">Run the update script</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-th-border bg-black/30 p-3 text-xs font-mono text-th-text-m">
                ./dune update
              </pre>
              <p className="mt-2 text-xs text-th-text-s">
                This will download the latest server files via SteamCMD, load the Docker images, and optionally restart the server.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-blue-500" />
              <div>
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-300">Important</p>
                <ul className="mt-2 space-y-1 text-xs text-th-text-m">
                  <li>• The update process downloads new server files from Steam</li>
                  <li>• Updating requires restarting the server (brief downtime)</li>
                  <li>• Players should be notified before updating</li>
                  <li>• Always create a backup before updating</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Update Notifications */}
      <div className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <h2 className="text-lg font-semibold text-th-text">Update Notifications</h2>
        <p className="mt-2 text-sm text-th-text-m">
          Configure Discord webhooks in the <a href="/discord" className="text-amber-600 underline hover:text-amber-700 dark:text-amber-400">Discord page</a> to receive notifications when updates are available.
        </p>
        <p className="mt-2 text-xs text-th-text-s">
          The system checks for updates every {status?.check_interval_hours || 6} hours.
        </p>
      </div>

      {/* Technical Details */}
      <details className="rounded-3xl border border-th-border-m bg-th-bg/30 p-6">
        <summary className="cursor-pointer text-lg font-semibold text-th-text hover:text-amber-600">
          Technical Details
        </summary>
        <div className="mt-4 space-y-2 text-sm text-th-text-m">
          <p>
            <strong>Update Mechanism:</strong> Uses SteamCMD to query Steam for the latest public build ID of the Dune Awakening dedicated server (App ID {status?.steam_app_id}).
          </p>
          <p>
            <strong>Detection:</strong> Compares the latest build ID from Steam with the installed build ID to determine if an update is available.
          </p>
          <p>
            <strong>No Auto-Download:</strong> Checking for updates does not download anything. The actual update must be triggered manually via the update script.
          </p>
        </div>
      </details>
    </div>
  );
}
