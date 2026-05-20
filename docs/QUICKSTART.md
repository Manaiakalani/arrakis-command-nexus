# Quick Start

This guide gets a fresh Linux host from zero to a running Dune Awakening self-hosted stack in about five minutes once the server files are downloaded.

## 1. Prerequisites

- Linux host
- Docker Engine
- Docker Compose v2 (`docker compose`)
- SteamCMD or another way to run Steam's dedicated server download command
- Recommended RAM:
  - basic: ~20 GB
  - standard: ~30-40 GB
  - full: ~40 GB+

## 2. Download the dedicated server files from Steam

Install SteamCMD, then pull the Funcom package:

```bash
steamcmd +login anonymous +app_update 3104830 validate +quit
```

Keep note of the folder that contains the downloaded tarballs or extracted server files. The setup wizard will ask for it.

## 3. Clone this repository

```bash
git clone <your-fork-or-repo-url> dune-server-docker
cd dune-server-docker
```

## 4. Run the setup wizard

```bash
./dune init
```

The wizard walks through:

- world/server naming
- deployment profile selection
- external IP / host settings
- admin credentials and tokens
- Steam download path
- writing `.env`
- storing your Funcom token in `secrets/funcom-token.txt`

## 5. Start the stack

```bash
./dune start
```

This runs preflight checks, then starts the compose stack for the selected deployment profile plus the dashboard.

## 6. Open the dashboard

Visit:

- http://localhost:18080 on the server itself
- http://SERVER_IP:18080 only if you intentionally change `DUNE_ADMIN_BIND_ADDRESS` from `127.0.0.1`

## 7. Forward ports for external players

At minimum, forward the public game ports from your router to the Linux host:

- `31982/tcp` for game RabbitMQ traffic
- profile-specific UDP game ports
  - basic: `7777-7778/udp` and `7888-7889/udp`
  - standard: `7777-7785/udp` and `7888-7896/udp`
  - full: `7777-7810/udp` and `7888-7921/udp`

Also allow the same ports through the host firewall.

## Next Steps

- See [Configuration](./CONFIGURATION.md) to tune gameplay and engine settings
- See [Networking](./NETWORKING.md) before opening the server to the internet
- See [Profiles](./PROFILES.md) if you need to resize the battlegroup later
