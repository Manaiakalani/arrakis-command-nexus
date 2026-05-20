# Networking Guide

This project uses a mix of public player ports, internal localhost-only management ports, and host-networked game services. Plan your firewall and router rules before opening the stack to the internet.

## Required ports

### Public/player-facing ports

| Profile | Protocol | Ports | Purpose |
| --- | --- | --- | --- |
| all | TCP | `31982` | Game-facing RabbitMQ endpoint used by clients/services |
| basic | UDP | `7777-7778` | Gameplay traffic for Overmap and Survival |
| basic | UDP | `7888-7889` | Server-to-server / IGW traffic for Overmap and Survival |
| standard | UDP | `7777-7785` | Gameplay traffic for Overmap, Survival, Deep Desert, hubs, and story shards |
| standard | UDP | `7888-7896` | IGW/server-to-server traffic for the same set |
| full | UDP | `7777-7810` | Gameplay traffic for the expanded battlegroup |
| full | UDP | `7888-7921` | IGW/server-to-server traffic for the expanded battlegroup |

### Local-only admin ports

| Port | Protocol | Service | Expected exposure |
| --- | --- | --- | --- |
| `5432` | TCP | PostgreSQL | `127.0.0.1` only |
| `5672` | TCP | admin-rmq | `127.0.0.1` only |
| `15672` | TCP | RabbitMQ admin UI | `127.0.0.1` only |
| `15673` | TCP | RabbitMQ game management UI | `127.0.0.1` only |
| `18080` | TCP | Dashboard | `127.0.0.1` by default |

## Port forwarding on common routers

1. Reserve a DHCP lease or static IP for the Linux host.
2. Forward the required TCP/UDP ports to that internal IP.
3. Match external and internal ports unless you have a strong reason not to.
4. Save the rules and reboot the router if it does not apply immediately.

Typical router menu labels:

- TP-Link: **Advanced > NAT Forwarding > Virtual Servers**
- ASUS: **WAN > Virtual Server / Port Forwarding**
- Netgear: **Advanced > Advanced Setup > Port Forwarding / Port Triggering**
- Ubiquiti UniFi: **Settings > Firewall & Security > Port Forwarding**
- OpenWrt: **Network > Firewall > Port Forwards**

## LAN vs WAN access

- **LAN-only admin access:** keep `DUNE_ADMIN_BIND_ADDRESS=127.0.0.1` and use SSH port forwarding or a reverse proxy.
- **LAN dashboard exposure:** set `DUNE_ADMIN_BIND_ADDRESS=0.0.0.0`, restrict firewall sources to your subnet, and tighten `DUNE_ADMIN_ALLOWED_HOSTS`.
- **WAN game exposure:** forward only the gameplay/RMQ ports required by your deployment profile.
- **Do not expose** PostgreSQL or RabbitMQ management ports to the internet.

## NAT hairpin / loopback issues

Some routers do not let devices on the same LAN reach the server by its public IP. Symptoms include:

- external friends can connect, but local players cannot
- connecting by public DNS name fails from inside the house
- the dashboard or game ports only work when using the private IP locally

Solutions:

1. Use split DNS so LAN clients resolve the hostname to the private IP.
2. Add local hosts-file overrides for testing.
3. Use the server's LAN IP when connecting from inside the network.
4. Replace or reconfigure the router if it supports NAT loopback/hairpin NAT.

## Firewall examples

### UFW

```bash
sudo ufw allow 31982/tcp
sudo ufw allow 7777:7810/udp
sudo ufw allow 7888:7921/udp
sudo ufw allow from 192.168.1.0/24 to any port 18080 proto tcp
```

### iptables

```bash
sudo iptables -A INPUT -p tcp --dport 31982 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 7777:7810 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 7888:7921 -j ACCEPT
sudo iptables -A INPUT -p tcp -s 192.168.1.0/24 --dport 18080 -j ACCEPT
```

Adjust the UDP ranges to match your active deployment profile instead of blindly opening the full range.

## Docker networking considerations

- Game services run with `network_mode: host`, so they bind directly on the Linux host.
- PostgreSQL and RabbitMQ management ports are published explicitly and should stay on `127.0.0.1`.
- The dashboard is fronted by Nginx and should normally remain localhost-only.
- Because host networking is in use, Docker bridge-level isolation does not protect the game ports. Your host firewall is the real perimeter.
- If you place the dashboard behind a reverse proxy, preserve TLS termination, admin token auth, and the security headers from `dashboard/nginx.conf`.
