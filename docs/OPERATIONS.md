# Operations Runbook

Practical operating procedures for Arrakis Command Nexus, the Docker-based self-hosted Dune Awakening server stack and companion dashboard.

## Quick Reference

### Start, stop, and restart the full stack

```bash
docker compose up -d
docker compose stop
docker compose restart
```

### Restart only the game server layer

> **FLS server ID warning:** Every game server restart generates a new server ID registered with
> Funcom Live Services. Old IDs linger as ghost entries in the server browser for 12-24 hours.
> Batch your changes and restart once rather than iterating repeatedly.

Restart a single shard or map service:

```bash
docker compose restart overmap
docker compose restart survival_1
```

To restart several map services together:

```bash
docker compose restart overmap survival_1 deep_desert_1
```

> **Environment variable changes:** `docker compose restart` does NOT re-read `.env`. If you
> changed `.env` (display names, passwords, image tags), you must use `docker compose up -d`
> to recreate the container with the new environment.

### Restart only the dashboard

```bash
docker compose restart dashboard-api dashboard-frontend
```

If only the API is stuck, restart just that container:

```bash
docker compose restart dashboard-api
```

### Check service health

List running containers first:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

If you need exact restart counts, inspect the affected container:

```bash
docker inspect -f '{{.Name}} restart_count={{.RestartCount}} exit_code={{.State.ExitCode}}' <container>
```

Run the quick smoke test:

```bash
bash scripts/smoke-test.sh --quick
```

Capture a capacity snapshot before and after incidents or scaling changes:

```bash
./dune snapshot
./dune snapshot --json
```

Text snapshots are written to `snapshots/snapshot-<UTC-timestamp>.txt`. The JSON form prints structured data to stdout and does not write a file.

Check dashboard API health:

```bash
curl http://localhost:18080/api/health
curl http://localhost:18080/api/status
```

If read auth is required in your environment:

```bash
curl -H "X-Admin-Token: $DUNE_ADMIN_TOKEN" http://localhost:18080/api/status
```

## Character transfers (1.4.0.1+ behavior change)

> [!WARNING]
> Starting with Funcom hotfix 1.4.0.1, self-hosted character transfers are moves, not copies.
> When a player transfers a character to this server, Funcom deletes the origin character from its previous server.
> Do not advertise transfers as safe copies.

### Pre-transfer announcement template

```text
Heads up before character transfers: Funcom now treats self-hosted transfers as moves, not copies. If you transfer a character to this server, the origin character will be deleted from the previous server. Only transfer if you are ready to make this server that character's new home. If you are unsure, wait and ask an admin before starting the transfer.
```

## Incident Response Checklists

### Server Won't Start / Crash-Loop

1. Check container state with `docker ps`, then inspect the exact restart count on the crashing container.
   ```bash
   docker ps --format "table {{.Names}}\t{{.Status}}"
   docker inspect -f '{{.Name}} restart_count={{.RestartCount}} exit_code={{.State.ExitCode}}' <container>
   ```
2. Inspect the last logs from the crashing container.
   ```bash
   docker logs --tail 50 <container>
   ```
3. Look for `Local partition is not found`.
4. If present, treat it as a partition assignment failure.
   - The game binary generates a new `server_id` on every startup.
   - That `server_id` must be written to `world_partition` within about 5 seconds.
   - `scripts/survival-pre-start.sh` normally parses the startup log, waits for `farm_state`, and inserts the partition automatically.
5. If the pre-start flow did not recover it, run partition repair manually.
   ```bash
   docker compose run --rm partition-repair
   ```
6. Check for ghost entries in `farm_state` and remove stale rows.
7. Check `world_partition` for stale `server_id` values. The active row should match the current server.
8. Restart the affected shard after cleanup.
   ```bash
   docker compose restart overmap
   ```

Useful PostgreSQL checks:

```sql
SELECT server_id, map, alive, ready FROM dune.farm_state ORDER BY map, server_id;
SELECT server_id, map, dimension_index FROM dune.world_partition ORDER BY map, dimension_index;
```

Delete stale rows only after confirming they belong to dead instances:

