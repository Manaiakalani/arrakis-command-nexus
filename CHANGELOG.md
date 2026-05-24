# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
