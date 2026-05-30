# Troubleshooting

## "Illegal instruction (core dumped)"

**Cause:** The host CPU does not support AVX2, or AVX2 is not exposed to the VM.

**Fix:**

- Run `lscpu | grep -i avx2`
- If you are virtualized, expose host CPU features to the guest
- Move the server to hardware with AVX2 support
- Re-run `./dune preflight` before starting again

## Cannot Connect from LAN

**Cause:** NAT hairpin / loopback is missing on the router.

**Fix:**

- Test from a mobile hotspot or other external network first
- Connect from LAN using the server's private IP
- Add split DNS or a hosts-file override for the public hostname
- Enable NAT loopback in the router if available

## Containers Are Crash-Looping

**Cause:** Missing images, invalid token, or insufficient memory are the most common triggers.

**Fix:**

- Run `docker compose ps`
- Inspect logs with `./dune logs <service>`
- Confirm the Funcom token exists in `secrets/funcom-token.txt` or `FLS_SECRET`
- Confirm the host has enough RAM for the selected profile
- Re-run `./dune preflight`

## Dashboard Is Not Accessible

**Cause:** Bad bind address, port conflict, or CORS mismatch.

**Fix:**

- Confirm `DUNE_ADMIN_BIND_ADDRESS` and `DUNE_ADMIN_HOST_PORT`
- Check `docker compose ps` for `dashboard-frontend` and `dashboard-api`
- Verify `DUNE_ADMIN_ALLOWED_HOSTS` matches the browser origin
- Test locally with `curl http://127.0.0.1:18080/api/ping`

## Database Connection Errors

**Cause:** PostgreSQL is unhealthy, credentials changed, or the database was never initialized.

**Fix:**

- Check `docker compose logs postgres db-init`
- Verify `POSTGRES_SUPER_PASSWORD` and `POSTGRES_DUNE_PASSWORD`
- Confirm port `5432` is not already occupied by another PostgreSQL instance
- Re-run `docker compose run --rm db-init` if initialization failed

## RabbitMQ Issues

**Cause:** Wrong credentials, blocked ports, or a management/public port mismatch.

**Fix:**

- Verify `RMQ_HTTP_TOKEN_AUTH_SECRET` is set
- Check `docker compose logs admin-rmq game-rmq rmq-auth-shim`
- Ensure `31982/tcp` is reachable from players
- Keep `5672`, `15672`, and `15673` private to localhost

## Image Loading Failures

**Cause:** The Steam download path is wrong, the extracted files are incomplete, or the tarball layout is unexpected.

**Fix:**

