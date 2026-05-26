# Documentation

This project packages Funcom's dedicated server stack, helper scripts, Docker Compose files, and the Arrakis Command Nexus dashboard so you can run a private or community Dune Awakening battlegroup on your own infrastructure.

## Quick Links

- [Quick Start](./QUICKSTART.md)
- [Configuration Reference](./CONFIGURATION.md)
- [Config Keys](./CONFIG_KEYS.md)
- [Design System](./DESIGN.md)
- [Deployment Profiles](./PROFILES.md)
- [Networking Guide](./NETWORKING.md)
- [Operations Runbook](./OPERATIONS.md)
- [Monitoring and Alerts](./MONITORING.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

## Project Overview

This project automates the moving parts required to self-host Dune Awakening:

- Docker Compose definitions for core infrastructure and game shards
- Profile-based deployments for `basic`, `standard`, and `full` battlegroups
- `dune` CLI for setup, startup, updates, backups, and diagnostics
- Arrakis Command Nexus dashboard for map orchestration, player visibility, player connection history, logs, backups, configuration, and public status sharing
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
- Dashboard with health monitoring, map controls, player management, config editing, game tweaks, backups, scheduled announcements, server restart scheduling, audit trail, logs, and Discord alerts
- Backup and restore tooling for config, saves, and database snapshots
- Steam image loading and update helpers for Funcom server packages
- Security-first defaults for admin services and secrets handling

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
