# Documentation

This project packages Funcom's dedicated server stack, helper scripts, Docker Compose files, and the Arrakis Command Nexus dashboard so you can run a private or community Dune Awakening battlegroup on your own infrastructure.

## Quick Links

- [Quick Start](./QUICKSTART.md)
- [Configuration Reference](./CONFIGURATION.md)
- [Config Keys](./CONFIG_KEYS.md)
- [Design System](./DESIGN.md)
- [Deployment Profiles](./PROFILES.md)
- [Map Management](./MAP_MANAGEMENT.md)
- [Networking Guide](./NETWORKING.md)
- [Cloudflare Tunnel](./CLOUDFLARE_TUNNEL.md)
- [Operations Runbook](./OPERATIONS.md)
- [Monitoring and Alerts](./MONITORING.md)
- [Deployment Notes](./DEPLOYMENT_NOTES.md)
- [Deep Desert Knobs](./DEEP_DESERT_KNOBS.md)
- [Resource Respawn Knobs](./RESOURCE_RESPAWN_KNOBS.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

## Project Overview

This project automates the moving parts required to self-host Dune Awakening:

- Docker Compose definitions for core infrastructure and game shards
- Profile-based deployments for `basic`, `standard`, and `full` battlegroups
- `dune` CLI for setup, startup, updates, backups, and diagnostics
- [Arrakis Command Nexus dashboard](./OPERATIONS.md#dashboard-map-and-teleport) for map orchestration, player visibility, player connection history, logs, backups, configuration, map teleport, base tracking, and public status sharing
- Security-focused defaults including local-only admin bindings and secret file support

## Architecture

```text
                        Internet / LAN Players
                                |
                         UDP game ports
                                |
                        +----------------+
                        |  gateway / RMQ |
                        +----------------+
                                 |
                +----------------+----------------+
                |                                 |
        +---------------+                +----------------+
        | director/text |                | game containers |
        | router/shims  |                | overmap, PvE,   |
        +---------------+                | deep desert...  |
                |                        +----------------+
                |                                 |
                +---------------+-----------------+
                                |
                      +----------------------+
                      | PostgreSQL + saves   |
                      +----------------------+
                                |
                      +----------------------+
                      | Dashboard API +      |
                      | Frontend (Next.js)   |
                      | dune CLI + backups   |
                      +----------------------+
```

## Features

- One-command initialization and startup via `dune init` and `dune start`
- Profile overlays for basic, standard, and full battlegroup layouts
- Dashboard with health monitoring, map controls, player management, config editing, game tweaks, backups, scheduled announcements, server restart scheduling, audit trail, logs, and Discord alerts (now including a `system` channel for backups, restarts, watchdog resource alerts, and admin actions)
- Mobile-friendly dashboard layout (44px tap targets, responsive header, iOS safe-area handling, slide-in nav drawer)
- Item spawn catalog with **410+** verified-real Unreal IDs, organized by 6 vehicle subsections + ammo/fuel/healkit/component/spice-dust/armor categories  -  every entry cross-checked against live `dune.items` rows so grants don't produce silent ghosts
- Backup and restore tooling for config, saves, and database snapshots
- Inventory conflict-detection script (`scripts/inventory-conflicts.sh`) for repairing duplicate `(inventory_id, position_index)` rows safely on a live server
- Repo sanitization script (`scripts/sanitize-check.sh`) to block accidental commits of hostnames, IPs, JWTs, RMQ secrets, or real Discord webhook URLs
- Steam image loading and update helpers for Funcom server packages
- Security-first defaults for admin services and secrets handling, with no-hardcoded-host configuration via `DUNE_SSH_USER`/`DUNE_SSH_HOST`/`DUNE_SERVER_DIR` env vars

## Requirements

- Linux host with Docker Engine and Docker Compose v2
- AVX2-capable CPU
- Recommended memory:
  - basic: 20 GB
  - standard: 30-40 GB
  - full: 40 GB+
- Enough storage for server images, saves, backups, and logs
- SteamCMD access to download dedicated server files

## Next Steps

1. Start with the [Quick Start](./QUICKSTART.md) guide
2. Tune settings in [Configuration](./CONFIGURATION.md)
3. Choose the right battlegroup size in [Profiles](./PROFILES.md)
4. Open ports safely with [Networking](./NETWORKING.md)
5. Check [Troubleshooting](./TROUBLESHOOTING.md) when something breaks
