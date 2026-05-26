'use client';

import { AlertCircle, CheckCircle2, Clock, Download, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useToast } from '@/components/ToastProvider';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

export default function UpdatesPage() {
  const { showToast } = useToast();
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
  const [loading, setLoading] = useState(true);

  const loadStatus = async () => {
    try {
      const data = await apiClient.getUpdateStatus();
      setStatus(data);
    } catch (error) {
      showToast('Failed to load update status', 'error');
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
        showToast(
          result.update_available
            ? 'Update available! See instructions below.'
            : 'Server is up to date',
          result.update_available ? 'warning' : 'success'
        );
        await loadStatus();
      } else {
        showToast(result.error || 'Failed to check for updates', 'error');
      }
    } catch (error: any) {
      showToast(error?.message || 'Failed to check for updates', 'error');
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
            className="dune-button-primary text-sm"
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
