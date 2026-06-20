export type HealthState = 'healthy' | 'degraded' | 'offline' | 'starting' | 'stopped' | 'completed';
export type MapState = 'running' | 'stopped' | 'completed' | 'error' | 'starting' | 'stopping';
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
  isInit?: boolean;
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

export interface PlayerPosition {
  name: string;
  steamId: string;
  map: string;
  x: number | null;
  y: number | null;
  z: number | null;
  sessionSeconds: number;
}

export interface BaseRecord {
  id: number;
  owner_id: number | null;
  owner_name: string | null;
  x: number;
  y: number;
  z: number;
  partition_id: number;
  piece_count: number;
}

export interface VehicleRecord {
  actor_id: number;
  class_name: string;
  vehicle_type: string;
  x: number;
  y: number;
  z: number;
  owner_player_id_if_any: number | string | null;
  last_seen_at: string | null;
  map_name?: string | null;
}

export interface VehicleTeleportResponse {
  ok: true;
  prev_transform: string;
  new_transform: string;
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
  z?: number | null;
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

export interface AllowlistEntry {
  steamId: string;
  playerName?: string | null;
  addedAt?: string | null;
}

export interface ConnectionLogEntry {
  id: number;
  steamId: string;
  playerName?: string | null;
  event: 'connect' | 'disconnect';
  mapName?: string | null;
  timestamp: string;
}

export interface ConfigField {
  key: string;
  label: string;
  section: string;
  type: FieldType;
  value: string | number | boolean;
  description?: string;
  placeholder?: string;
  defaultValue?: string | null;
  minValue?: string | null;
  maxValue?: string | null;
  options?: Array<{ label: string; value: string }>;
}

export interface ConfigDriftStatus {
  drifted: boolean;
  baselineHash: string;
  currentHash: string;
  detectedAt: string | null;
}

export interface ConfigFile {
  filename: string;
  title: string;
  subtitle?: string;
  description?: string;
  fields: ConfigField[];
  drift?: ConfigDriftStatus;
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

export interface UptimePoint {
  timestamp: string;
  status: 'up' | 'down' | 'degraded';
  durationSeconds: number;
}

export interface UptimeData {
  range: string;
  availabilityPercent: number;
  totalUpSeconds: number;
  totalDownSeconds: number;
  events: UptimePoint[];
}

export interface SystemVersion {
  version: string;
  profile: string;
  environment: string;
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
  intervalHours: number;
  retentionDays: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  cron?: string;
}

export interface RestartSchedule {
  enabled: boolean;
  intervalHours: number;
  warningMinutes: number[];
  lastRestartAt?: string | null;
  nextRestartAt?: string | null;
}

export interface RestartNowResponse {
  status: 'ok' | 'partial' | 'failed';
  trigger: 'manual' | 'scheduled';
  warningMinutes: number;
  startedAt?: string | null;
  restartAt?: string | null;
  services: string[];
  backupId?: string | null;
  backupError?: string | null;
  errors?: Record<string, string>;
  scheduled?: boolean;
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

export interface AnnouncementHistoryEntry {
  message: string;
  sender: string;
  timestamp: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
}

export interface ScheduledAnnouncement {
  id: string;
  message: string;
  sender: string;
  interval_minutes?: number | null;
  next_run_at?: string | null;
  enabled: boolean;
  one_shot: boolean;
  created_at: string;
}

export interface ScheduledAnnouncementMutation {
  message?: string;
  sender?: string;
  interval_minutes?: number;
  run_at?: string;
  enabled?: boolean;
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

export interface WatchdogStatus {
  enabled: boolean;
  autoRestart: boolean;
  intervalSeconds: number;
  monitoredContainers: number;
}

export interface WatchdogCrashEvent {
  service: string;
  timestamp: string;
  exitCode?: number | null;
  restarted: boolean;
  message: string;
}

export interface EconomySummary {
  enabled: boolean;
  checkIntervalSeconds: number;
  solariThreshold: number;
  baseClaimThreshold: number;
  totalAlerts: number;
  unacknowledgedAlerts: number;
}

export interface EconomyAlert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
  acknowledged: boolean;
}

export interface ManualEconomyAlertRequest {
  type?: string;
  severity?: 'info' | 'warning' | 'critical';
  message: string;
  details?: Record<string, unknown> | null;
}

export interface ChatGuardSettings {
  enabled: boolean;
  maxConsecutive: number;
  rateWindowSeconds: number;
  rateMaxMessages: number;
  autoKick: boolean;
  totalViolations: number;
}

export interface ChatGuardViolation {
  steamId: string;
  playerName: string;
  type: 'consecutive_duplicate' | 'rate_limit' | 'pattern_match';
  message: string;
  action: 'warned' | 'muted' | 'kicked';
  timestamp: string;
}

export interface CharacterStatField {
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean';
  category: 'stats' | 'spice' | 'economy' | 'specialization';
}

export interface CharacterSummary {
  mutationsEnabled: boolean;
  editableStats: number;
  categories: CharacterStatField['category'][];
}

export interface CharacterRecord {
  id: string;
  name: string;
  source?: string;
  table?: string;
  lastUpdated?: string | null;
  stats: Record<string, number | string | boolean | null>;
  metadata?: Record<string, unknown>;
}

export interface CharacterStatsSchema {
  stats: CharacterStatField[];
  summary: CharacterSummary;
}
