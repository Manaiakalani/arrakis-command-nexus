# Monitoring and Alerts Guide

This guide covers the Arrakis Command Nexus watchdog, alert thresholds, and day-to-day monitoring checks.

## Watchdog Overview

The watchdog runs inside `dashboard-api`, polls Docker on a fixed interval, tracks restart velocity, records crash history, and can auto-restart monitored services.

Primary visibility points:

- Dashboard page: `/watchdog`
- API status: `GET /api/watchdog/status`
- API crash history: `GET /api/watchdog/crashes`

## Alert Types

| Alert | Trigger | Severity | Response |
| --- | --- | --- | --- |
| Crash detected | Container exits with non-zero code | High | Check logs, confirm exit code, watchdog auto-restarts when enabled |
| Crash-loop | 30+ restarts in 10 poll cycles, or 10+ restarts in one poll | Critical | Stop container, investigate root cause, check resource usage |
| Memory pressure | Container using more than 85% of its mem_limit | Warning | Consider increasing `MEM_LIMIT_<SERVICE>` in `.env` |
| CPU pressure | Container using more than 150% CPU | Warning | Check for crash-loops, runaway load, or oversized player activity |
| OOM-killed | Container killed by kernel OOM | Critical | Increase `MEM_LIMIT_<SERVICE>` immediately and monitor after restart |

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `WATCHDOG_ENABLED` | `true` | Turns watchdog polling on or off |
| `WATCHDOG_INTERVAL` | `30` | Poll interval in seconds |
| `WATCHDOG_CRASH_LOOP_THRESHOLD` | `10` | Restarts in a single poll that trigger a crash-loop alert |
| `WATCHDOG_CRASH_LOOP_RATE_WINDOW` | `10` | Number of polls in the rolling crash-loop window |
| `WATCHDOG_CRASH_LOOP_RATE_THRESHOLD` | `30` | Total restarts over the rolling window that trigger a crash-loop alert |
| `WATCHDOG_MEM_WARN_PCT` | `85` | Memory warning threshold as a percent of container limit |
| `WATCHDOG_CPU_WARN_PCT` | `150` | CPU warning threshold |
| `WATCHDOG_ALERT_COOLDOWN` | `300` | Cooldown in seconds per alert type per service |
| `WATCHDOG_AUTO_RESTART` | `true` | Automatically restarts monitored services after detected crashes |

## Discord Integration

When Discord notifications are configured, watchdog crash and crash-loop alerts are sent through the configured webhook.

Set these values in `.env`:

- `DISCORD_WEBHOOK_URL=<your webhook>`
- `DISCORD_NOTIFY_CRASH=true`

Note: the current environment variable is `DISCORD_NOTIFY_CRASH`. If you see older notes mentioning `DISCORD_NOTIFY_CRASHES`, prefer the singular form used by the stack.

## Checking Status

### Dashboard

Open the Watchdog page in the dashboard:

- `/watchdog`
- Shows current watchdog state
- Shows crash-loop tracking
- Shows recent crash events

### API

Check watchdog status:

```bash
curl http://localhost:18080/api/watchdog/status
```

Check recent crash events:

```bash
curl http://localhost:18080/api/watchdog/crashes
```

If your deployment requires read auth, include the admin token:

```bash
curl -H "X-Admin-Token: $DUNE_ADMIN_TOKEN" http://localhost:18080/api/watchdog/status
curl -H "X-Admin-Token: $DUNE_ADMIN_TOKEN" http://localhost:18080/api/watchdog/crashes
```

## Recommended Monitoring Workflow

1. Check `docker ps` for restart spikes or exited containers.
2. Check `/api/watchdog/status` for crash-loop activity.
3. Check `docker stats` for memory or CPU pressure.
4. Check container logs for the affected service.
5. If alerts are repeating, stop the offending service and fix the root cause before restarting it.

## Common Responses

### Crash detected

```bash
docker logs --tail 50 <container>
docker compose restart <service>
```

### Crash-loop

```bash
docker stats
docker compose stop <service>
```

Investigate partition failures, missing credentials, or resource starvation before bringing the service back.

### Memory pressure or OOM-killed

1. Increase the matching `MEM_LIMIT_<SERVICE>` in `.env`.
2. Recreate the service:
   ```bash
   docker compose up -d <service>
   ```
3. Watch `docker stats` until usage stabilizes.
