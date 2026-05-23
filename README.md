# Dune Awakening Self-Hosted Docker Server

[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Docker Compose](https://img.shields.io/badge/docker%20compose-v2-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20WSL2-lightgrey)](./docs/QUICKSTART.md)

> Self-host your own **Dune Awakening** dedicated server with Docker Compose, a CLI tool, and a full-featured web dashboard.

The easiest way to run a private Dune Awakening battlegroup on your own hardware. Works on bare-metal Linux, VMs, Proxmox, and Windows via WSL2.

---

## Why This Project?

Funcom's official self-hosting instructions require manual setup of PostgreSQL, RabbitMQ, and multiple game server processes. This project wraps everything into a single `docker compose up` with:

- **Zero manual database setup** - PostgreSQL, schemas, and partitions are initialized automatically
- **Automatic crash recovery** - partition repair sidecar and watchdog keep servers running
- **Web dashboard** - manage your server from a browser instead of the command line
- **One-command deployment** - `./dune init && ./dune start` gets you running in minutes

## Key Features

### Server Management
- **Profile-based deployments** - basic (~20 GB), standard (~30-40 GB), and full (~40 GB+) battlegroup configurations
- **`dune` CLI** - setup wizard, startup, updates, backups, and diagnostics
- **Map orchestration** - start, stop, restart, and backup individual map shards
- **Crash detection** - automatic watchdog with configurable restart policies
- **Partition repair** - sidecar service that fixes database partition conflicts after restarts

### Web Dashboard (Arrakis Command Nexus)
- **Server overview** - real-time CPU, memory, uptime, and player count per map
- **Live log streaming** - searchable, filterable SSE-based log viewer with download support
- **System telemetry** - CPU, memory, disk, and network charts with 24-hour history
- **Player management** - online player list, session tracking, kick capability
- **Configuration editor** - edit server settings with drift detection
- **Backup management** - manual and scheduled backups with retention policies
- **Discord integration** - webhook notifications for server events
- **In-game announcements** - send messages to players via RabbitMQ
- **Economy monitoring** - anomaly detection for in-game currency
- **Chat protection** - spam and rate-limit guard with auto-kick
- **Character editor** - view and modify player character stats
- **Public status page** - shareable server status (no auth required)

### Security
- **Token-based authentication** with constant-time comparison
- **Localhost-only bindings** by default
- **Secret redaction** in logs and API responses
- **Container allowlist** - API operations restricted to compose project containers
- **Configurable CORS** and mutation controls

### Infrastructure
- **Docker Compose** orchestration with health checks on all services
- **PostgreSQL** with automatic schema initialization
- **RabbitMQ** with TLS-ready configuration
- **WSL2 compatible** - run on Windows 10/11 with Docker Desktop

## Prerequisites

| Requirement | Details |
| ----------- | ------- |
| **OS** | Linux (Ubuntu, Debian, RHEL) or Windows 10/11 with WSL2 |
| **Docker** | Docker Engine + Docker Compose v2 |
| **CPU** | AVX2 support required |
| **RAM** | 20-40+ GB depending on profile |
| **Storage** | 50+ GB for server files and database |
| **Network** | Public IP or port forwarding for online play |

## Quick Start

```bash
# 1. Download Funcom's dedicated server files
steamcmd +login anonymous +app_update 3104830 validate +quit

# 2. Clone and configure
git clone https://github.com/your-username/dune-server-docker.git
cd dune-server-docker
./dune init

# 3. Start the server
./dune start
```

The dashboard is available at `http://localhost:18080` after startup.

### Windows (WSL2)

```powershell
# Enable WSL2 and install Ubuntu
wsl --install -d Ubuntu
```

Then install Docker Desktop with the WSL2 backend enabled, open an Ubuntu terminal, and follow the Linux quick start above. See [Quick Start](./docs/QUICKSTART.md) for detailed WSL2 memory configuration.

## Architecture

```
                    +-----------------+
                    |  Web Dashboard  |  :18080
                    |  (Next.js)      |
                    +--------+--------+
                             |
                    +--------+--------+
                    |  Dashboard API  |  FastAPI
                    |  (Python)       |
                    +--------+--------+
                             |
          +------------------+------------------+
          |                  |                  |
  +-------+------+  +-------+------+  +--------+-------+
  |  PostgreSQL  |  |  RabbitMQ    |  |  Docker Socket |
  |  (game DB)   |  |  (game msg)  |  |  (management)  |
  +--------------+  +--------------+  +----------------+
          |                  |
  +-------+------------------+-------+
  |            Game Servers           |
  |  Survival | Overmap | Deep Desert|
  +----------------------------------+
```

## Documentation

| Guide | Description |
| ----- | ----------- |
| [Quick Start](./docs/QUICKSTART.md) | Get running in five minutes (Linux and WSL2) |
| [Configuration](./docs/CONFIGURATION.md) | Environment variables and config files |
| [Config Keys](./docs/CONFIG_KEYS.md) | Complete reference of all server config keys |
| [Profiles](./docs/PROFILES.md) | Basic, standard, and full deployment layouts |
| [Networking](./docs/NETWORKING.md) | Ports, firewalls, and NAT hairpin fixes |
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Common issues and solutions (including WSL2) |

## CLI Commands

```bash
./dune init        # Interactive setup wizard
./dune start       # Start the server stack
./dune stop        # Stop all services
./dune restart     # Restart the stack
./dune status      # Show service health
./dune logs        # Tail service logs
./dune backup      # Create a backup snapshot
./dune restore     # Restore from a backup
./dune update      # Pull latest server images
./dune preflight   # Run pre-start checks
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test your changes locally
4. Open a pull request with a clear summary

## Related Projects

- [Funcom Self-Hosting Docs](https://duneawakening.com/self-hosted-servers/) - Official setup instructions
- [comfuzio/OpenDune-Director](https://github.com/comfuzio/OpenDune-Director) - Alternative director implementation
- [Nerrowake/sietch-console](https://github.com/Nerrowake/sietch-console) - Console-based management tool

## License

MIT
