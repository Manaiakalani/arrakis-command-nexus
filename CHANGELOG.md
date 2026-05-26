# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.5.0] - 2026-05-25

### Added
- **Item catalog** expanded to 188 templates with human-readable display names (e.g., `GreatHouseComponent2` shows as "Mechanical Parts")
- **Stack size warnings** on item grants when requested quantity exceeds the game's observed max
- **Startup guard** that fails fast with a clear error if `DUNE_ADMIN_TOKEN` is still a placeholder
- Visible template ID subtitles in the item catalog (no hover required)
- Search now matches on display names, not just template IDs
- `DUNE_DASHBOARD_DB_URL` documented in `.env.example`

### Changed
- `DUNE_ADMIN_READ_AUTH` now defaults to `true` (all GET endpoints require auth)
- `MEM_LIMIT_OVERMAP` default increased from 2g to 8g
- Grant logging now includes inventory ID and position index for debugging
- Player connection tracker uses backoff on repeated failures

### Fixed
- `mktemp -u` race condition in `survival-pre-start.sh` (now uses `mktemp -d`)
- Swallowed database errors in `postgres_service.get_player_progress()` now logged
- Economy service stub methods no longer wrap no-ops in misleading try/except
- `farm_state` cleanup shows informative message instead of silent `|| true`
- CONFIGURATION.md defaults synced with `.env.example` (STEAM_APP_ID, IMAGE_TAG, MEM_LIMIT_OVERMAP)
- README clone URLs and Steam App ID corrected
- `setup.sh` defaults synced (IMAGE_TAG, MEM_LIMIT_OVERMAP)
- System settings UI shows correct 8g default for Overmap memory

### Security
- Read endpoints now require authentication by default
- Placeholder token detection prevents insecure deployments
- FIFO creation hardened against symlink races

## [1.4.0] - 2026-05-25

### Added
- **Server power management** with Stop, Start, and Restart buttons on the System page for bulk game server control
- **Post-deploy smoke test** (`scripts/smoke-test.sh`) with 42 checks across 7 categories (containers, API, routes, volumes, config, database, logs)
- `make smoke` target for quick regression testing after deploys
- `deps` option to `useApi` hook for automatic re-fetching when dependencies change

### Changed
- System telemetry charts now respond immediately to time range switching (15m, 1h, 6h, 24h, 7d, 30d)
- Uptime chart also re-fetches on range change
- Dashboard SQLite database persisted via bind mount (`./dashboard-data/`) to survive container rebuilds

### Fixed
- Overview page crash when PostgreSQL is temporarily unreachable (DNS resolution failure in `asyncio.gather`)
- Dashboard SQLite database wiped on every container rebuild (no persistent volume)
- CSS build failure from invalid Tailwind arbitrary opacity value (`bg-th-surface/78` to `bg-th-surface/[0.78]`)
- Discord webhook data lost on redeploy (same root cause as DB persistence)
- `.env` parsing failure in smoke test when values contain unquoted spaces (e.g., `WORLD_REGION=North America`)

## [1.3.0] - 2026-05-25

### Added
- **Audit trail** page with filterable log of all admin actions, player logins/logouts, config changes, and grants
- **Scheduled announcements** for recurring or one-time in-game messages with interval or specific time
- **Scheduled server restarts** with automatic pre-restart warnings and backup-before-restart
- **Game tweak settings** for sandworm behavior, NPC difficulty, mining rates, loot drops, day/night cycle, crafting costs, hydration, and vehicle durability
- **Toast notifications** across all dashboard pages for real-time user feedback
- **Container-compatible backup/restore scripts** using pg_dump/psql directly (no Docker-in-Docker needed)
- **Design system document** (`docs/DESIGN.md`) with complete token, component, and pattern reference
- **Excalidraw architecture diagrams** for system and dashboard feature mapping
- Sidebar grouped into 6 logical sections (Core, Players, Server, Operations, Communication, Admin)
- Player login/logout events tracked in audit log and connection history
- Item grant stats fix: `FItemStackAndDurabilityStats` now included so granted items appear in-game

### Changed
- Light mode theme warmed up with sandy/amber tones matching the Dune aesthetic
- Sidebar reorganized from 17 flat items into grouped sections with headers
- UserGame.ini and UserEngine.ini file descriptions updated to reflect game tweak capabilities
- API Dockerfile now includes PostgreSQL 17 client for backup compatibility
- README updated with new feature descriptions and documentation links

### Fixed
- Backup creation 404 error (`/app/scripts/backup.sh` not found in API container)
- Backup script POSIX sh compatibility (was using bash-only syntax in dash container)
- pg_dump version mismatch (container had v15, server runs v17)
- Backup directory permissions (owned by root, now writable by app user)
- Granted items not appearing in-game (missing `FItemStackAndDurabilityStats` in stats JSON)
- Unicode ellipsis characters (`...`) replaced with ASCII equivalents across frontend
- Audit page CSS classes fixed from `sand-*` to proper `th-*` theme tokens