- Confirm the SteamCMD download completed without errors
- Verify `DUNE_STEAM_SERVER_DIR` points at the folder containing the server payload
- Check whether the update/load script expects tarballs or already-extracted files
- Re-download the package with `steamcmd +login anonymous +app_update 4754530 validate +quit`
- **Use App ID `4754530` (retail)**. App ID `3104830` is the Public Test Client (PTC) build and is
  invisible to players running the retail game. See the [PTC vs Retail](#ptc-vs-retail-wrong-steam-app-id) section below.

## Gateway Patch Needed After Restart

**Cause:** The gateway can come up before the rest of the stack is ready, or the patched config was lost after image updates.

**Fix:**

- Run the included gateway patch helper if your environment requires it
- Restart the gateway after PostgreSQL and RabbitMQ are healthy
- Re-apply local gateway config changes after updating images
- Review `scripts/gateway-patch.sh` and `config/gateway.ini` for environment-specific adjustments

## WSL2-Specific Issues

### Out of Memory / Containers Killed

**Cause:** WSL2 defaults to 50% of host RAM, which may not be enough for the game servers.

**Fix:**

- Create or edit `%USERPROFILE%\.wslconfig`:
  ```ini
  [wsl2]
  memory=24GB
  swap=4GB
  ```
- Restart WSL: `wsl --shutdown`, then reopen your terminal
- Use the `basic` profile if RAM is limited

### Cannot Access Dashboard from Windows Browser

**Cause:** WSL2 uses a virtual network adapter. `localhost` forwarding works for most setups, but some configurations require the WSL2 IP.

**Fix:**

- Try `http://localhost:18080` first (Docker Desktop forwards ports automatically)
- If that fails, find the WSL2 IP: `hostname -I` inside WSL2, then use `http://<WSL2_IP>:18080`
- Set `DUNE_ADMIN_BIND_ADDRESS=0.0.0.0` in `.env` to allow non-localhost access

### Slow File I/O Performance

**Cause:** Accessing files on the Windows filesystem (`/mnt/c/...`) from WSL2 is significantly slower than using the native Linux filesystem.

**Fix:**

- Clone the repository inside WSL2's native filesystem (e.g., `~/dune-server-docker`), not under `/mnt/c/`
- Move Docker volumes to the WSL2 filesystem if they were created on the Windows mount

## Expected Log Warnings (Safe to Ignore)

These messages appear in normal operation and do not indicate a problem:

| Service | Message | Explanation |
|---------|---------|-------------|
| Gateway | `Got invalid partition index (None)` | The overmap server registers itself but does not own a partition. The partition-repair sidecar handles this. |
| Director | `Failed to process travel queue for partition 2` | Partition 2 does not exist in a single-survival setup (only partition 113). The director retries harmlessly. |
| Overmap | `Could not serialize <hostname>` | DNS lookup for the external hostname fails inside the Docker network. Cosmetic only. |
| RabbitMQ | `management_metrics_collection` deprecation | Suppressed by config. If the warning persists, verify `rabbitmq-admin.conf` and `rabbitmq-game.conf` include `deprecated_features.permit` lines. |
| Gateway | `function get_active_servers_for_gateway() does not exist` | The `1973075` retail schema does not include this stored procedure. The gateway falls back to RMQ-based server discovery automatically (~50 s after startup). No action needed. |
| PostgreSQL | `duplicate key value violates unique constraint "world_partition_label_key"` | Ghost server entries from previous runs. Handled by partition-repair. |

## Overmap Partition Load Failure (LoadPartitionDefinition)

**Symptoms:**

```
LogIgwDatabaseInterface: Error: LoadPartitionDefinition:
  Sql::load_world_partition(Survival_1, <SERVER_ID>, 0, 2) got 0 rows, expected exactly 1.
LogIGW: Error: On partition loaded: FAIL!
```

The overmap enters a tight retry loop, the gateway logs `Got invalid partition index (None)`,
and the overmap shows as `ready=false` in `farm_state`.

**Cause:** Each game server generates a new process correlation ID (PCID/server_id) on every
restart. Servers register themselves in `farm_state`, but the `world_partition` table is NOT
updated automatically. The overmap tries to look up its own server_id in `world_partition`
and finds zero rows.

**Fix (automatic):**

The `partition-repair` service runs automatically on `docker compose up` and fixes the
partition table. If the overmap is already stuck, restart it after the repair runs:

```bash
docker compose run --rm partition-repair
docker compose restart overmap
```

**Fix (manual):**

```sql
-- Check current state
SELECT * FROM dune.farm_state WHERE alive = true;
SELECT * FROM dune.world_partition;

-- Insert/update the overmap partition (replace <OVERMAP_SERVER_ID> with actual PCID)
INSERT INTO dune.world_partition (server_id, map, partition_definition, dimension_index)
VALUES (
  '<OVERMAP_SERVER_ID>',
  'Survival_1',
  '{"box": {"max_x": 1, "max_y": 1, "min_x": 0, "min_y": 0}, "type": "box2d_array"}',
  0
)
ON CONFLICT (server_id, map) DO NOTHING;
```

**Prevention:** Keep the `partition-repair` service in your compose configuration. It waits
for servers to register in `farm_state`, then ensures matching `world_partition` rows exist.

## Server Not Appearing in Game Browser

**Symptoms:** All containers are healthy, FLS heartbeats succeed, but the server does not
appear under the **Private** tab in the game's server browser. (The tab was labelled
"Experimental" before patch 1.4.0.1.)

### Quick Diagnosis Checklist

Run through these in order before digging deeper:

1. Run `./dune preflight` and resolve any failures.
2. **Wait at least 5 minutes** after a fresh start (10+ minutes after an image update). The
   `DeclareBattlegroupUpdates` FLS call fires roughly 4 minutes after game servers become
   ready -- the server will not appear in the browser before this fires.
3. Verify `31982/tcp` (RabbitMQ AMQP) is reachable from the internet.
4. Verify `7777/udp` is port-forwarded.
5. Check director logs for a successful `DeclareBattlegroupUpdates` with `UpDeclarationsByPartitionId`:
   ```bash
   docker logs dune-awakening-director-1 2>&1 | grep "DeclareBattlegroupUpdates"
   ```
   If you see `Exception thrown in FlsDeclareBattlegroupUpdates`, see the **Director Nudge** section below.
6. Check gateway logs that `GameRmqHttpAddress` is NOT `x.x.x.x:None`:
   ```bash
   docker logs dune-awakening-gateway-1 2>&1 | grep -i "GameRmqHttpAddress\|GatewayDeclareFarmStatus"
   ```
7. Verify your FLS token has not expired.
8. If another host accidentally started with the same `WORLD_UNIQUE_NAME`, it can steal the
   FLS identity. Stop the duplicate stack and restart gateway on the live host.

### Director Nudge (Browser Shows Nothing / FLS Declaration Stale)

When game servers are running correctly but FLS declarations are stale or missing (for
example, after a partition swap recovery), restart only the Director -- do NOT restart game servers:

```bash
docker compose -f docker-compose.yml restart director
# Then watch for successful DeclareBattlegroupUpdates:
docker logs -f dune-awakening-director-1 2>&1 | grep -i "DeclareBattlegroupUpdates"
```

A successful declaration looks like:
```
("api/Battlegroups_DeclareBattlegroupUpdates") Request successful. ...
  "UpDeclarationsByPartitionId":{"19":{"ServerId":"...","GameAddress":"...","GamePort":7777,...}}
```

The Director restarts in seconds and immediately re-reads `farm_state` + `world_partition`
from PostgreSQL, rebuilding a clean FLS state.

### Partition Swap Recovery (Overmap / Survival Partitions Swapped)

**Symptom:** Overmap crash-loops every 25-30 seconds, logs show:
```
ERROR:  duplicate key value violates unique constraint "world_partition_label_key"
DETAIL:  Key (label)=(Overland) already exists.
```

