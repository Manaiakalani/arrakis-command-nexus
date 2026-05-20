# Troubleshooting

## "Illegal instruction (core dumped)"

**Cause:** The host CPU does not support AVX2, or AVX2 is not exposed to the VM.

**Fix:**

- Run `lscpu | grep -i avx2`
- If you are virtualized, expose host CPU features to the guest
- Move the server to hardware with AVX2 support
- Re-run `./dune preflight` before starting again

## Cannot Connect from LAN

**Cause:** NAT hairpin / loopback is missing on the router.

**Fix:**

- Test from a mobile hotspot or other external network first
- Connect from LAN using the server's private IP
- Add split DNS or a hosts-file override for the public hostname
- Enable NAT loopback in the router if available

## Containers Are Crash-Looping

**Cause:** Missing images, invalid token, or insufficient memory are the most common triggers.

**Fix:**

- Run `docker compose ps`
- Inspect logs with `./dune logs <service>`
- Confirm the Funcom token exists in `secrets/funcom-token.txt` or `FLS_SECRET`
- Confirm the host has enough RAM for the selected profile
- Re-run `./dune preflight`

## Dashboard Is Not Accessible

**Cause:** Bad bind address, port conflict, reverse proxy issue, or CORS mismatch.

**Fix:**

- Confirm `DUNE_ADMIN_BIND_ADDRESS` and `DUNE_ADMIN_HOST_PORT`
- Check `docker compose ps` for `dashboard-nginx`
- Verify `DUNE_ADMIN_ALLOWED_HOSTS` matches the browser origin
- Test locally with `curl http://127.0.0.1:18080/api/ping`
- If proxied, confirm the proxy forwards `/api/` and preserves host headers

## Database Connection Errors

**Cause:** PostgreSQL is unhealthy, credentials changed, or the database was never initialized.

**Fix:**

- Check `docker compose logs postgres db-init`
- Verify `POSTGRES_SUPER_PASSWORD` and `POSTGRES_DUNE_PASSWORD`
- Confirm port `5432` is not already occupied by another PostgreSQL instance
- Re-run `docker compose run --rm db-init` if initialization failed

## RabbitMQ Issues

**Cause:** Wrong credentials, blocked ports, or a management/public port mismatch.

**Fix:**

- Verify `RABBITMQ_ADMIN_USER`, `RABBITMQ_ADMIN_PASSWORD`, `RABBITMQ_GAME_USER`, and `RABBITMQ_GAME_PASSWORD`
- Check `docker compose logs admin-rmq game-rmq rmq-auth-shim`
- Ensure `31982/tcp` is reachable from players
- Keep `5672`, `15672`, and `15673` private to localhost

## Image Loading Failures

**Cause:** The Steam download path is wrong, the extracted files are incomplete, or the tarball layout is unexpected.

**Fix:**

- Confirm the SteamCMD download completed without errors
- Verify `DUNE_STEAM_SERVER_DIR` points at the folder containing the server payload
- Check whether the update/load script expects tarballs or already-extracted files
- Re-download the package with `steamcmd +login anonymous +app_update 3104830 validate +quit`

## Gateway Patch Needed After Restart

**Cause:** The gateway can come up before the rest of the stack is ready, or the patched config was lost after image updates.

**Fix:**

- Run the included gateway patch helper if your environment requires it
- Restart the gateway after PostgreSQL and RabbitMQ are healthy
- Re-apply local gateway config changes after updating images
- Review `scripts/gateway-patch.sh` and `config/gateway.ini` for environment-specific adjustments
