import {
  BackupEntry,
  ConfigFile,
  DiscordWebhook,
  BanEntry,
  MapStatus,
  MetricsHistory,
  Player,
  ReadinessStatus,
  ServerOverview,
  SystemMetrics,
} from '@/lib/types';

const DEFAULT_BASE_URL = '/api';

function resolveBaseUrl() {
  const explicitBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (explicitBase) {
    return explicitBase.replace(/\/$/, '');
  }

  return DEFAULT_BASE_URL;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly adminToken?: string;

  constructor(baseUrl = resolveBaseUrl(), adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN) {
    this.baseUrl = baseUrl;
    this.adminToken = adminToken;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    if (!(init?.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.adminToken) {
      headers.set('X-Admin-Token', this.adminToken);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed with status ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
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

  getPlayers() {
    return this.request<Player[]>('/players');
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

  getConfig(filename: string) {
    return this.request<ConfigFile>(`/config/${encodeURIComponent(filename)}`);
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

  getBackups() {
    return this.request<BackupEntry[]>('/backups');
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

  getLogStreamUrl() {
    return `${this.baseUrl}/logs/stream`;
  }
}

export const apiClient = new ApiClient();