**Cause:** When both game servers restart simultaneously, there is a race condition where the
overmap server grabs the Survival_1 partition and survival_1 ends up with the Overmap
partition. The `partition-repair` service detects this mismatch and corrects it, but the
Director then needs a nudge to re-declare the corrected state to FLS.

**Fix:**
```bash
# 1. Check current state
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 \
  -c "SELECT partition_id, server_id, map, label FROM dune.world_partition"

# 2. If swapped (survival_1 server has map='Overmap' or vice versa), correct manually:
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  BEGIN;
  UPDATE dune.world_partition SET server_id = '<SURVIVAL1_SERVER_ID>' WHERE partition_id = <SURVIVAL_PID>;
  UPDATE dune.world_partition SET server_id = NULL WHERE partition_id = <OVERMAP_PID>;
  COMMIT;
"

# 3. Restart overmap to pick up corrected assignment
docker compose -f docker-compose.yml -f docker-compose.basic.yml restart overmap

# 4. Director nudge to re-declare to FLS
docker compose -f docker-compose.yml restart director
```

The `partition-repair` service (with the map-type validation fix) now detects and corrects
this swap automatically on every 3-second cycle.

**Root causes (additional checks):**

1. **Database version mismatch.** If the Funcom images were upgraded but the database was
   not recreated, the game server logs `Database version mismatch` and the persistence
   layer never loads. The server stays in `S2S_Starting` state and never becomes `ready`.

   ```bash
   # Check for the error
   docker compose logs survival_1 2>&1 | grep "Database version mismatch"
   ```

   **Fix:** Drop and recreate the database, then re-run db-init:

   ```bash
   docker compose stop survival_1 director gateway text-router
   docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
     -c "DROP DATABASE IF EXISTS dune_sb_1_4_0_0;"
   docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
     -c "CREATE DATABASE dune_sb_1_4_0_0 OWNER dune;"
   docker compose rm -f db-init
   docker compose up db-init --force-recreate
   docker compose up -d
   ```

   **Warning:** This destroys all world data. Take a backup first if you have player progress.

2. **Wrong partition_definition format.** The `world_partition` table must use the
   `box2d_array` JSON format. Without the `"type"` field, the game server fails with:

   ```
   Ensure condition failed: Object->HasTypedField<EJson::String>(u"type")
   ```

   **Fix:** The correct format is:
   ```json
   {"type":"box2d_array","box":{"min_x":0,"min_y":0,"max_x":1,"max_y":1}}
   ```

   The `db-init` service seeds this automatically on fresh databases. To fix an existing
   database:

   ```sql
   UPDATE world_partition
   SET partition_definition = '{"type":"box2d_array","box":{"min_x":0,"min_y":0,"max_x":1,"max_y":1}}'::jsonb;
   ```

3. **`BattlegroupMaxPlayerCapacity` is 0.** The director reports 0 capacity to FLS, so the
   server is hidden. Check that `farm_state` shows `ready = true`:

   ```sql
   SELECT server_id, map, ready, alive FROM farm_state;
   ```

   If `ready` is `false`, the game server has not finished loading. Check its logs for errors.

4. **Port forwarding incomplete.** Players need:
   - `7777-7810 UDP` for game traffic
   - `31982 TCP` for RabbitMQ (login/auth)
   - `31983 TCP` for RabbitMQ HTTP API

5. **Missing BackendLogin auth secrets.** If `DUNE_SERVER_LOGIN_PASSWORD_SECRET` and
   `DUNE_USERNAME_SERVER_LOGIN_SECRET` are blank, player authentication will fail.
   Generate them with `openssl rand -hex 32` and ensure the same values are set for
   the director and all game servers.

## Performance Tuning

If your server feels sluggish, has high latency, or containers are being OOM-killed:

### Apply Host Tuning

```bash
# Preview changes without modifying anything
sudo ./scripts/host-tuning.sh --dry-run

# Apply kernel + Docker tuning
sudo ./scripts/host-tuning.sh

# Also add swap on low-memory hosts (< 32 GB)
sudo ./scripts/host-tuning.sh --swap 8
```

This sets `vm.swappiness=10`, increases UDP buffers for game traffic, disables transparent
hugepages, and configures Docker log rotation. See `vm/README.md` for per-map memory profiles.

### Increase Container Memory Limits

Edit `.env` and raise the `MEM_LIMIT_*` values:

```bash
MEM_LIMIT_SURVIVAL=16g   # Default 12g, increase if OOM-killed
MEM_LIMIT_DEEP_DESERT=12g
```

Then `docker compose up -d` to apply.

## Collecting a Diagnostic Snapshot

When filing a bug report or asking for help, collect a snapshot:

```bash
./scripts/collect-snapshot.sh
```

This creates a tarball with system info, container state, logs, database status, and network
config. All credentials are automatically redacted before packaging.

## Dashboard Data Lost After Container Rebuild

**Cause:** The dashboard SQLite database was stored inside the container at `/app/dashboard.db` with no persistent volume mount.

**Fix (already applied in v1.4.0):**

The `docker-compose.yml` now mounts `./dashboard-data:/workspace/data` and sets `DUNE_DASHBOARD_DB_URL` to use that path. After upgrading:

