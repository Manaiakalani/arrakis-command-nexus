# Deployment Notes

This document provides advanced operational guidance for deploying the Arrakis Command Nexus and Dune Awakening servers on bare metal Linux and complex network setups.

## Intel Hybrid CPUs (P-core / E-core)

If you are running the server on a 12th-16th Gen Intel Core or Intel Core Ultra processor, the Linux kernel scheduler may mistakenly assign heavy game server threads to Efficiency Cores (E-cores) instead of Performance Cores (P-cores). This results in severe rubberbanding and dropped ticks.

**Solution**: Use a `cpupin` overlay to isolate game server containers to P-cores.
1. Identify your P-core thread IDs (e.g., `0-15` on an i9-13900K, where `16-31` are E-cores).
2. Run `./scripts/cpu-pin.sh --install` and follow the prompts.
3. This installs a `dune-cpu-pin.service` + timer (via systemd) that applies `docker update
   --cpuset-cpus` to the running game containers on boot and every 5 minutes, so pinning
   survives container recreates without editing any compose file. See
   [Troubleshooting - In-Game Rubberbanding on Multi-Map Hosts](./TROUBLESHOOTING.md#in-game-rubberbanding-on-multi-map-hosts-cpu-core-contention)
   for how `dune start` cooperates with this service.

## RAM Pressure Management (<32GB Systems)

If you are trying to run the `standard` or `full` profile on a system with less than 32GB of physical RAM, you will encounter Out Of Memory (OOM) kills during map transitions or heavy load.

**Mitigation Strategies**:
- **Enable Swap**: Run `sudo ./scripts/host-tuning.sh --swap 16` to create a 16GB swapfile. NVMe SSDs are highly recommended for swap to prevent severe latency spikes when paging.
- **Reduce Memory Limits**: Edit your `.env` or `docker-compose.override.yml` to strictly limit the memory of non-essential maps, or drop down to the `basic` profile.

## Host Networking Caveats

Running containers with `network_mode: "host"` eliminates Docker's bridge overhead and NAT translation, greatly improving UDP performance. However, it introduces two caveats:

1. **Port Binding Races on Restart**: When a server restarts, the old process may take a few seconds to release its UDP port. If the new container starts too fast, it will fail to bind the port and crash.
   *Fix*: Set `PORT_AVAILABILITY_WAIT_SECONDS=30` in your `.env` file to force a deliberate delay before the new container claims the socket.
2. **NAT Hairpinning for LAN Players**: If players are on the same local network as the server, but trying to connect via your public IP, they might fail to connect.
   *Fix*: Ensure your router supports **NAT Loopback / Hairpinning**, or have local players connect directly to the server's local LAN IP (e.g., `192.168.1.50`).

## Systemd Auto-Start Setup

To ensure your Dune Awakening battlegroup automatically boots when the Linux host powers on (or recovers from a power outage):

```bash
# This installs and enables a systemd service pointing to your installation directory
sudo ./dune install-service
```
You can view the startup logs at boot using `journalctl -u dune-stack -f`.

## NIC IRQ Pinning for Multi-Map Servers

For high-population servers running 10+ maps, a single CPU core handling all Network Interface Card (NIC) hardware interrupts (IRQs) can become a bottleneck.

**Optimization**: Distribute NIC queues across multiple CPU cores.
1. Ensure your NIC supports multiple queues (`ethtool -l eth0`).
2. Disable `irqbalance` service (`sudo systemctl disable --now irqbalance`).
3. Manually map the NIC RX/TX queues to different CPU cores using `/proc/irq/<IRQ_NUM>/smp_affinity`.
*(Advanced users only. Misconfiguration can decrease network performance.)*

## Docker Daemon Recommendations

By default, Docker spins up a `docker-proxy` process for every exposed port. With hundreds of UDP game ports, this consumes excessive memory and CPU, and masks the real client IPs.

**Disable the Userland Proxy**:
Edit `/etc/docker/daemon.json` to include:

```json
{
  "userland-proxy": false
}
```

Then restart Docker: `sudo systemctl restart docker`.
*(Note: `./scripts/host-tuning.sh` applies this automatically if you run it.)*

---

> **Note - Known Issues:**
> When disabling `userland-proxy`, you must ensure your system's `iptables` and IPv4 forwarding are properly configured, as Docker relies entirely on the kernel's netfilter/iptables rules to route traffic into the bridge network when host networking isn't used.