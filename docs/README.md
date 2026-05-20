# Documentation

Dune Awakening Self-Hosted Docker Server packages the Funcom dedicated server stack, helper scripts, and a web dashboard so you can run a private battlegroup on your own Linux host.

## Quick links

- [Quick start](./QUICKSTART.md)
- [Configuration reference](./CONFIGURATION.md)
- [Deployment profiles](./PROFILES.md)
- [Networking guide](./NETWORKING.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

## Project overview

This project automates the moving parts required to self-host Dune Awakening:

- Docker Compose definitions for core infrastructure and game shards
- Profile-based deployments for small, medium, and large battlegroups
- A `dune` CLI for setup, startup, updates, backups, and diagnostics
- A dashboard for map orchestration, player visibility, logs, backups, and configuration
- Security-focused defaults such as localhost-only admin bindings and secret file support

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
                      | Dashboard API/Nginx  |
                      | dune CLI + backups   |
                      +----------------------+
```

## Features

- One-command initialization and start workflow through `dune init` and `dune start`
- Profile overlays for basic, standard, and full battlegroup layouts
- Dashboard views for health, maps, players, config, backups, logs, and Discord alerts
- Backup and restore tooling for config, saves, and database snapshots
- Steam image loading and update helpers for Funcom server packages
- Local-first security defaults for admin services and secrets handling

## Requirements

- Linux host with Docker Engine and Docker Compose v2
- AVX2-capable CPU
- Recommended memory:
  - basic: 20 GB
  - standard: 30-40 GB
  - full: 40 GB+
- Enough storage for server images, saves, backups, and logs
- SteamCMD access to download dedicated server files

## Where to go next

1. Start with [QUICKSTART.md](./QUICKSTART.md)
2. Tune settings in [CONFIGURATION.md](./CONFIGURATION.md)
3. Choose the right battlegroup size in [PROFILES.md](./PROFILES.md)
4. Open ports safely with [NETWORKING.md](./NETWORKING.md)
5. Use [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) when something breaks