```bash
mkdir -p dashboard-data && chmod 777 dashboard-data
docker compose up -d dashboard-api
```

Discord webhooks, scheduled announcements, and other dashboard settings will persist across rebuilds.

## Overview Page Stuck Loading

**Cause:** The `/api/status` endpoint crashes with a 500 error when PostgreSQL is temporarily unreachable (DNS resolution failure, container restarting, etc.).

**Fix (applied in v1.4.0):** The status endpoint now uses `return_exceptions=True` in `asyncio.gather` so a PostgreSQL failure degrades gracefully (shows 0 players) instead of crashing the entire page.

## Post-Deploy Smoke Test

Run the smoke test after any deployment to catch regressions:

```bash
make smoke
# or directly:
bash scripts/smoke-test.sh
```

The test checks 42 items across 7 categories: container health, API endpoints, frontend routes, volume persistence, configuration, database connectivity, and recent error logs.

## Partition Crash-Loop (Server Won't Start)

**Root cause:** The game server must find a matching `world_partition` row for its freshly generated `server_id` almost immediately after startup.

1. The game binary generates a random `server_id` on each startup.
2. It registers that `server_id` in `farm_state` through RabbitMQ and the director.
3. It then queries `load_world_partition` using that `server_id` within about 5 seconds.
4. If `world_partition` does not contain the matching `server_id`, the server crashes with `Local partition is not found`.
5. `scripts/survival-pre-start.sh` handles this automatically by parsing the startup output, waiting for `farm_state`, and inserting the partition row.
6. If the pre-start flow fails, manually delete stale rows from `farm_state` and `world_partition`, then restart the affected server.

Suggested recovery steps:

```sql
DELETE FROM dune.farm_state WHERE server_id = '<stale_server_id>';
DELETE FROM dune.world_partition WHERE server_id = '<stale_server_id>';
```

Then run:

```bash
docker compose run --rm partition-repair
docker compose restart overmap
```

## Crafting and Refinery Timer Glitches

**Symptoms:** Refineries stay paused, timers cycle backward, or crafting durations keep extending.

**Root cause:** Server tick-rate drops when the host is starved for CPU or memory.

**Most common trigger:** `overmap` enters a crash-loop and burns 100 percent or more CPU during repeated restarts.

**Diagnosis:**

```bash
docker stats
```

Check the CPU and memory percentages for `overmap`, survival shards, and supporting services.

**Fix:** Stop the offending container, increase resource limits, then restart it.

```bash
docker compose stop overmap
# edit .env and raise MEM_LIMIT_OVERMAP or the matching MEM_LIMIT_<SERVICE>
docker compose up -d overmap
```

## Credential Rotation

Rotate credentials carefully so connected services stay in sync.

### `DUNE_ADMIN_TOKEN`

1. Update `.env`.
2. Restart the API:
   ```bash
   docker compose restart dashboard-api
   ```

### `POSTGRES_DUNE_PASSWORD`

1. Update `.env`.
2. Update the PostgreSQL user password inside the database.
3. Restart all game containers and any service that connects to PostgreSQL.

### RabbitMQ credentials

1. Update `.env`.
2. Restart RabbitMQ.
3. Restart all connected services so they reconnect with the new credentials.

### Discord webhook

1. Update `.env`.
2. Restart the API:
   ```bash
   docker compose restart dashboard-api
   ```

## Multiple or Duplicate Entries in Server Browser (Ghost Servers)

**Symptoms:** The server browser shows 3, 5, or more copies of your server even though only 2
partitions are running (Overmap + Survival).

**Root cause:** Every time a game server process starts, it generates a **new random server ID**.
Funcom Live Services (FLS) tracks each ID independently. When you restart a container (whether via
`docker compose restart`, `docker compose up -d`, or a crash recovery), FLS registers a fresh
entry for the new ID while the old entry remains until its heartbeat TTL expires. Multiple
rapid restarts accumulate stale entries.

**Important:** `docker compose restart` does **not** preserve the server ID. Each process
invocation produces a unique ID.

**How long do ghost entries last?** Based on observed behaviour, FLS TTL appears to be
12-24 hours after the last heartbeat for self-hosted servers. Ghost entries clear on their own -- they just
take time.

**What to do right now:**

1. Stop restarting containers (additional restarts only add more ghost entries).
2. Verify the *currently running* entries are healthy:
   ```bash
   docker logs dune-awakening-director-1 --since 5m 2>&1 | grep '"displayName"' | tail -4
   ```
   The two current entries should show your configured display names with `"ready":true`.
3. Wait 12-24 hours. Stale entries expire automatically.

**How to identify the current entries:**

```bash
# Get the current server IDs from gateway logs
docker logs dune-awakening-gateway-1 2>&1 | grep 'came up' | tail -4
```

The last line for each partition index (1 = Survival, 2 = Overmap) is the active entry.
All earlier entries for the same partition index are ghosts.

**Prevention:**

- Batch all necessary configuration changes and do a single clean restart rather than
  multiple sequential ones.
- When changing display names, update `.env` and `data/*/UserSettings/UserEngine.ini` on
  disk before restarting -- the pre-start script handles this automatically now.
- Prefer `docker compose up -d <service>` over repeated `docker compose restart` when
  iterating on configuration.

