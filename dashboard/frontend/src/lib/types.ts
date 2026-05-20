export type HealthState = 'healthy' | 'degraded' | 'offline' | 'starting' | 'stopped';
export type MapState = 'running' | 'stopped' | 'error' | 'starting' | 'stopping';
export type FieldType = 'string' | 'number' | 'boolean' | 'select' | 'textarea';
export type Severity = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface ServiceStatus {
  name: string;
  label?: string;
  status: HealthState;
  uptimeSeconds?: number;
  latencyMs?: number;
  message?: string;
  port?: number;
  lastCheck?: string;
}

export interface ServerOverview {
  serverName: string;
  region?: string;
  status: HealthState;
  uptimeSeconds: number;
  playersOnline: number;
  mapsActive: number;
  maxPlayers?: number;
  version?: string;
  services: ServiceStatus[];
}

export interface MapStatus {
  name: string;
  status: MapState;
  players: number;
  maxPlayers?: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
  cpuPercent?: number;
  uptimeSeconds?: number;
  settings?: Record<string, string | number | boolean | null>;
  notes?: string;
}

export interface Player {
  name: string;
  steamId: string;
  steam_id?: string;
  map: string;
  map_name?: string | null;
  sessionSeconds: number;
  pingMs?: number;
  clan?: string;
  position?: {
    x?: number | null;
    y?: number | null;
    z?: number | null;
  } | null;
  x?: number | null;
  y?: number | null;
}

export interface BanEntry {
  steamId: string;
  playerName?: string;
  reason: string;
  durationHours?: number | null;
  bannedAt: string;
  expiresAt?: string | null;
  active: boolean;
}

export interface ConfigField {
  key: string;
  label: string;
  section: string;
  type: FieldType;
  value: string | number | boolean;
  description?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}

export interface ConfigFile {
  filename: string;
  title: string;
  description?: string;
  fields: ConfigField[];
}

export interface SystemMetrics {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  diskPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
  networkInMbps: number;
  networkOutMbps: number;
  uptimeSeconds: number;
}

export interface MetricsPoint {
  timestamp: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  networkInMbps: number;
  networkOutMbps: number;
}

export interface MetricsHistory {
  range: string;
  points: MetricsPoint[];
}

export interface BackupEntry {
  id: string;
  name: string;
  scope: 'full' | 'configs' | 'save-data' | 'database';
  status: 'ready' | 'running' | 'failed';
  sizeBytes: number;
  createdAt: string;
  createdBy?: string;
}

export interface BackupSchedule {
  enabled: boolean;
  cron: string;
  retentionDays: number;
}

export interface DiscordEventRecord {
  id: string;
  event: string;
  status: 'sent' | 'failed' | 'queued';
  createdAt: string;
  message: string;
}

export interface DiscordWebhook {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  events: string[];
  isHealthy?: boolean;
  lastTriggeredAt?: string | null;
  recentEvents?: DiscordEventRecord[];
}

export interface ReadinessCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message?: string;
}

export interface ReadinessStatus {
  status: 'ok' | 'warn' | 'fail';
  timestamp: string;
  checks: ReadinessCheck[];
}

export interface LogEvent {
  id: string;
  timestamp: string;
  service: string;
  level: Severity;
  message: string;
}
