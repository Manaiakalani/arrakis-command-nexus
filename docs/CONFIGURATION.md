# Configuration Reference

All environment variables, config files, deployment profiles, and dashboard settings for the Dune Awakening self-hosted stack.

## Environment Variables

Copy `.env.example` to `.env`, then edit values to match your host.

### Server Identity

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORLD_NAME` | `My Dune Awakening Server` | Friendly server name shown to players. Used as the default display name for all partitions unless overridden. |
| `WORLD_UNIQUE_NAME` | `sh-my-dune-server` | Unique battlegroup identifier used across services. |
| `FLS_SECRET` | blank | Funcom Live Services token. Prefer `secrets/funcom-token.txt` instead of inline values. |
| `DUNE_FLS_ENV` | `retail` | FLS environment. Use `retail` for live servers, `beta` for public test. |
| `DUNE_SERVER_LOGIN_PASSWORD` | blank | Optional join password for the battlegroup. Applies to all partitions. Passwords with spaces are not supported. |
| `SURVIVAL_DISPLAY_NAME` | blank | Display name for the Survival partition (Hagga Basin, etc.). Overrides `WORLD_NAME` for that partition. |
| `OVERMAP_DISPLAY_NAME` | blank | Display name for the Overmap partition (Sietch Tabr, etc.). Overrides `WORLD_NAME` for that partition. |
| `WORLD_REGION` | `North America` | Region name shown to players and reported to FLS. |
| `WORLD_DATACENTER_ID` | `North America` | Datacenter identifier reported to FLS. |

### Authentication Secrets

| Variable | Default | Purpose |
| --- | --- | --- |
| `DUNE_SERVER_LOGIN_PASSWORD_SECRET` | blank | 32-byte hex secret for BackendLogin player authentication. Generate with `openssl rand -hex 32`. Must match across director and game servers. |
| `DUNE_USERNAME_SERVER_LOGIN_SECRET` | blank | 32-byte hex secret for username-based server login. Generate with `openssl rand -hex 32`. Must match across director and game servers. |
| `DUNE_LOGIN_PASSWORD_SKEW_SECONDS` | `300` | Allowed clock skew in seconds for login password validation. |

### Network Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `EXTERNAL_ADDRESS` | `auto` | Public IP or hostname advertised to players. |
| `GAME_RMQ_PUBLIC_HOST` | `auto` | Public hostname/IP for the game-facing RabbitMQ endpoint. |
| `GAME_RMQ_PUBLIC_PORT` | `31982` | Public TCP port for game RabbitMQ traffic. |
| `GAME_PORT_START` | `7777` | Documentation reference for the first UDP gameplay port. |
| `S2S_PORT_START` | `7888` | Documentation reference for the first UDP server-to-server port. |

### Deployment and Images

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEPLOYMENT_PROFILE` | `basic` | Selects `basic`, `standard-lean`, `standard`, or `full` compose overlays. |
| `DUNE_IMAGE_TAG` | `2007976-0-shipping` | Funcom server image tag. Updated by `dune update`. |
| `STEAM_APP_ID` | `4754530` | Steam App ID for update checks. Use `4754530` (retail) or `3104830` (PTC). Must match your players' client. |
| `DUNE_STEAM_SERVER_DIR` | `./steam` | Local directory containing extracted Steam payloads. |

### Database

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_SUPER_PASSWORD` | `change-me-postgres-super` | Superuser password for the local PostgreSQL container. |
| `POSTGRES_DUNE_PASSWORD` | `change-me-dune-db` | Application database password used by Dune services and dashboard API. |
| `POSTGRES_PORT` | `15432` | Host port for PostgreSQL, intentionally bound to localhost in compose. |

### RabbitMQ

| Variable | Default | Purpose |
| --- | --- | --- |
| `RMQ_HTTP_TOKEN_AUTH_SECRET` | blank | Shared secret for the RMQ HTTP auth backend. Generate with `openssl rand 64 \| base64 -w 0`. |
| `DUNE_RMQ_MANAGEMENT_USER` | blank | Optional management UI username for game-rmq. |
| `DUNE_RMQ_MANAGEMENT_PASSWORD` | blank | Optional management UI password for game-rmq. |

### Dashboard and API

| Variable | Default | Purpose |
| --- | --- | --- |
| `DUNE_ADMIN_TOKEN` | `change-me-admin-token` | Required admin token for authenticated dashboard API requests. |
| `DUNE_ADMIN_MUTATIONS_ENABLED` | `false` | Enables dangerous admin write actions when set to `true`. |
| `DUNE_ADMIN_BIND_ADDRESS` | `127.0.0.1` | Host bind address for the dashboard frontend. Keep it local-only unless you need LAN or WAN access. |
| `DUNE_ADMIN_HOST_PORT` | `18080` | Host port for the dashboard UI and API. |
| `DUNE_ADMIN_ALLOWED_HOSTS` | `127.0.0.1:18080,localhost:18080` | Allowed dashboard origins for CORS, such as `your-server-ip:18080` or `dashboard.your-domain.com`. |
| `DUNE_DASHBOARD_DB_URL` | `sqlite+aiosqlite:///dashboard.db` | SQLite connection URL for dashboard settings (webhooks, schedules). Persisted at `./dashboard-data/` via bind mount. |