## PTC vs Retail: Wrong Steam App ID {#ptc-vs-retail-wrong-steam-app-id}

**Symptom:** Server appears online (director reports `DeclareBattlegroupUpdates` success) but
is completely invisible to players running the retail game. Or the server is visible but
players receive a version mismatch error when connecting.

**Cause:** There are two separate dedicated server packages on Steam:

| Steam App ID | Build | Who can connect |
|---|---|---|
| `4754530` | Retail (Production) | All retail game clients |
| `3104830` | PTC (Public Test Client) | Only PTC game clients |

Running the PTC build when your players use the retail game (or vice versa) means the server
is invisible on the correct FLS environment.

**Fix:**

1. Verify your `.env`:
   ```bash
   grep STEAM_APP_ID .env
   # Should be: STEAM_APP_ID=4754530
   grep DUNE_IMAGE_TAG .env
   # Retail image tag example: DUNE_IMAGE_TAG=1973075-0-shipping
   ```

2. Download the retail server with the correct App ID:
   ```bash
   steamcmd +login anonymous +app_update 4754530 validate +quit
   ```

3. Load and tag the new image (Funcom ships tarballs; the loaded image has a `registry.funcom.com`
   prefix that must be re-tagged to match the compose file):
   ```bash
   # Load the tarball (adjust filename to match downloaded version)
   docker load < server-1973075-0-shipping.tar.gz
   # Re-tag to the short name used by docker-compose.yml
   docker tag registry.funcom.com/funcom/self-hosting/seabass-server:1973075-0-shipping \
     funcom/self-hosting/seabass-server:1973075-0-shipping
   ```

4. Update `.env` and reinitialize the database (the schema changes between major versions):
   ```bash
   # Update image tag
   sed -i 's/DUNE_IMAGE_TAG=.*/DUNE_IMAGE_TAG=1973075-0-shipping/' .env
   sed -i 's/STEAM_APP_ID=.*/STEAM_APP_ID=4754530/' .env

   # Stop all services
   docker compose -f docker-compose.yml -f docker-compose.basic.yml down

   # Drop and recreate the database (WARNING: destroys world data -- backup first)
   docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
     -c "DROP DATABASE IF EXISTS dune_sb_1_4_0_0;"
   docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
     -c "CREATE DATABASE dune_sb_1_4_0_0 OWNER dune;"

   # Re-initialize schema
   docker compose -f docker-compose.yml up db-init --force-recreate

   # Start everything
   docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d
   ```

5. After the stack is up, restart the director to clear any `QueryPlayerOnlineStates`
   exceptions that occur immediately after a DB re-init:
   ```bash
   docker compose -f docker-compose.yml restart director
   ```

**Identifying the current image tag:**

```bash
docker images funcom/self-hosting/seabass-server
# or check the running container
docker inspect dune-awakening-survival-1 --format '{{.Config.Image}}'
```

## "Destination Unavailable" When Joining

**Symptoms:** Player clicks "Join" in the server browser and gets `sb5Q2$ Destination unavailable 5Q2`.

**Cause:** The director cannot find a valid partition for the player. This happens when:
- The `partition_id` on the player's actors references a partition that does not exist in `world_partition`
- Most commonly occurs after a database re-initialization where partition IDs changed (e.g., PTC partition 19 became retail partition 1)

**Diagnosis:**

```bash
# Check what partition the player's actors reference
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT a.id, a.partition_id, a.map
  FROM dune.actors a
  JOIN dune.encrypted_player_state eps ON a.id IN (eps.player_controller_id, eps.player_pawn_id, eps.player_state_id)
"

# Check what partitions actually exist
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT partition_id, map, server_id FROM dune.world_partition
"
```

**Fix:**

```sql
-- Update actors to reference the correct current partition_id
-- Example: PTC used partition_id=19 for HaggaBasin, retail uses partition_id=1
UPDATE dune.actors SET partition_id = 1
WHERE map = 'HaggaBasin' AND (partition_id = 19 OR partition_id IS NULL);

-- Clear stale server_id references on player state
UPDATE dune.encrypted_player_state SET server_id = NULL WHERE server_id IS NOT NULL;

-- Ensure all players are marked offline
UPDATE dune.encrypted_player_state SET online_status = 'Offline';
```

Restart the director after making changes:
```bash
docker compose -f docker-compose.yml restart director
```

## "A Storm Has Reset the Map" / Missing Buildings

**Symptoms:** After restoring player data from a backup, the game shows "A storm has reset the map" and player bases are missing, even though building data exists in the database.

**Cause:** Three tables track a reset counter for the world: `world_partition_reset_seed` (per partition), `world_map_reset_seed` (per map), and `world_farm_reset_seed`. When the game server reads a different seed than the one the buildings were created under, it triggers a "storm reset" and hides the buildings in-game. The building rows usually remain in the database, so this is most often a display problem, not data loss.

This commonly happens after restoring a PTC backup to a retail database, where partition IDs changed (PTC partition 19 with seed 1 becomes retail partition 1 with seed 2).

**Critical detail:** The game server **overwrites** the reset seed back to its default value (2) during late startup, roughly 30-60 seconds after the container starts, and again during runtime. The fix must therefore force the seed **before** the game server reads it at boot, and re-assert it afterward. A one-time SQL fix run against a live server will be reverted on the next restart unless the automated seed protection is enabled.

