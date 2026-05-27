'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Download,
  Key,
  Link2,
  Lock,
  LockOpen,
  Palette,
  Plus,
  Server,
  Shield,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';

import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';

type SettingsData = Record<string, Record<string, unknown>>;

export default function SettingsPage() {
  const { toast } = useToast();
  const settings = useApi(() => apiClient.getSettings(), { initialData: {} as SettingsData });
  const admins = useApi(() => apiClient.getAdmins(), { initialData: [] });
  const [saving, setSaving] = useState<string | null>(null);
  const [newAdmin, setNewAdmin] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const general = useMemo(() => (settings.data?.general ?? {}) as Record<string, unknown>, [settings.data]);
  const security = useMemo(() => (settings.data?.security ?? {}) as Record<string, unknown>, [settings.data]);
  const integrations = useMemo(() => (settings.data?.integrations ?? {}) as Record<string, unknown>, [settings.data]);
  const appearance = useMemo(() => (settings.data?.appearance ?? {}) as Record<string, unknown>, [settings.data]);

  const serverPassword = useApi(() => apiClient.getServerPassword(), { initialData: { enabled: false, hasPassword: false } });
  const [passwordEnabled, setPasswordEnabled] = useState<boolean | null>(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const effectivePasswordEnabled = passwordEnabled ?? (serverPassword.data?.enabled ?? false);

  const saveSection = useCallback(async (section: string, data: Record<string, unknown>) => {
    setSaving(section);
    try {
      await apiClient.updateSettingsSection(section, data);
      await settings.refetch();
      toast(`${section.charAt(0).toUpperCase()}${section.slice(1)} settings saved.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to save ${section} settings.`;
      toast(`Failed to save ${section} settings: ${message}`, 'error');
    } finally {
      setSaving(null);
    }
  }, [settings, toast]);

  const handleExport = useCallback(async () => {
    try {
      const data = await apiClient.exportSettings();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexus-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Settings exported.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export settings.';
      toast(`Failed to export settings: ${message}`, 'error');
    }
  }, [toast]);

  const handleImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const payload = JSON.parse(text);
      await apiClient.importSettings(payload);
      await settings.refetch();
      toast('Settings imported.', 'success');
    } catch (error) {
      const message = error instanceof SyntaxError
        ? 'Invalid JSON file.'
        : error instanceof Error
          ? error.message
          : 'Failed to import settings.';
      toast(`Failed to import settings: ${message}`, 'error');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [settings, toast]);

  const handleAddAdmin = useCallback(async () => {
    const username = newAdmin.trim();
    if (!username) return;
    try {
      await apiClient.addAdmin(username);
      setNewAdmin('');
      await admins.refetch();
      toast('Administrator added.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add administrator.';
      toast(`Failed to add administrator: ${message}`, 'error');
    }
  }, [newAdmin, admins, toast]);

  const handleRemoveAdmin = useCallback(async (id: number) => {
    if (!window.confirm('Remove this administrator?')) return;
    try {
      await apiClient.removeAdmin(id);
      await admins.refetch();
      toast('Administrator removed.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove administrator.';
      toast(`Failed to remove administrator: ${message}`, 'error');
    }
  }, [admins, toast]);

  const handleToggleAdmin = useCallback(async (id: number, enabled: boolean) => {
    try {
      await apiClient.updateAdmin(id, { enabled });
      await admins.refetch();
      toast(`Administrator ${enabled ? 'enabled' : 'disabled'}.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update administrator.';
      toast(`Failed to update administrator: ${message}`, 'error');
    }
  }, [admins, toast]);

  const handleSavePassword = useCallback(async (enabled: boolean) => {
    setSavingPassword(true);
    try {
      const result = await apiClient.setServerPassword(enabled, passwordValue || undefined);
      setPasswordEnabled(result.enabled);
      await serverPassword.refetch();
      const restartedCount = result.restarted?.length ?? 0;
      toast(
        enabled
          ? `Password protection enabled. ${restartedCount} game server(s) restarted.`
          : `Password protection disabled. ${restartedCount} game server(s) restarted.`,
        'success',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update password.';
      toast(`Failed to update password: ${message}`, 'error');
    } finally {
      setSavingPassword(false);
    }
  }, [passwordValue, serverPassword, toast]);

  const isLoading = settings.loading || admins.loading;

  if (isLoading) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel border-amber-500/20 bg-amber-500/10 p-5 text-amber-800 dark:text-amber-100">
        <p className="section-title text-amber-600/80 dark:text-amber-200/80">Command Nexus</p>
        <h2 className="mt-1 text-xl font-semibold">Dashboard Settings</h2>
        <p className="mt-2 max-w-3xl text-sm text-amber-800/80 dark:text-amber-100/80">
          Configure the Command Nexus dashboard itself. Server-specific game settings live under Configuration.
        </p>
      </div>

      {/* Import / Export */}
      <div className="glass-panel p-5">
        <p className="section-title">Data portability</p>
        <h2 className="mt-1 text-xl font-semibold text-th-text">Import &amp; Export</h2>
        <p className="mt-2 text-sm text-th-text-m">
          Transfer your dashboard settings between instances or create a backup of all Nexus preferences.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="dune-button" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Export Settings
          </button>
          <button type="button" className="dune-button-muted" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            Import Settings
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} aria-label="Import settings file" />
        </div>
      </div>

      {/* Server Access — password toggle */}
      <div className="glass-panel p-5">
        <div className="mb-4 flex items-center gap-2">
          {effectivePasswordEnabled
            ? <Lock className="h-5 w-5 text-amber-400" aria-hidden="true" />
            : <LockOpen className="h-5 w-5 text-emerald-400" aria-hidden="true" />}
          <h2 className="text-xl font-semibold text-th-text">Server Access</h2>
          <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            effectivePasswordEnabled
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-emerald-500/20 text-emerald-300'
          }`}>
            {effectivePasswordEnabled ? 'Password protected' : 'Open access'}
          </span>
        </div>
        <p className="mb-4 text-sm text-th-text-m">
          When enabled, players must enter a password to join. Changing this setting immediately restarts the
          game servers. The password is preserved when disabled so you can re-enable it later.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="serverPassword" className="block text-sm font-medium text-th-text-s">
              Join password{!effectivePasswordEnabled && serverPassword.data?.hasPassword ? ' (stored, not active)' : ''}
            </label>
            <input
              id="serverPassword"
              type="password"
              className="dune-input mt-1 w-full"
              placeholder={serverPassword.data?.hasPassword ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Enter a password\u2026'}
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              disabled={savingPassword}
            />
          </div>
          <div className="flex gap-3">
            {effectivePasswordEnabled ? (
              <button
                type="button"
                className="dune-button-muted"
                onClick={() => handleSavePassword(false)}
                disabled={savingPassword}
              >
                <LockOpen className="mr-2 h-4 w-4" aria-hidden="true" />
                {savingPassword ? 'Disabling\u2026' : 'Disable password'}
              </button>
            ) : (
              <button
                type="button"
                className="dune-button"
                onClick={() => handleSavePassword(true)}
                disabled={savingPassword || (!passwordValue && !serverPassword.data?.hasPassword)}
              >
                <Lock className="mr-2 h-4 w-4" aria-hidden="true" />
                {savingPassword ? 'Enabling\u2026' : 'Enable password'}
              </button>
            )}
          </div>
        </div>
        {!effectivePasswordEnabled && (
          <p className="mt-3 text-xs text-emerald-400">
            Server is publicly visible in the in-game browser. Players can join without a password.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* General */}
        <section className="glass-panel p-5">
          <div className="mb-4 flex items-center gap-2 text-amber-400">
            <Server className="h-5 w-5" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-th-text">General</h3>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              saveSection('general', {
                serverName: fd.get('serverName') as string,
                serverDescription: fd.get('serverDescription') as string,
                motd: fd.get('motd') as string,
                timezone: fd.get('timezone') as string,
              });
            }}
          >
            <div>
              <label htmlFor="serverName" className="block text-sm font-medium text-th-text-s">Server name</label>
              <input id="serverName" name="serverName" className="dune-input mt-1 w-full" defaultValue={general.serverName as string ?? ''} key={`sn-${general.serverName}`} />
            </div>
            <div>
              <label htmlFor="serverDescription" className="block text-sm font-medium text-th-text-s">Description</label>
              <input id="serverDescription" name="serverDescription" className="dune-input mt-1 w-full" defaultValue={general.serverDescription as string ?? ''} key={`sd-${general.serverDescription}`} />
            </div>
            <div>
              <label htmlFor="motd" className="block text-sm font-medium text-th-text-s">Message of the day</label>
              <textarea id="motd" name="motd" rows={2} className="dune-input mt-1 w-full resize-none" defaultValue={general.motd as string ?? ''} key={`motd-${general.motd}`} />
            </div>
            <div>
              <label htmlFor="timezone" className="block text-sm font-medium text-th-text-s">Timezone</label>
              <input id="timezone" name="timezone" className="dune-input mt-1 w-full" defaultValue={general.timezone as string ?? ''} key={`tz-${general.timezone}`} />
            </div>
            <button type="submit" className="dune-button" disabled={saving === 'general'}>
              {saving === 'general' ? 'Saving\u2026' : 'Save general'}
            </button>
          </form>
        </section>

        {/* Security */}
        <section className="glass-panel p-5">
          <div className="mb-4 flex items-center gap-2 text-red-600 dark:text-red-400">
            <Shield className="h-5 w-5" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-th-text">Security</h3>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              saveSection('security', {
                sessionTimeoutMinutes: Number(fd.get('sessionTimeout')),
                mfaEnabled: fd.get('mfaEnabled') === 'on',
                ipAllowlist: (fd.get('ipAllowlist') as string).split(',').map((s) => s.trim()).filter(Boolean),
              });
            }}
          >
            <div>
              <label htmlFor="sessionTimeout" className="block text-sm font-medium text-th-text-s">Session timeout (minutes)</label>
              <input id="sessionTimeout" name="sessionTimeout" type="number" min={5} max={1440} className="dune-input mt-1 w-full" defaultValue={security.sessionTimeoutMinutes as number ?? 60} key={`st-${security.sessionTimeoutMinutes}`} />
            </div>
            <div className="flex items-center gap-3">
              <input id="mfaEnabled" name="mfaEnabled" type="checkbox" className="h-4 w-4 rounded border-th-border bg-th-surface accent-amber-500" defaultChecked={security.mfaEnabled as boolean ?? false} key={`mfa-${security.mfaEnabled}`} />
              <label htmlFor="mfaEnabled" className="text-sm font-medium text-th-text-s">Enable multi-factor authentication</label>
            </div>
            <div>
              <label htmlFor="ipAllowlist" className="block text-sm font-medium text-th-text-s">IP allowlist (comma-separated)</label>
              <input id="ipAllowlist" name="ipAllowlist" className="dune-input mt-1 w-full" placeholder="Leave empty for unrestricted access" defaultValue={Array.isArray(security.ipAllowlist) ? (security.ipAllowlist as string[]).join(', ') : ''} key={`ip-${JSON.stringify(security.ipAllowlist)}`} />
            </div>
            <button type="submit" className="dune-button" disabled={saving === 'security'}>
              {saving === 'security' ? 'Saving\u2026' : 'Save security'}
            </button>
          </form>
        </section>

        {/* Integrations */}
        <section className="glass-panel p-5">
          <div className="mb-4 flex items-center gap-2 text-blue-400">
            <Link2 className="h-5 w-5" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-th-text">Integrations</h3>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              saveSection('integrations', {
                grafanaUrl: fd.get('grafanaUrl') as string,
                prometheusUrl: fd.get('prometheusUrl') as string,
               uptimeKumaUrl: fd.get('uptimeKumaUrl') as string,
               uptimeKumaPushToken: fd.get('uptimeKumaPushToken') as string,
             });
           }}
          >
           <div>
             <label htmlFor="grafanaUrl" className="block text-sm font-medium text-th-text-s">Grafana URL</label>
             <input id="grafanaUrl" name="grafanaUrl" type="url" className="dune-input mt-1 w-full" placeholder="https://grafana.example.com" defaultValue={integrations.grafanaUrl as string ?? ''} key={`gf-${integrations.grafanaUrl}`} />
           </div>
           <div>
             <label htmlFor="prometheusUrl" className="block text-sm font-medium text-th-text-s">Prometheus URL</label>
             <input id="prometheusUrl" name="prometheusUrl" type="url" className="dune-input mt-1 w-full" placeholder="https://prometheus.example.com" defaultValue={integrations.prometheusUrl as string ?? ''} key={`pm-${integrations.prometheusUrl}`} />
           </div>
           <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
             <p className="mb-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">Uptime Kuma</p>
             <div className="space-y-3">
               <div>
                 <label htmlFor="uptimeKumaUrl" className="block text-sm font-medium text-th-text-s">Instance URL</label>
                 <input id="uptimeKumaUrl" name="uptimeKumaUrl" type="url" className="dune-input mt-1 w-full" placeholder="https://uptime.example.com" defaultValue={integrations.uptimeKumaUrl as string ?? ''} key={`uk-${integrations.uptimeKumaUrl}`} />
               </div>
               <div>
                 <label htmlFor="uptimeKumaPushToken" className="block text-sm font-medium text-th-text-s">Push monitor token</label>
                 <input id="uptimeKumaPushToken" name="uptimeKumaPushToken" className="dune-input mt-1 w-full" placeholder="abc123..." defaultValue={integrations.uptimeKumaPushToken as string ?? ''} key={`ukt-${integrations.uptimeKumaPushToken}`} />
                 <p className="mt-1 text-xs text-th-text-m">Found in your Push monitor&apos;s URL: /api/push/[token]</p>
               </div>
             </div>
           </div>
            <button type="submit" className="dune-button" disabled={saving === 'integrations'}>
              {saving === 'integrations' ? 'Saving\u2026' : 'Save integrations'}
            </button>
          </form>
        </section>

        {/* Appearance */}
        <section className="glass-panel p-5">
          <div className="mb-4 flex items-center gap-2 text-purple-400">
            <Palette className="h-5 w-5" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-th-text">Appearance</h3>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              saveSection('appearance', {
                accentColor: fd.get('accentColor') as string,
                compactMode: fd.get('compactMode') === 'on',
                showPublicStatus: fd.get('showPublicStatus') === 'on',
              });
            }}
          >
            <div>
              <label htmlFor="accentColor" className="block text-sm font-medium text-th-text-s">Accent color</label>
              <select id="accentColor" name="accentColor" className="dune-input mt-1 w-full" defaultValue={appearance.accentColor as string ?? 'amber'} key={`ac-${appearance.accentColor}`} aria-label="Accent color">
                <option value="amber">Amber (default)</option>
                <option value="blue">Blue</option>
                <option value="emerald">Emerald</option>
                <option value="rose">Rose</option>
                <option value="violet">Violet</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <input id="compactMode" name="compactMode" type="checkbox" className="h-4 w-4 rounded border-th-border bg-th-surface accent-amber-500" defaultChecked={appearance.compactMode as boolean ?? false} key={`cm-${appearance.compactMode}`} />
              <label htmlFor="compactMode" className="text-sm font-medium text-th-text-s">Compact mode</label>
            </div>
            <div className="flex items-center gap-3">
              <input id="showPublicStatus" name="showPublicStatus" type="checkbox" className="h-4 w-4 rounded border-th-border bg-th-surface accent-amber-500" defaultChecked={appearance.showPublicStatus as boolean ?? true} key={`ps-${appearance.showPublicStatus}`} />
              <label htmlFor="showPublicStatus" className="text-sm font-medium text-th-text-s">Show public status page</label>
            </div>
            <button type="submit" className="dune-button" disabled={saving === 'appearance'}>
              {saving === 'appearance' ? 'Saving\u2026' : 'Save appearance'}
            </button>
          </form>
        </section>
      </div>

      {/* Admin management */}
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-5">
          <div className="flex items-center gap-2 text-amber-400">
            <Key className="h-5 w-5" aria-hidden="true" />
            <div>
              <p className="section-title">Access control</p>
              <h2 className="mt-1 text-xl font-semibold text-th-text">Administrators</h2>
            </div>
          </div>
          <p className="mt-2 text-sm text-th-text-m">
            Track who has access to the Command Nexus. All administrators share the same API token configured in your environment.
          </p>
        </div>

        <div className="divide-y divide-th-border-m/80">
          {(admins.data ?? []).map((admin) => (
            <div key={admin.id} className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-th-text">{admin.username}</p>
                  <p className="text-xs text-th-text-m">
                    {admin.role} &middot; {admin.enabled ? 'Active' : 'Disabled'}
                    {admin.lastLogin ? ` \u00b7 Last seen ${new Date(admin.lastLogin).toLocaleDateString()}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="dune-button-muted text-xs"
                  onClick={() => handleToggleAdmin(admin.id, !admin.enabled)}
                >
                  {admin.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="dune-button-muted text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                  onClick={() => handleRemoveAdmin(admin.id)}
                  aria-label={`Remove ${admin.username}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          {(admins.data ?? []).length === 0 ? (
            <div className="p-10 text-center text-th-text-m">
              No administrators registered. Use the form below to track team members with dashboard access.
            </div>
          ) : null}
        </div>

        <div className="border-t border-th-border-m/80 p-5">
          <form
            className="flex items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              handleAddAdmin();
            }}
          >
            <div className="flex-1">
              <label htmlFor="newAdminUser" className="block text-sm font-medium text-th-text-s">Add administrator</label>
              <input
                id="newAdminUser"
                className="dune-input mt-1 w-full"
                placeholder="Username"
                value={newAdmin}
                onChange={(e) => setNewAdmin(e.target.value)}
              />
            </div>
            <button type="submit" className="dune-button" disabled={!newAdmin.trim()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function SettingsPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="glass-panel border-amber-500/20 bg-amber-500/10 p-5 space-y-2">
        <Skeleton className="h-3 w-28 bg-amber-500/20" />
        <Skeleton className="h-8 w-56 bg-amber-500/20" />
        <Skeleton className="h-4 w-full max-w-3xl bg-amber-500/20" />
      </div>
      <div className="glass-panel p-5 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
        <div className="flex gap-3">
          <Skeleton className="h-11 w-40 rounded-xl" />
          <Skeleton className="h-11 w-40 rounded-xl" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <section key={index} className="glass-panel p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-7 w-28" />
            </div>
            {Array.from({ length: 4 }).map((__, fieldIndex) => (
              <div key={fieldIndex} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            ))}
            <Skeleton className="h-11 w-32 rounded-xl" />
          </section>
        ))}
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="border-b border-th-border-m/80 p-5 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <div className="divide-y divide-th-border-m/80">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20 rounded-xl" />
                <Skeleton className="h-9 w-9 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-th-border-m/80 p-5">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
            <Skeleton className="h-11 w-20 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