### Discord Notifications

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | blank | Discord webhook endpoint for notifications. |
| `DISCORD_NOTIFY_START` | `true` | Notify on stack or map start events. |
| `DISCORD_NOTIFY_STOP` | `true` | Notify on stop events. |
| `DISCORD_NOTIFY_CRASH` | `true` | Notify on crash/failure events. |
| `DISCORD_NOTIFY_PLAYER_JOIN` | `false` | Notify when players join. |
| `DISCORD_NOTIFY_PLAYER_LEAVE` | `false` | Notify when players leave. |

### Backups

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKUP_DIR` | `./backups` | Backup target directory on the host. |
| `BACKUP_RETENTION_DAYS` | `30` | Retention policy for backup cleanup. |
| `BACKUP_SCHEDULE_ENABLED` | `false` | Turns scheduled backups on or off. |
| `BACKUP_SCHEDULE_INTERVAL_HOURS` | `24` | Backup cadence when scheduling is enabled. |

### Memory Limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEM_LIMIT_SURVIVAL` | `16g` | Container memory limit for Survival shards. |
| `MEM_LIMIT_OVERMAP` | `3g` | Container memory limit for Overmap. |
| `MEM_LIMIT_DEEP_DESERT` | `16g` | Container memory limit for Deep Desert shards. |
| `MEM_LIMIT_DEFAULT_MAP` | `3g` | Container memory limit for social hubs and story maps. |
| `MEM_LIMIT_POSTGRES` | `1g` | PostgreSQL container limit. |
| `MEM_LIMIT_RMQ` | `1g` | RabbitMQ container limit. Must be >= 1g to avoid `system_memory_high_watermark` alarms during traffic spikes (player travel events) that block publishers and cause P83 on the client. |
| `MEM_LIMIT_DIRECTOR` | `512m` | Director container limit. |
| `MEM_LIMIT_TEXT_ROUTER` | `256m` | Text router container limit. |
| `MEM_LIMIT_GATEWAY` | `256m` | Gateway container limit. |

### Advanced Runtime Overrides

