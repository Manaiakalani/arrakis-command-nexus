# Dune Awakening Self-Hosted Docker Server

![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-self--hosted%20stack-amber)

Run a self-hosted Dune Awakening battlegroup with Docker Compose, a helper CLI, and an admin dashboard.

## Key features

- Profile-based compose layouts for basic, standard, and full deployments
- `dune` CLI for setup, startup, updates, backups, and diagnostics
- Dashboard for maps, players, logs, backups, config, and Discord hooks
- Local-first security defaults for secrets, dashboard binding, and admin services

## Quick start

```bash
git clone <your-fork-or-repo-url> dune-server-docker
cd dune-server-docker
./dune init
./dune start
```

Before `./dune start`, download the dedicated server payload with SteamCMD:

```bash
steamcmd +login anonymous +app_update 3104830 validate +quit
```

## Screenshot

> Screenshot placeholder: add a dashboard image at `docs/assets/dashboard.png` and link it here.

## Full documentation

See [docs/README.md](./docs/README.md) for setup, configuration, profiles, networking, and troubleshooting.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test your changes locally
4. Open a pull request with a clear summary

## License

MIT