## [1.2.0] - 2026-05-24

### Changed
- Upgraded Next.js from 14.2.x to 15.5.18, resolving 13 security advisories (DoS, SSRF, cache poisoning, XSS)
- Upgraded React and React DOM from 18.x to 19.x (required by Next.js 15)
- Upgraded PostCSS to 8.5.x with npm override to patch transitive XSS vulnerability (CVE-2026-41305)
- Upgraded python-dotenv from 1.1.0 to 1.2.2 to fix symlink overwrite vulnerability (CVE-2026-28684)
- Upgraded eslint-config-next to 15.5.18 for compatibility
- Pinned `DUNE_IMAGE_TAG` in `.env.example` to specific version instead of `latest`

### Added
- `.github/CODEOWNERS` file assigning repository ownership
- Graceful shutdown (`stop_grace_period: 30s`) for dashboard-api and dashboard-frontend
- Playwright e2e-check job in CI pipeline

### Security
- All 17 Dependabot alerts resolved (0 remaining)
- PostCSS override ensures no vulnerable transitive copies in the dependency tree
- `CODEOWNERS` enforces review requirements for all code changes

## [1.1.0] - 2026-05-24

### Added
- OOM (Out of Memory) crash detection in watchdog with remediation advice in Discord alerts
- Host tuning script (`scripts/host-tuning.sh`) for VM memory and kernel parameter optimization
- Snapshot collection script (`scripts/collect-snapshot.sh`) for diagnostics
- Playwright end-to-end test suite (46 tests covering all dashboard pages)
- Security response headers middleware (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- Secret rotation runbook, incident response playbook, and log retention policy in SECURITY.md

### Changed
- Upgraded admin token startup check from warning to critical log level; distinguishes dev vs production mode
- Pinned all GitHub Actions to commit SHAs for supply-chain security
- Frontend `depends_on` now uses `service_healthy` instead of `service_started` for reliable boot ordering
- Discord webhook URLs are masked in API responses (shows only last 6 characters)
- Container healthchecks use `kill -0 1` (detects zombies) instead of `/proc/1/status` file check
- Generic error messages on 500 responses; full details logged server-side only

### Removed
- `EXEC` permission from Docker socket proxy (attack surface reduction)

### Security
- Security response headers on all HTTP responses
- Default admin token blocked with critical warning in production mode
- Docker socket proxy EXEC access removed
- CI actions pinned to commit SHAs to prevent tag-swap supply-chain attacks
- Webhook URL masking prevents credential exposure via API
- Exception details no longer leak to HTTP clients

## [1.0.0] - 2026-05-24

### Added
- Docker Compose deployment for the complete Dune Awakening self-hosted stack
- Profile-based battlegroups (basic, standard, full) with scaling guidance
- `dune` CLI for setup, startup, shutdown, updates, backups, and diagnostics
- Arrakis Command Nexus companion dashboard (FastAPI + Next.js)
- Real-time system telemetry (CPU, memory, disk, network) with 15-second intervals
- Map orchestration with start, stop, restart, and backup per shard
- Player tracking with online roster, session timers, kick controls, and connection history
- Live log streaming with search, filtering, and download
- Hagga Basin player position map with heatmap overlay
- Configuration editor with drift detection
- Backup and restore workflows with scheduled retention
- Discord webhook notifications for server events
- Public status page for shareable read-only health view
- Light and dark mode across the entire dashboard UI
- In-game chat announcements via RabbitMQ
- Chat spam protection with configurable thresholds
- Economy anomaly monitoring with alert system
- Character inspection tools
- Automatic crash recovery with health checks and watchdog
- Partition repair sidecar for database consistency
- WSL2 support documentation for Windows hosts
- Token-based admin authentication with secret file support
- Prometheus-compatible metrics endpoint for monitoring integration
- Rate-limited public status endpoint
- GitHub Actions CI for build validation
- Comprehensive documentation suite (quickstart, configuration, networking, profiles, troubleshooting)
- VM image builder with VHD/VHDX/VMDK/QCOW2 output for Hyper-V, VirtualBox, and Proxmox

### Security
- Admin token authentication on all API endpoints
- CORS hardening with explicit origin allowlisting
- Log redaction for sensitive credentials
- Container name allowlisting for Docker operations
- Path traversal protection on config and backup endpoints
- SQL injection prevention in helper scripts
- Symlink blocking in file operations
- Docker socket proxy (tecnativa/docker-socket-proxy) replacing direct socket mount
- Internal backend network isolating dashboard API from public traffic
- Non-root container execution with no-new-privileges policy
- Pinned Docker base images for reproducible builds
- Request audit logging with client IP tracking
- CI security scanning (pip-audit, npm audit)
- SECURITY.md with responsible disclosure and hardening checklist
