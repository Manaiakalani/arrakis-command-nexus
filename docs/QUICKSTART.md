# Quick Start

This guide gets a fresh host from zero to a running Dune Awakening self-hosted stack in about five minutes once the server files are downloaded.

## 1. Prerequisites

- **Linux host** or **Windows 10/11 with WSL2** (see below)
- Docker Engine and Docker Compose v2 (`docker compose`)
- AVX2-capable CPU
- SteamCMD or another way to run Steam's dedicated server download command
- Recommended RAM:
  - basic: ~20 GB
  - standard: ~30-40 GB
  - full: ~40 GB+

### WSL2 Setup (Windows)

If you are running on Windows, use WSL2 with Docker Desktop:

1. **Enable WSL2** (PowerShell as admin):
   ```powershell
   wsl --install -d Ubuntu
   ```

2. **Install Docker Desktop** from [docker.com](https://www.docker.com/products/docker-desktop/) and enable the WSL2 backend in Settings > General > "Use the WSL 2 based engine".

3. **Set memory limits** by creating or editing `%USERPROFILE%\.wslconfig`:
   ```ini
   [wsl2]
   memory=24GB
   swap=4GB
   processors=4
   ```
   Restart WSL after editing: `wsl --shutdown`

4. **Run all commands inside your WSL2 terminal** (Ubuntu), not PowerShell. Clone the repo and run the `dune` CLI from there.

> **Note:** The Dune Awakening dedicated server requires Linux containers. Docker Desktop's WSL2 backend handles this automatically. Native Windows containers are not supported.

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

## 6. Open Arrakis Command Nexus

Visit:

- `http://your-server-ip:18080` if you expose the dashboard on your LAN
- `https://dashboard.your-domain.com` if you place the dashboard behind a reverse proxy
- If you keep the default local-only bind, open the dashboard from the host itself

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
