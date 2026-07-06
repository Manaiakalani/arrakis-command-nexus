# Quick Start

This guide gets a fresh host from zero to a running Dune Awakening self-hosted stack in about five minutes once the server files are downloaded.

## 1. Prerequisites

- **Linux host (Bare Metal or VM)** or **Windows 10/11 with WSL2** (see below)
- Docker Engine and Docker Compose v2 (`docker compose`)
- AVX2-capable CPU
- SteamCMD or another way to run Steam's dedicated server download command
- Recommended RAM:
  - basic: ~20 GB
  - standard: ~30-40 GB
  - full: ~40 GB+

### Bare Metal Linux Setup (Ubuntu 22.04/24.04/26.04)

If you are running a dedicated Linux machine:

1. **Install Docker Engine** using the official `apt` repository:
   ```bash
   # Add Docker's official GPG key:
   sudo apt-get update
   sudo apt-get install ca-certificates curl
   sudo install -m 0755 -d /etc/apt/keyrings
   sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   sudo chmod a+r /etc/apt/keyrings/docker.asc

   # Add the repository to Apt sources:
   echo \
     "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
     $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
     sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   sudo apt-get update

   # Install Docker Engine and Compose
   sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   ```

2. **Add your user to the `docker` group** so you don't need `sudo` to run containers:
   ```bash
   sudo usermod -aG docker $USER
   newgrp docker
   ```

3. **Create swap (Recommended for systems with <40GB RAM)**:
   ```bash
   sudo fallocate -l 8G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

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

Install SteamCMD, then pull the Funcom package. The dedicated server files are
free to download - anonymous login works for **both** the retail App ID (`4754530`)
and the PTC (playtest) App ID (`3104830`); no personal Steam account or game
ownership is required. This repo's own update automation (`scripts/update.sh`,
the dashboard's "Apply Update") relies on this and always logs in anonymously:

```bash
steamcmd +login anonymous +app_update 4754530 validate +quit
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

The `./dune init` script bootstraps your environment. The wizard walks through:

- **World/Server Naming**: Setting the server name displayed in the browser
- **Deployment Profile Selection**: Choosing `basic` (~20GB RAM), `standard` (~30-40GB RAM), or `full` (~40GB+ RAM)
- **External IP / Host Settings**: Configuring how players connect to your server
- **Admin Credentials and Tokens**: Securing your setup
- **Steam Download Path**: Pointing to the files downloaded via SteamCMD
- **Writing `.env`**: Generating the environment variables file for Docker Compose
- **Storing your Funcom token**: Saving it securely in `secrets/funcom-token.txt`

## 5. Apply host tuning

```bash
sudo ./scripts/host-tuning.sh
```

This configures kernel UDP buffers, disables transparent hugepages, sets Docker log rotation, disables the Docker userland proxy, and sets up passwordless sudo for shutdown commands. These settings prevent invisible rubberbanding and UDP socket overflows under multi-server load, and enable unattended host shutdowns from the dashboard. The script is idempotent and safe to re-run.

## 6. Start the stack

```bash
./dune start
```

This runs preflight checks, then starts the compose stack for the selected deployment profile plus the dashboard.

## 7. Open Arrakis Command Nexus

Visit:

- `http://your-server-ip:18080` if you expose the dashboard on your LAN
- `https://dashboard.your-domain.com` if you place the dashboard behind a reverse proxy
- If you keep the default local-only bind, open `http://127.0.0.1:18080` from the host itself

## 7. Forward ports for external players

At minimum, forward the public game ports from your router to the Linux host:

- `31982/tcp` for game RabbitMQ traffic
- `31983/tcp` for RabbitMQ HTTP API authentication
- profile-specific UDP game ports
  - basic: `7777-7778/udp` and `7888-7889/udp`
  - standard: `7777-7785/udp` and `7888-7896/udp`
  - full: `7777-7810/udp` and `7888-7921/udp`

Also allow the same ports through the host firewall.

## Next Steps

- Check the **Experimental** tab in the game's server browser. Your server should appear there
  within 5-10 minutes of starting.
- See [Configuration](./CONFIGURATION.md) to tune gameplay and engine settings
- See [Networking](./NETWORKING.md) before opening the server to the internet
- See [Profiles](./PROFILES.md) if you need to resize the battlegroup later
- See [Troubleshooting](./TROUBLESHOOTING.md) if the server does not appear in the browser