```sql
DELETE FROM dune.farm_state WHERE server_id = '<stale_server_id>';
DELETE FROM dune.world_partition WHERE server_id = '<stale_server_id>';
```

### Crafting/Refinery Glitches

Symptoms include paused refineries, timers extending, or crafting progress moving backward.

1. Check live container resource usage.
   ```bash
   docker stats
   ```
2. If CPU is above 100 percent or memory is above 85 percent, treat it as resource starvation.
3. Check whether `overmap` is crash-looping and consuming CPU or memory on every restart.
4. Stop the offending container if needed.
   ```bash
   docker compose stop overmap
   ```
5. Increase `MEM_LIMIT_<SERVICE>` in `.env`.
6. Recreate the affected service with the new limit.
   ```bash
   docker compose up -d overmap
   ```
7. Re-check `docker stats` after the restart.

### Dashboard Shows Offline

1. Confirm the dashboard API container is running and healthy.
   ```bash
   docker ps --filter name=dashboard-api
   docker inspect -f '{{.State.Health.Status}}' dune-awakening-dashboard-api-1
   ```
2. Check the API container logs.
   ```bash
   docker logs --tail 50 dune-awakening-dashboard-api-1
   ```
3. Query the API directly.
   ```bash
   curl http://localhost:18080/api/health
   curl http://localhost:18080/api/status
   ```
4. The API reconnects to `docker-socket-proxy` automatically, but restart `dashboard-api` if it appears stuck.
   ```bash
   docker compose restart dashboard-api
   ```
5. If the API is healthy but the UI is still down, restart `dashboard-frontend` too.

### OOM-Killed Container

1. Watch for the Discord watchdog alert containing `OOM-killed`.
2. Confirm recent memory pressure.
   ```bash
   docker stats
   ```
3. Increase the matching `MEM_LIMIT_<SERVICE>` value in `.env`.
4. Recreate the service so Docker applies the new limit.
   ```bash
   docker compose up -d <service>
   ```
5. Monitor the service for several minutes after restart.

### Announcements Not Delivering

1. Check `text-router` logs for `NullReferenceException`.
   ```bash
   docker logs --tail 50 dune-awakening-text-router-1
   ```
2. Verify the RabbitMQ intercept path is draining and `queue.intercept` has 0 pending messages.
3. Confirm the dashboard API is publishing announcements with the required AMQP properties:
   - `reply_to`
   - `app_id`
   - `headers`
4. If needed, restart `text-router` and `dashboard-api`.
   ```bash
   docker compose restart text-router dashboard-api
   ```

## Maintenance

### Backups

#### Manual trigger

Use the dashboard Backups page or run the helper directly:

```bash
bash scripts/backup.sh --scope full
bash scripts/backup.sh --scope config
bash scripts/backup.sh --scope db
```

Backups are written to `BACKUP_DIR`, which defaults to `./backups`.

#### Backup retention

Each backup run prunes old backup artifacts after the new backup finishes. Retention uses both age and count:

- `BACKUP_KEEP_N=14` keeps this many newest backup artifacts regardless of age.
- `BACKUP_RETENTION_DAYS=30` marks artifacts older than this many days as prune candidates.
- A file is deleted only when it is older than `BACKUP_RETENTION_DAYS` and is not one of the newest `BACKUP_KEEP_N` files.

Preview pruning without deleting files:

```bash
bash scripts/backup.sh --scope full --dry-run
```

#### Scheduled backups

Scheduled backups are controlled by `.env`:

- `BACKUP_SCHEDULE_ENABLED=false`
- `BACKUP_SCHEDULE_INTERVAL_HOURS=24`
- `BACKUP_KEEP_N=14`
- `BACKUP_RETENTION_DAYS=30`

You can also view or update the schedule from the dashboard Backups page.

#### Restore

Restore from the dashboard Backups page or run the restore helper manually:

```bash
bash scripts/restore.sh ./backups/<backup-file-or-meta>
```

Restore guidance:

1. Confirm you selected the correct backup.
2. Expect game services to stop during restore.
3. Database dumps restore PostgreSQL data.
4. Config archives restore `.env` and `config/` files.
5. `.meta` restores replay all referenced backup artifacts.

