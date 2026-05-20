# Dune Awakening Self-Hosted Docker Server

![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

Run a self-hosted **Dune Awakening** battlegroup with Docker Compose, a helper CLI, and a web dashboard.

## Key Features

- **Profile-based deployments** for basic (~20 GB), standard (~30-40 GB), and full (~40 GB+) battlegroups
- **`dune` CLI** for setup, startup, updates, backups, and diagnostics
- **Web dashboard** for maps, players, logs, backups, configuration, and Discord notifications
- **Security-first defaults** with localhost-only bindings, token auth, and secret redaction

## Prerequisites

- Linux host with Docker Engine and Docker Compose v2
- AVX2-capable CPU
- 20-40+ GB RAM depending on profile
- SteamCMD for downloading the dedicated server files

## Quick Start

```bash
# Download Funcom's dedicated server files
steamcmd +login anonymous +app_update 3104830 validate +quit

# Clone and start
git clone <your-repo-url> dune-server-docker
cd dune-server-docker
./dune init
./dune start
```

The dashboard is available at `http://localhost:18080` after startup.

## Documentation

| Guide | Description |
| ----- | ----------- |
| [Quick Start](./docs/QUICKSTART.md) | Get running in five minutes |
| [Configuration](./docs/CONFIGURATION.md) | Environment variables and config files |
| [Profiles](./docs/PROFILES.md) | Basic, standard, and full deployment layouts |
| [Networking](./docs/NETWORKING.md) | Ports, firewalls, and NAT hairpin fixes |
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Common issues and solutions |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test your changes locally
4. Open a pull request with a clear summary

## License

MIT
