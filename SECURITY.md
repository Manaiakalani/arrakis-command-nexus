# Security Policy

## Supported Deployments
Use supported images, rotate all `change-me` placeholders before production, and keep Docker, host OS, and dashboard dependencies updated.

## Responsible Disclosure
Please do **not** open public issues for vulnerabilities.

Report security concerns privately to the maintainers with:
- affected version / image tag
- impact and exploitation prerequisites
- reproduction steps or proof of concept
- suggested remediation, if known

Maintainers should acknowledge receipt within 3 business days, provide status updates during triage, and publish fixes plus release notes after remediation is available.

## Hardening Checklist
- Replace every `change-me-*` secret in `.env` before first start.
- Keep the dashboard bound to `127.0.0.1` unless a reverse proxy or VPN is in front of it.
- Expose only required host ports; keep Postgres and RabbitMQ management bound to localhost.
- Run containers with `no-new-privileges`; avoid `privileged` mode.
- Use the Docker socket proxy instead of mounting `/var/run/docker.sock` into the dashboard directly.
- Keep dashboard API reachable only through the frontend proxy / internal Docker networks.
- Review security logs for failed admin authentication, rate limiting, and watchdog restart anomalies.
- Rotate Discord, RabbitMQ, Postgres, and Funcom credentials after suspected compromise.
- Keep CI security scanning enabled (`pip-audit`, `npm audit`) and remediate high-severity findings promptly.

## Secret Rotation Runbook

When rotating credentials, follow this sequence to avoid downtime:

### Admin API Token (`DUNE_ADMIN_TOKEN`)
1. Generate a new token: `openssl rand -hex 32`
2. Update `.env` with the new value.
3. Restart the dashboard API: `docker compose up -d dashboard-api`
4. Update any saved tokens in browser bookmarks or scripts.

### Postgres Password (`POSTGRES_DUNE_PASSWORD`)
1. Connect to Postgres and change the role password:
   `ALTER ROLE dune_admin WITH PASSWORD 'new-password';`
2. Update `.env` with the new password.
3. Restart: `docker compose up -d dashboard-api`

### RabbitMQ Credentials (`RABBITMQ_DEFAULT_USER` / `RABBITMQ_DEFAULT_PASS`)
1. Update `.env` with new values.
2. Recreate the RabbitMQ container: `docker compose up -d --force-recreate rabbitmq`
3. Restart services that connect to RabbitMQ: `docker compose restart rmq-auth-shim text-router`

### Discord Webhook URL (`DUNE_DISCORD_WEBHOOK_URL`)
1. Generate a new webhook URL in Discord channel settings.
2. Update the URL via the dashboard Discord settings page or in `.env`.
3. Restart: `docker compose restart dashboard-api`

### Funcom Account Token (`FUNCOM_LIVE_SERVICES_TOKEN`)
1. Obtain a new token from the Funcom account portal.
2. Update `.env` with the new value.
3. Restart all game server containers.

## Incident Response Playbook

### Detection
- Monitor watchdog Discord notifications for repeated crash/restart events.
- Check the dashboard metrics page for CPU/memory anomalies.
- Review `docker compose logs dashboard-api` for `SECURITY:` log lines (failed auth, rate limiting).

### Containment
1. If a credential is compromised, rotate it immediately (see runbook above).
2. Block the attacker IP at the firewall or Cloudflare level.
3. If a container is compromised, stop it: `docker compose stop <service>`

### Eradication
1. Pull fresh images: `docker compose pull`
2. Rebuild dashboard: `docker compose build --no-cache dashboard-api`
3. Clear any tampered config by restoring from backup.

### Recovery
1. Restart services: `docker compose up -d`
2. Verify all containers healthy: `docker compose ps`
3. Confirm dashboard functionality and player connectivity.
4. Document the incident timeline and remediation steps taken.

## Log Retention Policy

| Log source | Retention | Notes |
|---|---|---|
| Docker container logs | 7 days, 50 MB max | Configured via `logging.options` in compose |
| Dashboard request logs | 30 days | Stored in SQLite, pruned by backup scheduler |
| Connection history | 90 days | Postgres `connection_log` table |
| Metrics time series | 12 hours (43,200 samples) | In-memory ring buffer, configurable via `DUNE_METRICS_RETENTION` |
| Backup archives | Per retention policy | Configurable via dashboard backup settings |

Review and prune logs regularly. Avoid storing PII beyond the retention window.
