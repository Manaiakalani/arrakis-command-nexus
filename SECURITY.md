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
