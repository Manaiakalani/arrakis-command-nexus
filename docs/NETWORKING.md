# Networking Guide

This project uses a mix of public player ports, internal local-only management ports, and host-networked game services. Plan your firewall and router rules before opening the stack to the internet.

## Required Ports

### Public / Player-Facing Ports

| Profile | Protocol | Ports | Purpose |
| --- | --- | --- | --- |
| all | TCP | `31982` | Game-facing RabbitMQ endpoint used by clients/services |
| basic | UDP | `7777-7778` | Gameplay traffic for Overmap and Survival |
| basic | UDP | `7888-7889` | Server-to-server / IGW traffic for Overmap and Survival |
| standard | UDP | `7777-7785` | Gameplay traffic for Overmap, Survival, Deep Desert, hubs, and story shards |
| standard | UDP | `7888-7896` | IGW/server-to-server traffic for the same set |
| full | UDP | `7777-7810` | Gameplay traffic for the expanded battlegroup |
| full | UDP | `7888-7921` | IGW/server-to-server traffic for the expanded battlegroup |

### Local-Only Admin Ports

| Port | Protocol | Service | Expected exposure |
| --- | --- | --- | --- |
| `5432` | TCP | PostgreSQL | `127.0.0.1` only |
| `5672` | TCP | admin-rmq | `127.0.0.1` only |
| `15672` | TCP | RabbitMQ admin UI | `127.0.0.1` only |
| `15673` | TCP | RabbitMQ game management UI | `127.0.0.1` only |
| `18080` | TCP | Dashboard | `127.0.0.1` by default |

## Port Forwarding on Common Routers

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

## LAN vs WAN Access

- **LAN-only admin access:** Keep `DUNE_ADMIN_BIND_ADDRESS=127.0.0.1` and use SSH port forwarding or a reverse proxy.
- **LAN dashboard exposure:** Set `DUNE_ADMIN_BIND_ADDRESS=0.0.0.0`, restrict firewall sources to your subnet, and tighten `DUNE_ADMIN_ALLOWED_HOSTS`.
- **WAN game exposure:** Forward only the gameplay and RMQ ports required by your deployment profile.
- **Do not expose** PostgreSQL or RabbitMQ management ports to the internet.

## NAT Hairpin / Loopback Issues

Some routers do not let devices on the same LAN reach the server by its public IP. Symptoms include:

- external friends can connect, but local players cannot
- connecting by public DNS name fails from inside the house
- the dashboard or game ports only work when using the private IP locally

Solutions:

1. Use split DNS so LAN clients resolve the hostname to the private IP.
2. Add local hosts-file overrides for testing.
3. Use the server's LAN IP when connecting from inside the network.
4. Replace or reconfigure the router if it supports NAT loopback/hairpin NAT.

## Firewall Examples

### UFW

```bash
sudo ufw allow 31982/tcp
sudo ufw allow 7777:7810/udp
sudo ufw allow 7888:7921/udp
sudo ufw allow from <your-lan-subnet> to any port 18080 proto tcp
```

### iptables

```bash
sudo iptables -A INPUT -p tcp --dport 31982 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 7777:7810 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 7888:7921 -j ACCEPT
sudo iptables -A INPUT -p tcp -s <your-lan-subnet> --dport 18080 -j ACCEPT
```

Adjust the UDP ranges to match your active deployment profile instead of blindly opening the full range.

## Docker Networking Considerations

- Game services run on a custom bridge network with fixed IPs.
- PostgreSQL and RabbitMQ management ports should stay bound to `127.0.0.1`.
- The dashboard is served by the Next.js frontend container and should normally remain local-only.
- Because game services use bridge networking with fixed IPs, Docker network isolation protects internal services. Your host firewall adds an extra layer.

## Remote Dashboard Access with Cloudflare Tunnel

If you want to reach the dashboard from outside your LAN without opening router ports, use [Cloudflare Tunnel](./CLOUDFLARE_TUNNEL.md). It creates an outbound-only encrypted connection from your server to Cloudflare's edge, letting you access the dashboard at a custom domain (e.g. `https://dune.example.com`) with zero inbound firewall rules. Game server UDP ports still need traditional port forwarding.
