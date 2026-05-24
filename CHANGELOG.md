# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
