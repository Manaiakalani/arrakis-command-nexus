import {
  AnnouncementHistoryEntry,
  BackupEntry,
  BackupSchedule,
  BaseRecord,
  VehicleRecord,
  VehicleTeleportResponse,
  ScheduledAnnouncement,
  ScheduledAnnouncementMutation,
  BanEntry,
  AllowlistEntry,
  CharacterRecord,
  CharacterStatsSchema,
  PlayerPosition,
  ChatGuardSettings,
  ChatGuardViolation,
  ConfigDriftStatus,
  ConfigFile,
  ConnectionLogEntry,
  DiscordWebhook,
  EconomyAlert,
  EconomySummary,
  ManualEconomyAlertRequest,
  MapStatus,
  MetricsHistory,
  Player,
  ReadinessStatus,
  ServerOverview,
  ServiceStatus,
  RestartNowResponse,
  RestartSchedule,
  SystemMetrics,
  SystemVersion,
  UptimeData,
  DashboardOverview,
  WatchdogCrashEvent,
  WatchdogStatus,
} from '@/lib/types';

const DEFAULT_BASE_URL = '/api/v1';

function resolveBaseUrl() {
  const explicitBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (explicitBase) {
    return explicitBase.replace(/\/$/, '');
  }

  return DEFAULT_BASE_URL;
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = resolveBaseUrl()) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    if (!(init?.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error?.message) {
          message = body.error.message;
        }
      } catch {
        const text = await response.text();
        if (text) message = text;
      }
      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  /** Public generic GET — used by the SWR default fetcher. */
  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  getStatus() {
    return this.request<ServerOverview>('/status');
  }

  getReady() {
    return this.request<ReadinessStatus>('/ready');
  }

  getMaps() {
    return this.request<MapStatus[]>('/maps');
  }

  startMap(name: string) {
    return this.request<MapStatus>(`/maps/${encodeURIComponent(name)}/start`, { method: 'POST' });
  }

  stopMap(name: string) {
    return this.request<MapStatus>(`/maps/${encodeURIComponent(name)}/stop`, { method: 'POST' });
  }

  restartMap(name: string) {
    return this.request<MapStatus>(`/maps/${encodeURIComponent(name)}/restart`, { method: 'POST' });
  }

  backupMap(name: string) {
    return this.request<{ status: string; map: string; backup_id: string }>(`/maps/${encodeURIComponent(name)}/backup`, { method: 'POST' });
  }

  getPlayers() {
    return this.request<Player[]>('/players');
  }

  getCharacters() {
    return this.request<CharacterRecord[]>('/characters');
  }

  getCharacterStatsSchema() {
    return this.request<CharacterStatsSchema>('/characters/stats-schema');
  }

  getCharacter(id: string) {
    return this.request<CharacterRecord>(`/characters/${encodeURIComponent(id)}`);
  }

  updateCharacter(id: string, updates: Record<string, unknown>) {
    return this.request<CharacterRecord>(`/characters/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ updates }),
    });
  }

  getCharacterInventory(id: string) {
    return this.request<{ character_id: string; inventories: Record<string, { template_id: string; stack_size: number; position_index: number; quality_level: number }[]> }>(`/characters/${encodeURIComponent(id)}/inventory`);
  }

  grantItem(id: string, templateId: string, stackSize: number = 1, qualityLevel: number = 0) {
    return this.request<{ success: boolean; item_id: number; template_id: string; stack_size: number; warning?: string; player_online?: boolean }>(`/characters/${encodeURIComponent(id)}/grant-item`, {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, stack_size: stackSize, quality_level: qualityLevel }),
    });
  }

  grantSolari(id: string, amount: number) {
    return this.request<{ success: boolean; solari_added: number; new_total: number }>(`/characters/${encodeURIComponent(id)}/grant-solari`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
  }

  setHealth(id: string, maxHealth: number) {
    return this.request<CharacterRecord>(`/characters/${encodeURIComponent(id)}/set-health`, {
      method: 'POST',
      body: JSON.stringify({ max_health: maxHealth }),
    });
  }

  teleportCharacter(id: string, x: number, y: number, z: number) {
    return this.request<{ success: boolean; position: { x: number; y: number; z: number } }>(`/characters/${encodeURIComponent(id)}/teleport`, {
      method: 'POST',
      body: JSON.stringify({ x, y, z }),
    });
  }

  searchItemTemplates(search?: string) {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.request<{ templates: { id: string; count: number }[]; total: number }>(`/items/templates${query}`);
  }

  getPlayerPositions() {
    return this.request<PlayerPosition[]>('/players/positions');
  }

  getBases() {
    return this.request<BaseRecord[]>('/maps/bases');
  }

  getVehicles(mapName: string) {
    return this.request<VehicleRecord[]>(`/maps/${encodeURIComponent(mapName)}/vehicles`);
  }

  teleportVehicle(mapName: string, actorId: number, targetX: number, targetY: number, targetZ?: number) {
    return this.request<VehicleTeleportResponse>(`/maps/${encodeURIComponent(mapName)}/teleport-vehicle`, {
      method: 'POST',
      body: JSON.stringify({
        actor_id: actorId,
        target_x: targetX,
        target_y: targetY,
        ...(targetZ !== undefined ? { target_z: targetZ } : {}),
      }),
    });
  }

  kickPlayer(steamId: string, reason?: string) {
    return this.request<{ status: string; steamId: string; message: string }>('/players/kick', {
      method: 'POST',
      body: JSON.stringify({ steamId, reason: reason ?? 'Kicked by admin' }),
    });
  }

  banPlayer(steamId: string, reason: string, duration?: number) {
    return this.request<BanEntry>('/players/bans', {
      method: 'POST',
      body: JSON.stringify({ steamId, reason, duration }),
    });
  }

  unbanPlayer(steamId: string) {
    return this.request<void>(`/players/bans/${encodeURIComponent(steamId)}`, { method: 'DELETE' });
  }

  getBans() {
    return this.request<BanEntry[]>('/players/bans');
  }

  getAllowlist() {
    return this.request<AllowlistEntry[]>('/players/allowlist');
  }

  addAllowlist(steamId: string, playerName?: string) {
    return this.request<AllowlistEntry>('/players/allowlist', {
      method: 'POST',
      body: JSON.stringify({ steam_id: steamId, player_name: playerName || null }),
    });
  }

  removeAllowlist(steamId: string) {
    return this.request<{ status: string; steam_id: string }>(`/players/allowlist/${encodeURIComponent(steamId)}`, {
      method: 'DELETE',
    });
  }

  getConnectionHistory(limit = 200) {
    return this.request<ConnectionLogEntry[]>(`/players/connections?limit=${limit}`);
  }

  getConfig(filename: string) {
    return this.request<ConfigFile>(`/config/${encodeURIComponent(filename)}`);
  }

  getConfigDrift() {
    return this.request<{ files: Record<string, ConfigDriftStatus> }>('/config/drift');
  }

  acceptConfigDrift(filename: string) {
    return this.request<{ status: string }>(`/config/${encodeURIComponent(filename)}/accept-drift`, { method: 'POST' });
  }

  updateConfig(filename: string, data: Record<string, unknown>) {
    return this.request<ConfigFile>(`/config/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  getSystemMetrics() {
    return this.request<SystemMetrics>('/system/metrics');
  }

  getSystemHistory(range: string) {
    return this.request<MetricsHistory>(`/system/history?range=${encodeURIComponent(range)}`);
  }

  getUptimeData(range: string) {
    return this.request<UptimeData>(`/system/uptime?range=${encodeURIComponent(range)}`);
  }

  getVersion() {
    return this.request<SystemVersion>('/system/version');
  }

  getBackups() {
    return this.request<BackupEntry[]>('/backups');
  }

  getOverview() {
    return this.request<DashboardOverview>('/dashboard/overview');
  }

  createBackup(scope: string) {
    return this.request<BackupEntry>('/backups', {
      method: 'POST',
      body: JSON.stringify({ scope }),
    });
  }

  restoreBackup(id: string) {
    return this.request<void>(`/backups/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  }

  deleteBackup(id: string) {
    return this.request<void>(`/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  getBackupSchedule() {
    return this.request<BackupSchedule>('/backups/schedule');
  }

  updateBackupSchedule(schedule: Partial<BackupSchedule>) {
    return this.request<BackupSchedule>('/backups/schedule', {
      method: 'PUT',
      body: JSON.stringify(schedule),
    });
  }

  getRestartSchedule() {
    return this.request<RestartSchedule>('/restart/schedule');
  }

  updateRestartSchedule(schedule: Partial<RestartSchedule>) {
    return this.request<RestartSchedule>('/restart/schedule', {
      method: 'PUT',
      body: JSON.stringify(schedule),
    });
  }

  restartNow(warningMinutes = 0) {
    return this.request<RestartNowResponse>('/restart/now', {
      method: 'POST',
      body: JSON.stringify({ warningMinutes }),
    });
  }

  stopServer() {
    return this.request<{ status: string; action: string; succeeded: string[]; failed: { service: string; error: string }[]; total: number }>('/server/stop', { method: 'POST' });
  }

  startServer() {
    return this.request<{ status: string; action: string; succeeded: string[]; failed: { service: string; error: string }[]; total: number }>('/server/start', { method: 'POST' });
  }

  getDiscordWebhooks() {
    return this.request<DiscordWebhook[]>('/discord/webhooks');
  }

  addWebhook(data: Omit<DiscordWebhook, 'id'>) {
    return this.request<DiscordWebhook>('/discord/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateWebhook(id: string, data: Partial<DiscordWebhook>) {
    return this.request<DiscordWebhook>(`/discord/webhooks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteWebhook(id: string) {
    return this.request<void>(`/discord/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  testWebhook() {
    return this.request<{ success: boolean; message?: string }>('/discord/test', { method: 'POST' });
  }

  sendAnnouncement(text: string) {
    return this.request<{ success: boolean; message?: string }>('/discord/announce', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  sendGameAnnouncement(message: string, sender?: string) {
    return this.request<{ success: boolean; message: string }>('/announce', {
      method: 'POST',
      body: JSON.stringify({ message, sender }),
    });
  }

  sendPreRestartWarning(minutes: number = 5) {
    return this.request<{ success: boolean }>('/announce/pre-restart', {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    });
  }

  getAnnouncementHistory() {
    return this.request<AnnouncementHistoryEntry[]>('/announce/history');
  }

  getScheduledAnnouncements() {
    return this.request<ScheduledAnnouncement[]>('/announce/scheduled');
  }

  createScheduledAnnouncement(data: ScheduledAnnouncementMutation) {
    return this.request<ScheduledAnnouncement>('/announce/scheduled', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateScheduledAnnouncement(id: string, data: ScheduledAnnouncementMutation) {
    return this.request<ScheduledAnnouncement>(`/announce/scheduled/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteScheduledAnnouncement(id: string) {
    return this.request<void>(`/announce/scheduled/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  toggleScheduledAnnouncement(id: string) {
    return this.request<ScheduledAnnouncement>(`/announce/scheduled/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
  }

  getWisdomPool() {
    return this.request<{ quotes: string[]; total: number }>('/announce/wisdom/pool');
  }

  setupWisdomScheduler(data: { interval_minutes?: number; sender?: string; enabled?: boolean }) {
    return this.request<{ success: boolean; announcement: ScheduledAnnouncement }>('/announce/wisdom/setup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  sendRandomWisdom() {
    return this.request<{ success: boolean; quote: string }>('/announce/wisdom/send', { method: 'POST' });
  }

  getChatGuardSettings() {
    return this.request<ChatGuardSettings>('/chat-guard/settings');
  }

  getChatGuardViolations() {
    return this.request<ChatGuardViolation[]>('/chat-guard/violations');
  }

  clearChatGuardViolations() {
    return this.request<{ status: string; message: string }>('/chat-guard/violations', { method: 'DELETE' });
  }

  getEconomySummary() {
    return this.request<EconomySummary>('/economy/summary');
  }

  getEconomyAlerts() {
    return this.request<EconomyAlert[]>('/economy/alerts');
  }

  acknowledgeAlert(alertId: string) {
    return this.request<{ status: string }>(`/economy/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
      method: 'POST',
    });
  }

  createEconomyAlert(data: ManualEconomyAlertRequest) {
    return this.request<EconomyAlert>('/economy/alerts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getWatchdogStatus() {
    return this.request<WatchdogStatus>('/watchdog/status');
  }

  getWatchdogCrashes() {
    return this.request<WatchdogCrashEvent[]>('/watchdog/crashes');
  }

  restartService(service: string) {
    return this.request<{ status: string; service: string; restarted: boolean }>(`/watchdog/restart/${encodeURIComponent(service)}`, { method: 'POST' });
  }

  startService(name: string) {
    return this.request<{ service: string; action: string }>(`/services/${encodeURIComponent(name)}/start`, { method: 'POST' });
  }

  stopService(name: string) {
    return this.request<{ service: string; action: string }>(`/services/${encodeURIComponent(name)}/stop`, { method: 'POST' });
  }

  restartServiceDirect(name: string) {
    return this.request<{ service: string; action: string }>(`/services/${encodeURIComponent(name)}/restart`, { method: 'POST' });
  }

  getLogStreamUrl() {
    return `${this.baseUrl}/logs/stream`;
  }

  async getServices(): Promise<ServiceStatus[]> {
    const overview = await this.getStatus();
    return overview.services ?? [];
  }

  getServiceLogs(service: string, tail = 200) {
    return this.request<{ service: string; entries: Array<Record<string, string>> }>(`/logs/${encodeURIComponent(service)}?tail=${tail}`);
  }

  // Settings
  getSettings() {
    return this.request<Record<string, Record<string, unknown>>>('/settings');
  }

  // Server password toggle
  getServerPassword() {
    return this.request<{ enabled: boolean; hasPassword: boolean }>('/server/password');
  }

  setServerPassword(enabled: boolean, password?: string) {
    return this.request<{ enabled: boolean; restarted: string[]; status: string }>('/server/password', {
      method: 'PUT',
      body: JSON.stringify({ enabled, ...(password !== undefined ? { password } : {}) }),
    });
  }

  // Server identity (world name + broadcast address)
  getServerIdentity() {
    return this.request<{ worldName: string; externalAddress: string }>('/server/identity');
  }

  updateServerIdentity(payload: { worldName?: string; externalAddress?: string }) {
    return this.request<{ worldName: string | null; externalAddress: string | null; restarted: string[]; status: string }>('/server/identity', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  getSettingsSection(section: string) {
    return this.request<Record<string, unknown>>(`/settings/${encodeURIComponent(section)}`);
  }

  updateSettingsSection(section: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/settings/${encodeURIComponent(section)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  exportSettings() {
    return this.request<{ version: number; exportedAt: string; settings: Record<string, unknown> }>('/settings/export/all');
  }

  importSettings(payload: { version: number; settings: Record<string, unknown> }) {
    return this.request<{ status: string; imported: string[] }>('/settings/import/all', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getAdmins() {
    return this.request<Array<{ id: number; username: string; role: string; enabled: boolean; createdAt: string | null; lastLogin: string | null }>>('/settings/admins');
  }

  addAdmin(username: string, role?: string) {
    return this.request<{ id: number; username: string; role: string; enabled: boolean } | { error: string }>('/settings/admins', {
      method: 'POST',
      body: JSON.stringify({ username, role }),
    });
  }

  removeAdmin(adminId: number) {
    return this.request<{ status: string; removed: string }>(`/settings/admins/${adminId}`, { method: 'DELETE' });
  }

  updateAdmin(adminId: number, data: { role?: string; enabled?: boolean }) {
    return this.request<{ id: number; username: string; role: string; enabled: boolean }>(`/settings/admins/${adminId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Resource Tuning
  getResourceLimits() {
    return this.request<{
      resources: Array<{
        key: string;
        label: string;
        description: string;
        category: string;
        value: string;
        default: string;
        options: Array<{ value: string; label: string }>;
      }>;
      envFile: string;
      requiresRestart: boolean;
    }>('/system/resources');
  }

  updateResourceLimits(values: Record<string, string>) {
    return this.request<{ status: string; changed: string[]; message: string }>('/system/resources', {
      method: 'PUT',
      body: JSON.stringify({ values }),
    });
  }

  // Graceful host shutdown
  prepareShutdown(payload: { warning_minutes: number; skip_backup?: boolean; stop_game_servers?: boolean }) {
    return this.request<{ status: string; warning_minutes: number; message: string }>('/system/prepare-shutdown', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getShutdownStatus() {
    return this.request<{
      phase: string;
      started_at?: string;
      warning_minutes?: number;
      details?: Array<{ ts: string; msg: string }>;
      error?: string;
    }>('/system/shutdown-status');
  }

  // Update checking
  getUpdateStatus() {
    return this.request<{
      current_tag: string;
      current_build: string | null;
      latest_build: string | null;
      update_available: boolean;
      last_check: string | null;
      auto_update_enabled: boolean;
      check_interval_hours: number;
      steam_app_id: string;
    }>('/updates/status');
  }

  checkForUpdates() {
    return this.request<{
      success: boolean;
      current_build: string | null;
      latest_build: string | null;
      update_available: boolean;
      current_tag: string | null;
      last_check: string | null;
      steam_app_id: string | null;
      error?: string;
    }>('/updates/check', { method: 'POST' });
  }

  markUpdateAsCurrent() {
    return this.request<{
      success: boolean;
      baseline_build?: string;
      message?: string;
      error?: string;
    }>('/updates/mark-current', { method: 'POST' });
  }

  triggerUpdate() {
    return this.request<{
      status: string;
      message?: string;
      success?: boolean;
      error?: string;
    }>('/updates/trigger', { method: 'POST' });
  }

  getTriggerStatus() {
    return this.request<{
      status: 'idle' | 'running' | 'done' | 'failed';
      result?: { success: boolean; new_tag?: string; restarted?: string[]; error?: string };
      error?: string;
    }>('/updates/trigger/status');
  }

  getUpdateHostInfo() {
    return this.request<{ ssh_user: string; ssh_host: string; server_dir: string }>('/updates/host-info');
  }

  setAutoUpdate(enabled: boolean) {
    return this.request<{ auto_update_enabled: boolean }>('/updates/settings', {
      method: 'POST',
      body: JSON.stringify({ auto_update_enabled: enabled }),
    });
  }
}

export const apiClient = new ApiClient();
