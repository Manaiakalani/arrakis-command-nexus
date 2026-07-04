# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Watchdog crash forensics: crash, crash-loop, and high-crash-rate Discord alerts now include an exit-code label (e.g. `139 SIGSEGV (segfault)`), an attribution hint (upstream Funcom/UE5 vs local OOM/config), and the best-effort fault line scraped from container logs
- Crash events are now persisted to a `watchdog_crashes` table so forensic history survives dashboard-api restarts; `GET /api/watchdog/crashes` reads from the DB (falling back to the in-memory buffer)
- `smoke-test.sh` now checks `/api/watchdog/status` and `/api/watchdog/crashes`
- `.env.example` now documents `DUNE_COMPOSE_OVERLAY`, `POSTGRES_DB_NAME`, `RESTART_COOLDOWN_SECONDS`, and `WATCHDOG_RMQ_GHOST_CLEANUP`
- Player allowlist management is now fully wired: the Allowlist tab on the Players page can add, list, and remove approved Steam IDs (new `DELETE /api/players/allowlist/{steam_id}` endpoint) with audit logging and Discord admin notifications, replacing the previous read-only placeholder
- New "Server Identity" panel on the Settings page lets operators change the in-game server name (`WORLD_NAME`) and broadcast address (`EXTERNAL_ADDRESS`); saving writes `.env` and recreates the game-server containers so the change is applied for real (new `GET`/`PUT /api/server/identity`)
- New "Connectivity and Travel Recovery" section on the Game Settings page exposes the per-map reconnect grace periods (`m_DefaultReconnectGracePeriodSeconds`, `m_OvermapReturnGracePeriodSeconds`, `m_InstancedMapReconnectGracePeriodSeconds`) with descriptions and recommended presets
- `scripts/dune-stack.service`: a systemd template that runs `dune start`/`dune stop` to bring the whole stack up on boot and down on shutdown (edit `User=` and the install path, then `systemctl enable --now dune-stack.service`)
- Troubleshooting now documents the complete in-game rubberbanding playbook - the `docker-compose.hostnet.yml` host-networking overlay, UDP socket receive-buffer sizing (with `RcvbufErrors` diagnosis), and NIC ring-buffer/GRO tuning - and the README Host Optimization section and docs index now surface `scripts/cpu-pin.sh`, the host-networking overlay, and the Operations and Monitoring guides

### Fixed
- **Dashboard "Apply Update" failing with `steamcmd failed (rc=8)`:** the `dashboard-api` image installed `lib32gcc-s1` for SteamCMD's 32-bit `linux32/steamcmd` binary but not `lib32stdc++6`, so the binary's dynamic linker failed immediately after `steamcmd.sh` handed off to it (visible as `steamcmd.sh[PID]: Starting /home/app/steamcmd/linux32/steamcmd` followed by exit code 8, with no further output). `dashboard/backend/Dockerfile` now installs `lib32stdc++6` alongside `lib32gcc-s1`. Existing deployments need to rebuild the `dashboard-api` image (`docker compose build dashboard-api && docker compose up -d dashboard-api`). See `docs/TROUBLESHOOTING.md` → "Apply Update Fails with steamcmd failed (rc=8)"
- **Dashboard "Apply Update" OOM-killed mid-download (same `rc=8` message, different cause):** after fixing the missing library above, SteamCMD could start and log in but still fail with `rc=8` once it began actually downloading the multi-GB game server depot — the kernel's OOM killer was terminating the `steamcmd` process because `dashboard-api`'s `mem_limit`/`memswap_limit` was only `512m`, and the idle dashboard API process alone already used ~200MiB, leaving too little headroom. Raised both limits to `2g` in `docker-compose.yml`. A stuck update can also leave a stale `appmanifest_<id>.acf` reporting `state is 0x6` with 0 bytes planned to download on every retry; deleting that file forces SteamCMD to recompute a fresh update plan. See `docs/TROUBLESHOOTING.md` → "Same error, but after download progress starts (OOM kill)"
- **S2S reliable-channel overflow crash (NumOutRec 2047):** survival_1 periodically crashed with no visible segfault/OOM because UE5's 2048-slot reliable message queue overflowed on the S2S self-connection (`Channel->NumOutRec 2047 exceeds 2047`). This caused survival_1 to mark itself dead and exit, then Docker auto-restarted it. The overflow occurred because default UE5 bandwidth caps throttled S2S message throughput below the rate needed during busy game events (spice blows, sandworms, cross-partition entity updates). Fix: all game servers now launch with `MaxClientRate=0` and `MaxInternetClientRate=0` on both the `IgwNetDriver` and `IpNetDriver` (removing bandwidth caps) plus `NetServerMaxTickRate=120` (doubling the network tick rate), and `-forcelogflush` for crash diagnostics. Applied across `basic`, `standard`, `standard-lean`, and `full` profiles. See `docs/TROUBLESHOOTING.md` → "S2S Reliable-Channel Overflow (NumOutRec 2047)"