These are not part of the default `.env.example` but are supported when you need deeper control.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DUNE_LOG_LEVEL` | `INFO` | Backend API log verbosity. |
| `DUNE_METRICS_INTERVAL` | `60` | Metrics collection interval in seconds. |
| `DUNE_METRICS_RETENTION` | `43200` | Maximum number of retained metric snapshots (30 days at 60-second sampling). |
| `DUNE_ADMIN_FRONTEND_DIR` | frontend dist path | Overrides the backend's static frontend directory. |
| `DUNE_FUNCOM_POSTGRES_DSN` | blank | Explicit DSN for the Funcom player telemetry database. |
| `DUNE_POSTGRES_DSN` | blank | Alternate DSN name accepted by the backend player service. |
| `NEXT_PUBLIC_API_BASE_URL` | `/api` | Frontend override for dashboard API base URL. |
| `NEXT_PUBLIC_ADMIN_TOKEN` | blank | Optional frontend token injection for trusted local admin environments. |

### World and Partition Overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `SURVIVAL_RESET_SEED` | blank | When set, `survival-pre-start.sh` forces the `world_partition_reset_seed`, `world_map_reset_seed`, and `world_farm_reset_seed` tables to this value both before the game server starts (closing the storm-reset race) and via a background backstop loop afterward. The `seed-guardian` sidecar also pins it continuously. Required after restoring backup data to prevent "A storm has reset the map" from hiding buildings on every server restart. Typical value: `1`. See [Troubleshooting](./TROUBLESHOOTING.md#a-storm-has-reset-the-map--missing-buildings). |
| `SEED_GUARD_INTERVAL` | `300` | How often (seconds) the `seed-guardian` sidecar re-pins the world reset seed to `SURVIVAL_RESET_SEED`. Only has effect when `SURVIVAL_RESET_SEED` is set. |
| `STEAM_APP_ID` | `4754530` | Steam application ID for update checks. Use `4754530` for retail (production) or `3104830` for PTC (test). **Do not mix these** or the server will be invisible to players. |

## Config Files

### Per-Partition Display Names

Each partition (Survival, Overmap) can have its own name in the server browser. Set these in `.env`:

```bash
SURVIVAL_DISPLAY_NAME=Hagga Basin
OVERMAP_DISPLAY_NAME=Sietch Tabr
```

**Why these exist:** The UE5 `-ini:engine:[ConsoleVariables]:Bgd.ServerDisplayName=` command-line
argument splits on spaces, so multi-word names are silently truncated to the first word. Instead,
`scripts/survival-pre-start.sh` writes the display name directly into `UserEngine.ini` before the
game binary starts.

**UE5 per-map SavedDir behaviour:** Each map binary reads its user configuration from two
locations under the container's `Saved/` directory:

1. `Saved/UserSettings/UserEngine.ini` -- root-level (read by Survival_1)
2. `Saved/<MapName>/UserSettings/UserEngine.ini` -- map-specific subdirectory (read by Overmap)

The pre-start script writes to both locations on every startup, so changes to
`SURVIVAL_DISPLAY_NAME` or `OVERMAP_DISPLAY_NAME` take effect on the next container restart.

**Volume layout (basic profile):**

| Partition | Host path | Container mount |
|---|---|---|
| Survival_1 | `data/survival-saved/` | `/home/dune/server/DuneSandbox/Saved` |
| Overmap | `data/server-saved/overmap/` | `/home/dune/server/DuneSandbox/Saved` |

Separate host directories are required so each partition gets its own independent `UserSettings/`
tree. Without this, both containers would write to the same ini file and whichever started last
would overwrite the other's name.

> **Adding a third partition:** Create `data/<new-partition-saved>/` (use the
> `docker run --rm -v /path/to/data:/data alpine sh -c 'mkdir -p /data/new-dir'` trick --
> the `data/` directory is root-owned), add a `PARTITION_DISPLAY_NAME` env var in the compose
> override, and mount the new directory to the same container path.

### `config/UserGame.ini`

Global gameplay settings that apply across the battlegroup, including PvP forcing, security zones, storm automation, reconnect grace period, landclaim limits, and base backup timing.

### `config/UserEngine.ini`

Engine and network tuning, such as `NetServerMaxTickRate`, `MaxClientRate`, and `MaxInternetClientRate`.

### `config/director.ini`

Controls instancing behavior and per-map player caps. This is where you switch maps between `SingleServer`, `Dimension`, and `ClassicalInstancing`, and where you tune hard caps for Overmap, Survival, and Deep Desert.

### `config/gateway.ini`

Controls how the battlegroup registers with Funcom services, including visible region and provider labels.

## Deployment Profiles

| Profile | Compose overlay | Intended use | Recommended RAM |
| --- | --- | --- | --- |
| `basic` | `docker-compose.basic.yml` | Minimal playable battlegroup with Overmap and one Survival shard | ~20 GB |
| `standard` | `docker-compose.standard.yml` | Adds Deep Desert, social hubs, and story maps | ~30-40 GB |
| `full` | `docker-compose.full.yml` | Large battlegroup with multiple extra Survival/Deep Desert/story instances | ~40 GB+ |

## Memory Planning by Profile

| Profile | Suggested host RAM | Notes |
| --- | --- | --- |
| `basic` | 20 GB | Leaves room for Docker overhead, OS cache, dashboard, and saves. |
| `standard` | 30-40 GB | Better suited for always-on communities and more concurrent players. |
| `full` | 40 GB+ | Plan for aggressive scaling, backups, and peak usage headroom. |

## Dashboard Configuration

The dashboard is served by the Next.js frontend container on `DUNE_ADMIN_BIND_ADDRESS:DUNE_ADMIN_HOST_PORT`. The backend API runs as a separate container and is reached via Next.js rewrites.

- The backend API authenticates requests via the `X-Admin-Token` header using `DUNE_ADMIN_TOKEN`.
- CORS origins are controlled with `DUNE_ADMIN_ALLOWED_HOSTS`.
- Keep the bind address on `127.0.0.1` unless you are intentionally exposing the dashboard to a trusted LAN.
