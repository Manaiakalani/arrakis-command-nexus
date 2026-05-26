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

Restart a single shard or map service:

```bash
docker compose restart overmap
docker compose restart survival_1
```

To restart several map services together:

```bash
docker compose restart overmap survival_1 deepdesert_1
```

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

Check dashboard API health:

```bash
curl http://localhost:18080/api/health
curl http://localhost:18080/api/status
```

If read auth is required in your environment:

```bash
curl -H "X-Admin-Token: $DUNE_ADMIN_TOKEN" http://localhost:18080/api/status
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

#### Scheduled backups

Scheduled backups are controlled by `.env`:

- `BACKUP_SCHEDULE_ENABLED=false`
- `BACKUP_SCHEDULE_INTERVAL_HOURS=24`
- `BACKUP_RETENTION_DAYS=7`

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