### Log Rotation

Docker handles container log rotation through the `json-file` driver with:

- `max-size: 10m`
- `max-file: 3`

No manual logrotate job is required for container logs unless you change the Docker logging driver.

### Database Maintenance

PostgreSQL uses normal auto-vacuum behavior. Routine manual vacuuming is not required for standard operation.

> **Database name:** The game database is `dune_sb_1_4_0_0`, **not** `dune`. The `dune` user
> owns the database, but all game tables live in the `dune` schema inside `dune_sb_1_4_0_0`.
> Always use `-d dune_sb_1_4_0_0` in `psql` commands. Scripts that reference the wrong
> database will silently succeed on an empty schema without errors.

#### Manual vacuum (if needed)

```bash
docker compose exec -T postgres psql -U dune -d dune_sb_1_4_0_0 -c "VACUUM ANALYZE;"
```

#### Check database size

```bash
docker compose exec -T postgres psql -U dune -d dune_sb_1_4_0_0 -c "SELECT pg_size_pretty(pg_database_size('dune_sb_1_4_0_0'));"
```

#### Quick health check queries

```bash
# Player count and online status
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT count(*) as total_accounts,
    count(*) FILTER (WHERE online_status = 'Online') as online
  FROM dune.encrypted_player_state;
"

# Building and base stats
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT
    (SELECT count(*) FROM dune.buildings) as buildings,
    (SELECT count(*) FROM dune.building_instances) as pieces,
    (SELECT count(*) FROM dune.placeables) as placeables,
    (SELECT count(*) FROM dune.totems) as totems;
"

# Partition and server health
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT server_id, map, alive, ready FROM dune.farm_state ORDER BY map;
  SELECT partition_id, world_reset_seed FROM dune.world_partition_reset_seed;
"
```

### Credential Rotation

Rotate credentials every 90 days or immediately if compromised.

#### Dashboard Admin Token

```bash
# Generate new token
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Update .env
nano .env
# Change DUNE_ADMIN_TOKEN=<old> to new value

# Restart dashboard
docker compose restart dashboard-api dashboard-frontend
```

#### PostgreSQL Passwords

```bash
# Generate new password
NEW_PASSWORD=$(python -c "import secrets; print(secrets.token_urlsafe(32))")

# For POSTGRES_SUPER_PASSWORD:
# 1. Update .env
# 2. Restart postgres: docker compose restart postgres

# For POSTGRES_DUNE_PASSWORD:
# 1. Change password in database:
docker compose exec -T postgres psql -U dune -d dune_sb_1_4_0_0 -c "ALTER USER dune PASSWORD '$NEW_PASSWORD';"
# 2. Update .env
# 3. Restart services: docker compose restart dashboard-api survival_1 overmap director partition-repair
```

#### RabbitMQ Credentials

```bash
# Generate new password
NEW_PASSWORD=$(python -c "import secrets; print(secrets.token_urlsafe(32))")

# Update RabbitMQ user
docker compose exec -T admin-rmq rabbitmqctl change_password admin "$NEW_PASSWORD"

# Update .env (DUNE_RMQ_MANAGEMENT_PASSWORD)
# Restart: docker compose restart admin-rmq game-rmq director text-router gateway rmq-auth-shim
```

### Server Updates

#### Check for updates

Via Dashboard: Navigate to Updates page -> Check for Updates

Via CLI:
```bash
bash scripts/check-steam-build.sh 3104830  # PTC (Public Test Client)
bash scripts/check-steam-build.sh 4754530  # Retail (Production) -- use this one
```

#### Apply updates

```bash
# 1. Announce to players (15-30 min warning)
# 2. Create backup
bash scripts/backup.sh --scope full

# 3. Run update
./dune update

# 4. Verify health
docker compose ps
./dune status
```

#### After an Image Version Upgrade (DB Re-Init Required)

> This is the canonical drop/recreate-database procedure. `docs/TROUBLESHOOTING.md`'s
> "Database version mismatch" and "PTC vs Retail Steam App Mismatch" sections show the
> same steps in their own diagnostic context — if this procedure ever changes, update it
> here first and keep those sections in sync.