**Confirm it is a display issue, not data loss:** Building counts that are stable across backups (for example `building_instances` holding steady at the same number for days) mean nothing was deleted. The bases are intact and only hidden by the seed mismatch. Correcting the seed and restarting the affected map server makes them reappear; no backup restore is required.

**Diagnosis:**

```bash
# Check current reset seeds (all three tables)
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT * FROM dune.world_partition_reset_seed;
  SELECT * FROM dune.world_map_reset_seed;
  SELECT * FROM dune.world_farm_reset_seed;
"

# Verify buildings still exist in DB
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT count(*) as buildings FROM dune.buildings;
  SELECT count(*) as pieces FROM dune.building_instances;
  SELECT count(*) as placeables FROM dune.placeables;
"
```

**One-time fix** (will be reverted on next server restart unless the automated protection below is enabled):

```sql
-- If buildings were created under seed 1, set every seed table back to 1
UPDATE dune.world_partition_reset_seed SET world_reset_seed = 1;
UPDATE dune.world_map_reset_seed       SET world_reset_seed = 1;
UPDATE dune.world_farm_reset_seed      SET world_reset_seed = 1;
```

**Permanent fix (recommended):**

Add `SURVIVAL_RESET_SEED=1` to your `.env` file. The `survival-pre-start.sh` entrypoint script then protects the seed in two stages:

1. **Pre-game enforcement** - before launching the game server, it forces `world_partition_reset_seed`, `world_map_reset_seed`, and `world_farm_reset_seed` to the configured value. This closes the race window where the game server's storm-reset check ran before the seed could be corrected (the root cause of bases being "wiped again" after a restart).
2. **Post-start backstop** - a background loop monitors all three tables for about 10 minutes after boot and re-asserts the seed whenever the game server drifts it back to the default, so the value reliably holds through and beyond the storm-reset check.
3. **Seed guardian sidecar** - the `seed-guardian` service (in `docker-compose.basic.yml`) keeps the seed pinned continuously (every `SEED_GUARD_INTERVAL` seconds, default 300), so the value is already correct at any moment a boot might read it, independent of boot timing or which service triggered the restart. It is a safe no-op when `SURVIVAL_RESET_SEED` is unset.

```bash
# In .env
SURVIVAL_RESET_SEED=1
```

Then restart the survival server:

```bash
docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d survival_1
```

Watch the container logs to confirm the seed correction is working:

```bash
docker logs -f dune-awakening-survival-1-1 2>&1 | grep -i "reset.seed"
```

You should see output like:

```
[reset-seed] Attempt 1: current seed = 2, expected = 1 -- fixing
[reset-seed] Attempt 2: current seed = 2, expected = 1 -- fixing
[reset-seed] Attempt 3: current seed = 1 -- correct, stopping
```

**Important:** Use `docker compose up -d` (not `docker compose restart`) if you also changed `.env`. The game server must restart to pick up the corrected seed from the database. This will create one more ghost entry in the browser (clears in 12-24 hours).

## Character Transfer Error M72

**Symptoms:** A player sees "Transfer Character" on login but the transfer always fails with error M72. Cancelling the transfer via the Director's `/CancelTransfer` API appears to succeed, but the transfer is re-offered on the next login.

**Cause:** Funcom Live Services (FLS) stores a pending character transfer token server-side. When a server is decommissioned (e.g., shutting down a PTC server) while a player has an active transfer, the token persists in FLS indefinitely. The local `CancelTransfer` only clears the local database state; FLS re-offers the transfer on every subsequent login.

**Diagnosis:**

```bash
# Check the director logs for transfer-related errors
docker logs dune-awakening-director-1 2>&1 | grep -i "transfer\|M72"

# Check if the player has pending transfer state in the database
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT * FROM dune.character_transfers ORDER BY id DESC LIMIT 5;
"
```

**Known workarounds (partial):**

1. **Clear local transfer state:** Delete any rows in `dune.character_transfers` for the affected account. This does not fix the FLS-side token but prevents local errors.

2. **Ignore the transfer prompt:** If the player can dismiss the transfer dialog, they can continue playing on their existing character.

3. **Contact Funcom support:** The FLS-side token can only be cleared by Funcom. Open a support ticket referencing error M72 and provide the player's Steam ID.

**This is a known limitation** of the self-hosted server architecture. There is currently no server-side API to clear FLS transfer tokens.

## Teleport Puts Player Underground

**Symptoms:** Using the dashboard map teleport feature, the player logs out and back in but spawns underneath the terrain, falling through the void.

**Cause:** The game world terrain height (Z coordinate) varies wildly across the map, from Z=200 in low areas to Z=3500+ in elevated regions. A fixed default Z value will be underground in some areas. Additionally, building foundation Z values are typically 200-400 units below the player standing height at that location.

**How the smart Z system works:**

The teleport API automatically corrects the Z coordinate to prevent underground spawns. When you teleport via the dashboard:

1. The backend queries all known actor positions (players, buildings) near the target X,Y
2. It finds the nearest actor's Z coordinate
3. It uses `max(nearest_z + 500, requested_z)` as the actual teleport Z
4. This ensures the player spawns at least 500 units above the nearest known entity

**Important: Player must log out FIRST**

