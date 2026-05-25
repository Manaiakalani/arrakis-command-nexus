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
- Re-download the package with `steamcmd +login anonymous +app_update 3104830 validate +quit`

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
appear under the Experimental tab in the game's server browser.

**Root causes (check in order):**

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