When the Funcom server image changes to a **new major version** (e.g. `1973075` to `1979201`),
the game schema changes and the existing database must be recreated. `bootstrap_db.py` has an
early-exit guard that skips initialization if the schema already exists, so you must drop and
recreate the database manually.

> **Warning:** This destroys all world data. Take a full backup first.
>
> **Player data can be restored** from the pre-upgrade backup after re-initialization.
> See [Troubleshooting - Restoring Player Data After DB Re-Init](./TROUBLESHOOTING.md#restoring-player-data-after-db-re-init)
> for the full procedure. The `update.sh` script now creates an automatic backup before proceeding.

```bash
# 1. Back up everything
bash scripts/backup.sh --scope full

# 2. Load the new server image (Funcom ships tarballs via Steam)
# Funcom tarballs load with a registry.funcom.com prefix -- must re-tag to match compose
docker load < server-<new-tag>-shipping.tar.gz
docker tag registry.funcom.com/funcom/self-hosting/seabass-server:<new-tag>-shipping \
  funcom/self-hosting/seabass-server:<new-tag>-shipping

# 3. Update .env
sed -i 's/DUNE_IMAGE_TAG=.*/DUNE_IMAGE_TAG=<new-tag>-shipping/' .env
# Confirm STEAM_APP_ID=4754530 (retail) not 3104830 (PTC)

# 4. Stop all game services (leave postgres running)
docker compose -f docker-compose.yml -f docker-compose.basic.yml down

# 5. Drop and recreate the database
docker compose -f docker-compose.yml up -d postgres
sleep 5
docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
  -c "DROP DATABASE IF EXISTS dune_sb_1_4_0_0;"
docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
  -c "CREATE DATABASE dune_sb_1_4_0_0 OWNER dune;"

# 6. Initialize fresh schema
docker compose -f docker-compose.yml up db-init --force-recreate

# 7. Start the full stack
docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d

# 8. Restart director after DB init (clears QueryPlayerOnlineStates errors)
sleep 30
docker compose -f docker-compose.yml restart director
```

### Disk Space Management

```bash
# Check disk usage
df -h

# Docker disk usage
docker system df

# Clean up old images
docker image prune -a

# Clean up old backups (manual)
find ./backups -name "*.dump" -mtime +30 -delete
```

### Data Directory and Partition Volumes

The `data/` directory is created by the stack and owned by `root`. You cannot create
subdirectories inside it as a regular user. Use a temporary Alpine container to create new
directories:

```bash
# Create a new per-partition saved directory (e.g. for a second survival shard)
docker run --rm \
  -v "$(pwd)/data:/data" \
  alpine sh -c 'mkdir -p /data/survival-saved-2 && chown 1000:65534 /data/survival-saved-2'
```

**Existing partition volume layout (basic profile):**

| Partition | Host path | Notes |
|---|---|---|
| Survival_1 | `data/survival-saved/` | Contains `UserSettings/UserEngine.ini` with display name |
| Overmap | `data/server-saved/overmap/` | Contains both `UserSettings/UserEngine.ini` (root) and `Overmap/UserSettings/UserEngine.ini` (map-specific) |

> **Do not merge these directories.** Each partition needs its own Saved tree so per-partition
> display names, logs, and crash dumps stay isolated.

### Scaling

#### Adjust resource limits

Via Dashboard: System -> Resources

Or edit `.env`:
```bash
# Game servers
MEM_LIMIT_SURVIVAL=8g
MEM_LIMIT_OVERMAP=6g
MEM_LIMIT_DIRECTOR=2g

# After changes:
docker compose up -d
```

#### Change deployment profile

```bash
# Edit .env
DEPLOYMENT_PROFILE=standard  # Options: basic, standard-lean, standard, full

# Redeploy
./dune deploy
```

**Profiles:**
- **basic:** 1 survival + overmap (minimum)
- **standard:** 2 survival + overmap + deep desert + 6 additional maps
- **full:** 3 survival + overmap + deep desert + 19 additional maps

---

## Dashboard Map and Teleport

The Arrakis Command Nexus dashboard includes a **Hagga Basin Tactical Overlay** with live player positions, base markers, and click-to-teleport.

### Map Features

- **Live player positions:** Amber dots show online players with coordinates updated from the game server telemetry feed
- **Player bases:** Green building icons show all player bases stored in the database, with piece count and owner info on hover
- **Click-to-teleport:** Click anywhere on the map to place a cyan teleport pin, then select a player to teleport
- **Preset locations:** Dropdown with player bases (from DB) and static landmarks for quick teleport targeting
- **Manual coordinates:** Enter exact X, Y, Z values for precise teleport placement
- **Teleport-to-player:** Click the teleport button on any player card to teleport another player to their location

### Teleport Workflow

**The player must log out of the game BEFORE you click teleport.** The game server holds positions in memory and overwrites the database on disconnect. If the player is online when you teleport, the game server will overwrite your change.

1. Ask the player to log out
2. Open the Hagga Basin Tactical Overlay on the dashboard
3. Set the destination: click the map, select a preset/base, or enter coordinates
4. Click the teleport button next to the target player's name
5. The dashboard confirms the teleport with the actual Z coordinate used
6. Player logs back in at the new location

### Smart Z (Underground Prevention)

The teleport system automatically corrects the Z coordinate to prevent underground spawns. Terrain height varies from Z=200 to Z=3500+ across the map. When you teleport:

- The API queries all nearby actors (players and buildings) in the database
- It finds the nearest actor's Z value
- It uses `max(nearest_z + 500, requested_z)` as the final Z
- This ensures the player spawns above the surface, not underground

### Bases Toggle

Click the green **Bases** button in the teleport toolbar to show or hide player base markers on the map. Clicking a base marker sets the teleport pin to that base's exact coordinates with smart Z correction.

### Database Reference for Map/Teleport

The game database is `dune_sb_1_4_0_0` (not `dune`). All tables are in the `dune` schema.

```bash
# Connect to the game database
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0

# View all player positions
SELECT a.id, a.transform::text
FROM dune.actors a
JOIN dune.encrypted_player_state eps ON eps.player_pawn_id = a.id;

# View all building positions
SELECT b.id, a.transform::text,
  (SELECT count(*) FROM dune.building_instances bi WHERE bi.building_id = b.id) AS pieces
FROM dune.buildings b
JOIN dune.actors a ON a.id = b.id;
```

**Key ID relationships:**

| ID Type | Example | Where to Find |
|---|---|---|
| FLS user ID (hex) | `DEADBEEFCAFEF00D` | `encrypted_accounts."user"` column |
| Account ID (int) | `1` | `encrypted_accounts.id` |
| Steam platform ID | `76561198012345678` | `encrypted_accounts.platform_id` |
| Player pawn ID | `42` | `encrypted_player_state.player_pawn_id` (FK to `actors.id`) |

**Transform format:** `("(x,y,z)","(rx,ry,rz,rw)")` where translation is a `vector` and rotation is a `quat`. The Z axis is vertical (higher = more above ground).

---

## Monitoring

### Key Metrics

- **Container health:** All services should show "healthy"
- **CPU usage:** Below 80% sustained
- **Memory usage:** Below 85% to avoid OOM
- **Disk space:** Keep 20%+ free
- **Player connections:** Track vs capacity

### Setting Up Alerts

Dashboard -> System -> Discord -> Add Webhook

Configure alert types:
- Container restarts
- Player join/leave
- Economy anomalies
- Backup completion/failure
- Update availability

---

## Quick Reference Commands

```bash
# Server status
./dune status

# Capacity snapshot
./dune snapshot

# View all containers
docker compose ps

# Restart game servers
docker compose restart survival_1 overmap

# Restart entire stack
docker compose restart

# View logs
docker compose logs -f <service-name>

# Create backup
bash scripts/backup.sh --scope full

# Restore backup
bash scripts/restore.sh <backup-id>

# Update server
./dune update

# Database console
docker compose exec -T postgres psql -U dune -d dune_sb_1_4_0_0

# Container shell
docker compose exec <service-name> bash
```

---

**Last updated:** 2026-05-28  
**Version:** 1.4
