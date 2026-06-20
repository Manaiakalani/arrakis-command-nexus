# Cloudflare Tunnel Guide

Expose the Arrakis Command Nexus dashboard over the internet without opening any router ports, using [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (free tier).

## How It Works

Cloudflare Tunnel runs a lightweight daemon (`cloudflared`) on your server that creates an outbound-only encrypted connection to Cloudflare's edge. Visitors reach your dashboard through a public URL (e.g. `https://dune.example.com`) without your server needing a public IP or any inbound firewall rules.

```text
Browser --> Cloudflare Edge --> cloudflared (your server) --> localhost:18080
```

> **Note:** Cloudflare Tunnel only proxies HTTP/HTTPS traffic. Game server ports (UDP 7777+) still require traditional port forwarding or a VPN. See [NETWORKING.md](./NETWORKING.md) for game port setup.

## Prerequisites

- A Cloudflare account (free tier works)
- A domain managed by Cloudflare DNS (you can transfer an existing domain or buy one through Cloudflare)
- The Dune server stack running with the dashboard accessible on `localhost:18080`

## Option A: Quick Tunnel (No Domain Required)

For testing, `cloudflared` can create a temporary public URL with no configuration:

```bash
# Install cloudflared
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Create a quick tunnel (temporary URL, no login required)
cloudflared tunnel --url http://localhost:18080
```

This prints a URL like `https://random-words.trycloudflare.com`. The URL changes every time you restart the command. Use this for quick testing only.

## Option B: Named Tunnel with Custom Domain (Recommended)

### 1. Install cloudflared

```bash
# Debian/Ubuntu
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Or via Docker (alternative)
docker pull cloudflare/cloudflared:latest
```

### 2. Authenticate

```bash
cloudflared tunnel login
```

This opens a browser to authorize your Cloudflare account. After authorizing, a certificate is saved to `~/.cloudflared/cert.pem`.

### 3. Create a named tunnel

```bash
cloudflared tunnel create dune-dashboard
```

Note the tunnel UUID printed (e.g. `a1b2c3d4-...`). A credentials file is saved to `~/.cloudflared/<UUID>.json`.

### 4. Configure the tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <YOUR_TUNNEL_UUID>
credentials-file: /home/<your-user>/.cloudflared/<YOUR_TUNNEL_UUID>.json

ingress:
  - hostname: dune.example.com
    service: http://localhost:18080
    originRequest:
      noTLSVerify: false
  - service: http_status:404
```

Replace:
- `<YOUR_TUNNEL_UUID>` with your tunnel UUID
- `dune.example.com` with your actual subdomain

### 5. Create a DNS route

```bash
cloudflared tunnel route dns dune-dashboard dune.example.com
```

This creates a CNAME record in Cloudflare DNS pointing `dune.example.com` to your tunnel.

### 6. Start the tunnel

```bash
cloudflared tunnel run dune-dashboard
```

Your dashboard is now live at `https://dune.example.com`.

### 7. Run as a system service (recommended)

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

The tunnel now starts automatically on boot.

## Option C: Run cloudflared as a Docker Container

Add this service to your `docker-compose.yml` or create a separate override file:

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token <YOUR_TUNNEL_TOKEN>
    networks:
      default: {}
```

To get the token, create a tunnel in the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) under **Networks > Tunnels > Create a tunnel**, and copy the token from the install command.

Then set the public hostname to route `dune.example.com` to `http://dashboard-frontend:3000`.

## Cloudflare Access (Optional)

For additional security, add a [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) policy to require authentication before reaching the dashboard:

1. Go to **Zero Trust > Access > Applications > Add an application**
2. Set the application domain to `dune.example.com`
3. Create a policy (e.g. allow specific email addresses, require SSO, or use a one-time PIN)
4. Save

This adds an authentication layer in front of your dashboard without modifying any server code.

## Security Considerations

- **Keep the admin token:** Cloudflare Tunnel does not replace the `DUNE_ADMIN_TOKEN`. The token protects mutating API operations regardless of how users reach the dashboard.
- **Bind to localhost:** Leave `DUNE_ADMIN_BIND_ADDRESS=127.0.0.1` in your `.env`. Cloudflared connects locally, so the dashboard port does not need to be exposed on any network interface.
- **Use Cloudflare Access for public deployments:** If anyone with the URL can reach your dashboard, add an Access policy for login protection.
- **Tunnel credentials are secrets:** Treat `~/.cloudflared/<UUID>.json` and tunnel tokens like passwords. Do not commit them to version control.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `cloudflared` exits with connection error | Verify the dashboard is running: `curl http://localhost:18080` |
| DNS not resolving | Confirm the CNAME was created: `dig dune.example.com` should show a `*.cfargotunnel.com` target |
| 502 Bad Gateway | Check that `service:` in config.yml points to the correct port (`18080` for host, `3000` if Docker networking) |
| Access denied after adding Cloudflare Access | Clear browser cookies or open an incognito window to re-authenticate |
| Tunnel works but dashboard shows auth errors | Ensure `DUNE_ADMIN_TOKEN` is set in your `.env` and matches what you enter in the dashboard |