The game server holds player position in memory and periodically writes it to the database. If you teleport while the player is online:

1. Dashboard writes new position to DB
2. Player disconnects
3. Game server flushes the player's in-game position to DB, **overwriting the teleport**
4. Player reconnects at their original position

**Correct procedure:**

1. Player logs out of the game completely
2. Set the teleport destination on the dashboard map
3. Click the teleport button for the target player
4. Player logs back in and spawns at the new location

**Manual teleport via SQL (if the dashboard is unavailable):**

```sql
-- Find the player's actor ID
SELECT eps.player_pawn_id, ea.platform_id
FROM dune.encrypted_player_state eps
JOIN dune.encrypted_accounts ea ON ea.id = eps.account_id;

-- Teleport to specific coordinates (player must be offline)
UPDATE dune.actors
SET transform = ROW(
    ROW(156733, 314506, 1200)::vector,
    (transform).rotation
)::transform
WHERE id = <player_pawn_id>;
```

**Choosing safe coordinates:**

Check where other players or bases are to find valid terrain Z values:

```sql
-- See all player and building positions
SELECT a.id, a.transform::text
FROM dune.actors a
WHERE a.transform IS NOT NULL;
```

Use a Z value at least 300-500 units above any nearby actor's Z to ensure the player lands on the surface.

## Granted Items Not Appearing In-Game

**Symptoms:** You grant an item (or solari) to a character through the dashboard or directly via SQL. The API reports success and the row is present in the `dune.items` table, but the item never shows up in the player's inventory in-game -- even after the player logs out and back in. This almost always means the `template_id` is wrong (a recipe name, not an item template); a correctly-templated grant *does* appear after the player relogs.

**Cause #0 (the most common one): wrong `template_id` -- a recipe name, not an item template.** The game instantiates inventory items by their **item template id**, which is frequently different from the **crafting-recipe name**. For example, the recipe that produces silicon is named `T2_Material_Silicone`, but the item template the game actually renders is just `Silicone`. If you grant `T2_Material_Silicone`, a row is written and even passes a naive "does this name exist in game data?" check (it matches the recipe), but the server cannot instantiate it on load -- it reserves the inventory slot as an invisible "ghost" and never draws the item. The dashboard now resolves recipe-style names (trailing segment match, e.g. `T2_Material_Silicone` -> `Silicone`) for **every** grant -- including curated catalog entries such as the tier-prefixed names `T3_Material_CopperBar` -> `CopperBar`, `T2_MiscEquipment_PowerPack` -> `PowerPack`, and `T3_Tool_SurveyProbeLauncher` -> `SurveyProbeLauncher` -- and rejects names that exist only as recipes. To find a correct template id, look at what real items use:

```sql
-- Find the actual item template the game renders (not the recipe name)
SELECT DISTINCT template_id FROM dune.items WHERE template_id ILIKE '%silic%';
-- -> "Silicone"  (NOT "T2_Material_Silicone")
```

If you already injected a ghost row with a bad template, fix it in place. The corrected item loads the next time the player joins the server (see below) -- a relog, not a full restart, is sufficient:

```sql
UPDATE dune.items SET template_id = 'Silicone' WHERE id = <ghost_item_id>;
```

**Cause (the important one): the server reads inventory from the database on player LOGIN.** The game server holds a player's inventory in memory while they are connected and only **writes** it back to the database during the session. It **re-reads** the inventory rows from the database when the player's character loads from persistence -- which happens on **login** (`LoadPlayerActors` / `LoadPawn` / `SpawnPawnFromPersistence` in the server log). A directly inserted item therefore appears after the player **relogs**: return to the main menu and rejoin the server. A full **server restart is NOT required** -- a restart only works because it forces every player to relog.

> Verified empirically: an item written ~31 minutes into server uptime (`RestartCount=0`, no restart) appeared in-game after the player logged out (`UNetConnection::Close`) and logged back in (`LoadPlayerActors`). An earlier belief that "a relog is not enough, only a cold restart works" was a misdiagnosis caused by a ghost `template_id` -- the relog *was* reading the database, but the recipe-named ghost item could not be instantiated, so nothing was drawn.

This is the same mechanism as teleport: the pawn transform and the inventory are both re-read when the player's character spawns on login.

**Secondary issue (granting while online):** If you insert an item while the player is online, the server owns the live inventory and *may* overwrite or delete your row on the player's next logout flush (it rewrites the slots it manages). In practice a row written to a free slot usually survives the flush and loads on the next login, but to be safe prefer granting while the player sits at the main menu, then have them rejoin. If an online grant does not appear after relogging, re-grant at the menu and rejoin.

**Tertiary issue (slot capacity):** Each inventory has a `max_item_count` (a default backpack is 35). Items written to a `position_index` at or above that count exist in the database but are never rendered. The dashboard now allocates the first free slot within `[0, max_item_count)` automatically; if you insert via raw SQL, pick a free slot below `max_item_count`.

**Correct, reliable procedure:**

1. Insert the item (via the dashboard, or via SQL into a free slot below `max_item_count`). Use the correct **item template id**, not a recipe name.
2. Have the player **return to the main menu** and **rejoin** the server. On login the server loads the inventory from the database, including your item.