### Changed
- The standard profile (all maps) partition wiring was corrected so every map server registers on its canonical partition and cross-map travel works. `survival_1` and `overmap` had their game ports swapped relative to the proven basic profile and to `PARTITION_PORT_MAP`, so partition-repair would assign each server the wrong partition; survival is back on UDP `7777`/`7888` (partition 1) and overmap on `7778`/`7889` (partition 2). The `-PartitionIndex` values for the remaining maps were sequential-by-port instead of matching the canonical `world_partition` ids seeded by `bootstrap_db.py`; they are now aligned (Deep Desert 8, Arrakeen 3, Harko Village 4, Hephaestus 5, Carthag 6, WaterFat 7, Proces-Verbal 9). Every standard map server now sets `GAME_PORT` (previously unset, which skipped the entrypoint's stale `farm_state` cleanup and risked a crash loop on bring-up) and receives the full shared BackendLogin/Authentication secret block (previously only a subset), matching basic so player hand-offs between maps authenticate against the director
- `PARTITION_PORT_MAP` (the partition-repair port-to-map table) is now overridable from `.env` instead of being hardcoded to the two basic-profile ports; `.env.example` documents the full standard-profile value. The basic profile is unchanged: partition_repair.py falls back to its built-in `{"7777":"Survival_1","7778":"Overmap"}` default when the variable is unset
- `partition-repair` watch loop now re-applies the `get_active_servers_for_gateway()` and `load_world_partition()` function patches every cycle (idempotent, quiet unless a re-patch is needed), so a Funcom image upgrade, a `db-init` re-run, or a manual `psql` session that restores the stock definitions can no longer silently regress them until the container is restarted. Both patches detect the already-applied state with a positive sentinel and use `CREATE OR REPLACE` so the heavily-used functions are never briefly dropped
- README "Common CLI Commands" now lists `dune dashboard` and `dune doctor`
- QUICKSTART shows the explicit `http://127.0.0.1:18080` URL for the default local-only bind
- `*.tsbuildinfo` is now gitignored and the previously tracked `dashboard/frontend/tsconfig.tsbuildinfo` build artifact was removed, so a fresh build no longer dirties the working tree
- Spawnable-item grants now validate quantity at every layer (client, API schema, and service): stack size must be 1 to 10000 and quality 0 to 10, and the character editor gives explicit feedback when no character is selected or the quantity is invalid instead of silently doing nothing
- Item-template search and catalog browse now surface failures as an error toast (previously they failed silently) and show an info toast when a search returns no matches
- `allowlist_add` and `allowlist_remove` audit events now count toward the Audit page "Player" summary card
- The Hagga Basin map tactical and chart views now span the full blade width: removed the `min(92vh, 1600px)` max-width cap and `mx-auto` centering so the map fills the available column instead of sitting in a narrow centered box

### Fixed
- In-game rubberbanding caused by Docker bridge networking jitter: new `docker-compose.hostnet.yml` overlay moves `survival_1` to `network_mode: host`, bypassing the Docker bridge/iptables/veth stack entirely. Game UDP packets go directly from the NIC to the server process socket. Confirmed by A/B test: bridge mode = rubberband, host mode = smooth. Enable via `DUNE_HOSTNET_OVERLAY=docker-compose.hostnet.yml` in `.env` (requires `HOST_LAN_IP`); the `dune` CLI then appends the overlay automatically. See `docs/TROUBLESHOOTING.md` -> "In-Game Rubberbanding - Host Networking Overlay"
- In-game rubberbanding on multi-map hosts from CPU core contention: new `scripts/cpu-pin.sh` partitions physical cores so the main world's UE5 game thread always has a free execution context (measured reduction from 15% scheduling delay to 1.3%). Includes NIC IRQ affinity pinning to keep hardware interrupts off the dedicated game-server cores. Run `sudo ./scripts/cpu-pin.sh --install` to persist via a systemd timer
- Docker `userland-proxy` should be set to `false` in `/etc/docker/daemon.json` for game-server hosts: the default spawns a Go userland proxy process per published port (36 on a standard-profile host), routing all game UDP through userspace instead of kernel iptables DNAT. Disabling it eliminates those processes and lets game packets traverse a pure kernel path. Added to `docs/TROUBLESHOOTING.md`
- UDP socket receive-buffer overflow causing silent packet loss: UE5's default `ServerDesiredSocketReceiveBufferBytes` (256 KB) overflows under S2S mesh traffic bursts from peer servers. All game servers now set `ServerDesiredSocketReceiveBufferBytes=16777216` (16 MB) and `ServerDesiredSocketSendBufferBytes=4194304` (4 MB) for both the game `IpNetDriver` and S2S `IgwNetDriver`, applied across the `basic` and `standard` profiles
- Dashboard game-server restart on settings changes now targets all active game servers instead of only `survival_1` and `overmap`, so identity and password changes apply to the full standard/full fleet
- Dashboard Discord webhook enable/disable toggle now persists correctly (the backend `DiscordWebhookUpdate` model was missing the `enabled` and `name` fields; the save button no longer sends the masked webhook URL back to the server)
- Dashboard admin management endpoints now return proper HTTP 400/404/409 on validation errors instead of HTTP 200 with an error JSON body
- Idle game-server crash loop on multi-map profiles: with no players connected, the inter-server (S2S / Inter Game World) mesh links between map servers carried no traffic and were dropped after Funcom's `IgwNetDriver` `ConnectionTimeout` (shipped default 600 seconds). A dropped S2S link made `AS2sController` mark the peer dead and reset the world partition, which tripped a Funcom world-partition quad-tree segfault (`DuneWorldPartitioner.cpp` "Failed to find local server in quad tree") that cascaded to every map server; Docker then auto-restarted them, repeating on roughly a 10-minute cadence (the blast radius scales with the number of maps, so `standard` and `full` were hit far more often than a one or two map deployment). Every game server is now launched with `-ini:engine:[/Script/InfiniteGameWorlds.IgwNetDriver]:ConnectionTimeout=604800.0`, so idle S2S links are no longer dropped during normal operation; applied across the `basic`, `standard`, and `full` profiles. Only the inter-server driver is affected; the game-client driver (`[/Script/OnlineSubsystemUtils.IpNetDriver]`, 60 seconds) is left unchanged so player connections still time out normally. See `docs/TROUBLESHOOTING.md` -> "Idle Multi-Map Crash-Loop (S2S ConnectionTimeout)"
- Players could not join Deep Desert or Arrakeen on the standard profile and were stuck in the join queue. Deep Desert had `MinServers=0`, so the director never guaranteed a shard for the always-running container, and the social hubs and story shards were missing from `[InstancingModes]` entirely. `config/director.ini` now declares `SH_Arrakeen`, `SH_HarkoVillage`, and the four story maps as `SingleServer`, gives each a player cap, and sets Deep Desert `MinServers=1`
- Overworld travel (`Error: P83`) at the source: the overworld (`overmap`) container was loading the Hagga Basin level (`Survival_1`) instead of the Overland level, so the Overland partition never hosted real overworld content and travel could not resolve a destination (this also drove an `overmap` crash loop). Two compounding compose-argument bugs caused it. First, `-MultiHome=$POD_IP` used a single `$`, which `docker compose` interpolated to an empty string before the entrypoint could substitute the per-container IP, and the empty `-MultiHome=` then swallowed the adjacent positional map path. Second, even once `-MultiHome` was fixed, the map was a positional argument placed after the options, which Unreal ignores (it reads the startup map only from the first positional argument), so the server fell back to the shipped `ServerDefaultMap` (`Survival_1`). Fixed by escaping the variable as `-MultiHome=$$POD_IP` and replacing the positional map with an explicit `ServerDefaultMap` override (`-ini:engine:[/Script/EngineSettings.GameMapsSettings]:ServerDefaultMap=<map>`), applied to every non-survival map server across the `basic`, `standard`, and `full` profiles. The overworld server now loads `/Game/Dune/Systems/Overmap/Overmap`, reports `farm_state.map='Overmap'`, and is discoverable on its canonical partition. See `docs/TROUBLESHOOTING.md` -> "P83 on overworld travel - overworld server loaded the wrong level"
- The Settings "Server name" field was a no-op: it saved only to the dashboard database and never wrote `.env` or recreated the game servers, so renaming the server in the dashboard did not change the name players saw in the in-game server browser. The new Server Identity control writes `.env` and recreates the game-server containers, and the redundant name field was removed from the General panel
- Three shipped `UserGame.ini` keys (`m_OvermapReturnGracePeriodSeconds`, `m_InstancedMapReconnectGracePeriodSeconds`, `m_bBuildingRestrictionLimitsEnabled`) now have field definitions, so they render with a description and a typed input in the dashboard config editor instead of as bare auto-typed values
- Allowlist Steam IDs and player names are now length-checked (max 32 and 255 characters) so over-long input returns a clean 422 instead of a database error, and concurrent duplicate adds to the allowlist or ban list now return 409 instead of an unhandled 500
- The allowlist tab description no longer claims a `UseAllowList` server toggle enforces dashboard entries (`UseAllowList` is a sandworm-system config enum, unrelated to player access); it now accurately describes the allowlist as a dashboard-maintained roster
- The Next.js dashboard build no longer emits the workspace-root inference and `metadataBase` warnings (pinned `outputFileTracingRoot` and set `metadataBase`)
- Overworld travel (`Error: P83` / `UpdateTravelDestination(... unable to find destination)`): `scripts/partition_repair.py` now patches `get_active_servers_for_gateway()` to report each server's true per-partition map (`world_partition.map`) instead of the farm-level `farm_state.map`. Every server writes `farm_state.map='Survival_1'`, so the overworld server was being advertised to gateway destination discovery as `Survival_1` rather than `Overmap`, leaving no server registered for the overworld map. Returning `wp.map` makes the overworld server discoverable on its canonical partition without adding a partition row or renaming the stored map (the director keeps matching its `Overmap` PerMapConfig). See `docs/TROUBLESHOOTING.md` -> "P83 on overworld travel"
- The `dune` CLI and all entry-point scripts are now tracked as executable (mode `755`). Previously they were committed as `644`, so a fresh clone failed with "Permission denied" on `./dune` and on every `dune` subcommand that `exec`s a script (`backup`, `deploy`, `doctor`, `update`, …)
- `fix-perms.sh` (`dune fix-perms`) now also normalizes the bind-mounted `.env`, granting the dashboard-api container group (uid 999) read/write while preserving the host owner (mode 660). Without this, a tightly-permissioned `.env` (for example mode 600 left by a secure copy during a host migration) made `/api/status` fail with a `PermissionError` reading `WORLD_NAME` and blocked the Server Identity and password controls from writing
- `dune backup` and `dune restore` no longer fail with `FATAL: role "postgres" does not exist` on a default install: they now connect to PostgreSQL as the `dune` role and pass `POSTGRES_DUNE_PASSWORD` (the credentials the stack actually provisions) instead of an unset `POSTGRES_USER` that fell back to a nonexistent `postgres` superuser. Both commands and the `dune doctor` Postgres readiness check now also honor `POSTGRES_DB_NAME` when resolving the target database
- `smoke-test.sh` error scan no longer raises a false warning from benign INFO log lines (e.g. pika's `error=None` / clean AMQP `Normal shutdown`); it now matches log-level `ERROR`/`CRITICAL`/`FATAL`, `Traceback`, and unhandled-exception markers
- `preflight` no longer crashes with a `JSONDecodeError` traceback on newer Docker Compose: `compose_running_ports()` now parses both newline-delimited JSON (newer `docker compose ps --format json`) and the legacy JSON array. This also stops preflight from misreporting the stack's own ports as foreign conflicts.
- `dune dashboard` and the `dune init` summary now print the correct dashboard URL (derived from `DUNE_ADMIN_BIND_ADDRESS`/`DUNE_ADMIN_HOST_PORT`, default `http://127.0.0.1:18080`) instead of the stale `http://localhost:3000`
- `dune dashboard` no longer aborts on headless hosts: it always prints the URL and only attempts to open a browser when a launcher (`xdg-open`/`open`) is present
- `preflight` now flags a `change-me` Funcom token (`FLS_SECRET`) as missing instead of letting the placeholder pass
- Watchdog RMQ ghost-cleanup default aligned to disabled (`False`) in code, matching the documented compose default (avoids breaking S2S peer-index convergence when the backend runs outside compose)
- `dune fix-p83` (alias `rmq-ghost-cleanup`) now reaps orphaned `<HEXID>_queue` queues that linger with 0 consumers after a player's connection drops, in addition to closing duplicate "ghost" connections. These queues keep accumulating presence/chat messages and can eventually trip the RMQ memory watermark (a broker-wide P83 cause); the reaper deletes one only when its owner has no running player connection, using `delete_queue --if-unused`, and the game re-declares it on the player's next login
- README clone URLs corrected to `arrakis-command-nexus.git`; contributor branch base corrected from `master` to `main`
- The Announcements placeholder rendered a literal `\u2026` escape sequence instead of an ellipsis; replaced with the literal `…` character

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