That is all -- no `docker compose stop`/`up` is needed. (If you prefer to eliminate any chance of the logout flush touching the row, grant while the player is already at the main menu, then have them join.) The granted row stays safely in the database until the player next logs in, so it will also appear after any scheduled server restart if the player does not relog sooner.

**Dashboard behavior:** The grant API returns a `warning` noting that the item appears after the player relogs (no restart required), and adds a second note (and sets `player_online: true`) if the player is currently online. The Characters page surfaces this as a "Relog to load the item" panel.

**Verify the row was written:**

```sql
-- Items in a player's backpack (inventory_type 0)
SELECT it.id, it.template_id, it.stack_size, it.position_index
FROM dune.items it
JOIN dune.inventories inv ON inv.id = it.inventory_id
JOIN dune.actors a ON a.id = inv.actor_id
WHERE a.owner_account_id = <account_id>
  AND inv.inventory_type = 0
ORDER BY it.position_index;

-- Confirm the slot is below the backpack capacity
SELECT id, inventory_type, max_item_count
FROM dune.inventories WHERE id = <inventory_id>;
```

**Oversized stacks:** If you request a `stack_size` larger than the largest stack the game normally uses for that item, the grant still succeeds but the API adds a warning. The server may cap, split, or move the oversized stack to overflow inventory on load. Prefer granting multiple normal-sized stacks over one huge stack.

## Restoring Player Data After DB Re-Init

When the database is dropped and recreated for a major version upgrade, all player data (characters, bases, items, progression) is lost. If you have a pre-upgrade backup, you can restore it.

**Prerequisites:**
- A pre-upgrade PostgreSQL backup (created by `scripts/backup.sh --scope db` or the automatic pre-update backup)
- The backup must be from a compatible server version

### Full Restore from pg_dump Backup

If your backup is a `pg_dump` custom format (`.dump` file):

```bash
# Stop game servers first
docker compose -f docker-compose.yml -f docker-compose.basic.yml stop survival_1 overmap

# Restore into the game database
docker exec -i dune-awakening-postgres-1 pg_restore -U dune -d dune_sb_1_4_0_0 \
  --clean --if-exists < backups/your-backup-file.dump

# Restart everything
docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d
```

### Selective Restore from SQL Backup

If your backup is a gzipped SQL dump (`.sql.gz`), you can extract and restore specific tables. Key player data tables:

| Category | Tables |
|---|---|
| Accounts | `encrypted_accounts`, `encrypted_player_state` |
| Characters | `actors`, `actor_fgl_entities`, `fgl_entities`, `actor_state` |
| Inventory | `inventories`, `actor_inventories`, `items` |
| Bases | `buildings`, `building_instances`, `building_favorites`, `building_progression`, `totems`, `placeables`, `permission_actor`, `permission_actor_rank` |
| Progression | `journey_story_node`, `player_markers`, `markers`, `map_areas`, `lore_pickups`, `dialogue_met_npcs`, `dialogue_taken_nodes`, `tutorial_per_player` |
| Vehicles | `vehicles`, `vehicle_modules` |
| World state | `actor_spawners`, `resourcefield_state`, `game_events`, `factions` |

**Critical post-restore steps:**

1. **Fix partition IDs** if migrating between PTC and retail (partition numbering differs):
   ```sql
   UPDATE dune.actors SET partition_id = 1
   WHERE map = 'HaggaBasin' AND partition_id NOT IN (
     SELECT partition_id FROM dune.world_partition
   );
   ```

2. **Clear stale server references:**
   ```sql
   UPDATE dune.encrypted_player_state SET server_id = NULL, online_status = 'Offline';
   ```

3. **Fix reset seeds** to prevent "storm reset" (see above section).

4. **Reset sequences** to avoid primary key conflicts:
   ```sql
   SELECT setval('dune.actors_id_seq', COALESCE((SELECT MAX(id) FROM dune.actors), 1));
   SELECT setval('dune.inventories_id_seq', COALESCE((SELECT MAX(id) FROM dune.inventories), 1));
   SELECT setval('dune.items_id_seq', COALESCE((SELECT MAX(id) FROM dune.items), 1));
   ```

5. **Restart the director** to refresh its cache:
   ```bash
   docker compose -f docker-compose.yml restart director
   ```

### Backup Best Practices

- **Always back up before updates:** `scripts/update.sh` now creates an automatic pre-update backup
- **Manual backup:** `bash scripts/backup.sh --scope full`
- **Keep multiple backups:** Set `BACKUP_RETENTION_DAYS` in `.env` (default: 7 days)
- **Test restores periodically** to ensure backups are valid

## `docker restart` vs `docker compose up -d`

**Symptom:** You changed `.env` (display name, password, image tag) and restarted the container, but the change did not take effect.

**Cause:** `docker compose restart` restarts the existing container with its original environment. It does NOT re-read `.env` or recreate the container.

**Fix:** Use `docker compose up -d <service>` instead. This recreates the container with the updated environment:

```bash
# This picks up .env changes:
docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d survival_1

# This does NOT pick up .env changes:
docker compose restart survival_1
```

**When to use each:**
- `docker compose restart` - Quick restart, no config changes needed
- `docker compose up -d` - After changing `.env`, compose files, or image tags

---

**Last updated:** 2026-05-28  
**Version:** 1.4
