# Troubleshooting

## Common Gotchas (Recommended Settings)

A handful of `config/*.ini` defaults shipped by Funcom or carried over from the
Proxmox script don't behave intuitively on a self-hosted setup. The dashboard
and `./dune` scripts won't override these for you  -  flip them yourself.

| File | Key | Recommended | Why it matters |
|------|-----|-------------|----------------|
| `config/director.ini` | `[Server] AllowGroupTravel` | `true` | When `false` (the Funcom sample default), parties are **dissolved on every cross-server handoff**  -  disconnect/rejoin, Overmap ↔ Survival, Deep Desert trips. Symptom: "the party keeps getting disbanded." |
| `config/director.ini` | `[Server] ForceLock` | `false` (except maintenance) | When `true`, no one can join the battlegroup. Easy to forget you flipped it for a maintenance window. |
| `config/director.ini` | `[Server] ShouldUpdatePlayerCountOnFls` | `false` | Self-hosted FLS doesn't enforce the cap; pushing counts is just heartbeat noise. Per-map (`[Survival_1]`) overrides can keep this `true` for live UI. |
| `.env` | `STEAM_APP_ID` | `3104830` (PTC) or `4754530` (retail)  -  match your install | Mismatched app IDs cause silent server-not-found failures. The dashboard's `Updates → Host info` panel surfaces both sides. |

After editing any `config/*.ini`, restart the affected container so the bind
mount re-resolves the new inode (git pull replaces files atomically):

```bash
docker compose -f docker-compose.yml -f docker-compose.basic.yml \
  -f docker-compose.dashboard.yml restart director
# Verify the container actually sees the new value:
docker exec dune-awakening-director-1 grep AllowGroupTravel /etc/app/conf.d/director.ini
```

> If `docker exec ... grep` shows the *old* value after a `git pull`, the bind
> mount is still pointing at the original inode. Restart the container.

> ⚠️ **Restarting the director is NOT enough for some settings.** The director
> publishes settings to game-server containers via an RMQ exchange, but a few
> settings  -  most notably `AllowGroupTravel`  -  appear to be read by the UE5
> game server only at process startup and ignored on later live updates.
> Symptom: you flip `AllowGroupTravel` to `true`, restart the director, the
> director's `Sent settings update` log shows the new value being pushed, but
> parties still dissolve on every disconnect/travel because Survival_1 (or
> Overmap, Deep Desert) was started before your config change and is running
> on the cached old value.
>
> **Fix:** after editing `director.ini`, restart the affected game-server
> containers in addition to the director:
>
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.basic.yml \
>   -f docker-compose.dashboard.yml restart director survival_1 overmap
> # Add deep_desert_1 if you run the standard or full profile.
> ```
>
> Heads-up: this kicks any online players. Schedule the restart, or use the
> dashboard's "Begin shutdown sequence" with a warning window.

See [`CONFIG_KEYS.md`](CONFIG_KEYS.md) for the full key reference.

## "Can admins add items to the in-game Claim Rewards menu?"

No. In-game Claim Rewards is a Funcom Live Services account-level feature, NOT server-side. Self-hosted server admins cannot push items to the in-game Claim Rewards menu.

Real options for in-server item grants are the dashboard `/characters` UI, RMQ inject, direct DB insert, or a starter loadout via PAK data. The dashboard's character-grant flow is the recommended path.

## "Parties keep disbanding even with AllowGroupTravel=true"

`AllowGroupTravel=true` fixes the most disruptive case (parties getting dissolved on every cross-server handoff during travel or reconnect), but it does **not** make parties immortal. A few cases will still dissolve a party:

- **Reconnect grace expired (most common cause of "ghost parties").** When a party leader's connection drops for longer than `m_DefaultReconnectGracePeriodSeconds`, the server tears down their pawn and the text-router emits `[Party cache] Remove user "<steam-id>" from party "<leader-id>"`. The row in `dune.parties` survives but `party_object_server_id` is left NULL - the runtime party is gone, members see "no party," and have to re-form. **Mitigation**: this repo ships `m_DefaultReconnectGracePeriodSeconds=1800` (30 min) in `config/UserGame.ini` for both `[Bossa.GameMode]` and `[/Script/DuneSandbox.PlayerOnlineStateSettings]`. Bumping this any higher leaks pawns, so 30 min is the practical ceiling.

- **All members offline simultaneously.** If every member logs out, the party object becomes orphaned. When members come back individually, they typically need to re-form. Verify with:
  ```bash
  docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 \
    -c "SELECT party_id, party_leader_id, party_object_server_id FROM dune.parties;
        SELECT party_id, COUNT(*) FROM dune.party_members GROUP BY party_id;"
  ```
  A NULL `party_object_server_id` is the ghost-party signature: the row exists, the runtime object does not.

- **Leader leaves explicitly.** The Funcom party model dissolves the party (or at least invalidates the leader role) when the leader actively leaves. Members may need to be re-invited even if they were online during the transition.

- **The 12-hour `MaxDemoPlayTimeSeconds` cap.** Director's settings push includes `MaxDemoPlayTimeSeconds: 43200` (12 hours). After this, party state may be reset.

- **Cross-region or cross-battlegroup travel.** Deep Desert excursions sometimes hand off across partition boundaries that the party object can't follow.

This is largely upstream Funcom behavior. Server-side, you can confirm parties are working by watching:

```bash
docker logs --follow dune-awakening-text-router-1 2>&1 | grep -i "Party cache"
```

You should see `Create party "N" with leader ... and member ...` and `Add user ...` events when groups form, and `Remove user ...` only when someone explicitly leaves. If parties dissolve faster than that, capture a 30-minute window and check whether `Remove` events line up with player actions vs. timeouts.

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

### S2S Reliable-Channel Overflow (NumOutRec 2047)

**Symptom:** `survival_1` (or the busiest map server) restarts at irregular intervals
with no visible segfault, OOM kill, or Fatal error in logs. Gateway shows "Server
went down" followed by a new server coming up. Other servers report
`LogIGWPingPong` ping failures for 300–500+ seconds after the restart.

**Cause:** UE5's reliable message queue has a hard-coded limit of 2048 slots per
S2S connection. When the outgoing queue fills up (e.g. during spice blows,
sandstorm events, or heavy cross-partition entity updates), the engine logs
`Channel->NumOutRec 2047 exceeds 2047` and disconnects the S2S link. If this
happens on the server's self-connection (control channel 0), the server marks
**itself** as dead via `LogIgwDatabaseInterface: Marked server … as dead` and
exits. Docker then auto-restarts it.

**Diagnosis:**

```bash
# Look for the overflow in game server logs:
docker logs dune-awakening-survival_1-1 2>&1 | grep -E 'NumOutRec|Marked.*dead'

# Example output (the smoking gun):
# LogNetSerialization: Error: Channel->NumOutRec 2047 exceeds 2047 for [UChannel]
#   ChIndex: 0, [UDuneS2sIpConnection] Remote: <SELF_ID>, Local: <SELF_ID>
# LogIgwDatabaseInterface: Log: Marked server <SELF_ID> as dead
```

**Fix:** The working baseline uses only socket buffers and `ConnectionTimeout`:

```
-ini:engine:[/Script/InfiniteGameWorlds.IgwNetDriver]:ConnectionTimeout=604800.0
-ini:engine:[/Script/OnlineSubsystemUtils.IpNetDriver]:ServerDesiredSocketReceiveBufferBytes=16777216
-ini:engine:[/Script/OnlineSubsystemUtils.IpNetDriver]:ServerDesiredSocketSendBufferBytes=4194304
-ini:engine:[/Script/InfiniteGameWorlds.IgwNetDriver]:ServerDesiredSocketReceiveBufferBytes=16777216
-ini:engine:[/Script/InfiniteGameWorlds.IgwNetDriver]:ServerDesiredSocketSendBufferBytes=4194304
```

> **⚠️ Do NOT add NetServerMaxTickRate, MaxClientRate, t.MaxFPS, or -forcelogflush.**
> These were tested in PRs #21–#26 and REVERTED — they cause rubberbanding
> (`NetServerMaxTickRate=120` at 30fps creates tick debt), client load timeouts
> (`MaxClientRate=0` floods initial replication), and I/O stalls (`-forcelogflush`
> blocks the game thread on every log write).

## Dashboard Is Not Accessible

**Cause:** Bad bind address, port conflict, or CORS mismatch.

**Fix:**

- Confirm `DUNE_ADMIN_BIND_ADDRESS` and `DUNE_ADMIN_HOST_PORT`
- Check `docker compose ps` for `dashboard-frontend` and `dashboard-api`
- Verify `DUNE_ADMIN_ALLOWED_HOSTS` matches the browser origin
- Test locally with `curl http://127.0.0.1:18080/api/ping`

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

- Verify `RMQ_HTTP_TOKEN_AUTH_SECRET` is set
- Check `docker compose logs admin-rmq game-rmq rmq-auth-shim`
- Ensure `31982/tcp` is reachable from players
- Keep `5672`, `15672`, and `15673` private to localhost

### "Error: P83" on map travel - ghost player connection holding the chat queue

**Symptom:** A player who can normally connect sees `Error: P83` when travelling between maps (commonly Hagga Basin -> Overland) or on a quick re-login. `game-rmq` logs show:

```
[error] operation queue.delete caused a channel exception precondition_failed:
        queue '<16-hex-steam-id>_queue' in vhost '/' in use
```

**Cause:** The player's previous RMQ session did not close cleanly (game-server crash, network blip, client force-quit, etc). A stale AMQP connection from the same Steam ID still holds a consumer on the player's `<HEXID>_queue`. When the new game server runs `queue.delete` to provision a fresh queue for the new session, the broker rejects it because a consumer is still attached.

**Confirm the symptom:**

```bash
docker exec dune-awakening-game-rmq-1 rabbitmqctl --quiet list_connections user state \
  | awk 'NR>1 && $1 ~ /^[0-9A-Fa-f]{16}$/ && $2 == "running"' | sort | uniq -c | awk '$1 > 1'
```

Any row with a count `> 1` is a player who has multiple running connections - the duplicates are ghosts.

**Fix (one-shot, no restart needed):**

```bash
./dune fix-p83            # dry-run, list candidates (alias: rmq-ghost-cleanup)
./dune fix-p83 --apply    # close duplicate connections + reap orphaned offline-player queues
```

Or target a single player:

```bash
./dune fix-p83 --apply --user DEADBEEFCAFEF00D
```

`fix-p83 --apply` runs two passes:

1. **Close ghost connections** - for any player with more than one running
   connection it keeps the newest and closes the older (the ghost). The live
   client reconnects within ~1 s and `queue.delete` succeeds on the next travel
   attempt.
2. **Reap orphaned queues** - a `<HEXID>_queue` can also linger with **0
   consumers** after a player's connection drops entirely. Presence/chat
   producers keep publishing to it, so it grows and can eventually trip the RMQ
   memory watermark (a broker-wide P83 cause). The reaper deletes such a queue
   only when its owner has no running player connection (fully offline), using
   `delete_queue --if-unused`; the game re-declares the queue on the player's
   next login, so this is safe.

**Note:** This is *separate* from the older "P83 caused by missing administrator tag" failure - that one has been fixed in `scripts/rmq_auth_shim.py` (service users now respond `allow administrator` on `/v0/auth/user`). If you also see `Not administrator user` in game-rmq logs, that pre-fix version of the shim is in use; redeploy.

### "Error: P83" on overworld travel - overworld server loaded the wrong level

**Symptom:** Identical in-game behaviour to the gateway-map case below (a Hagga
Basin player gets `Error: P83` only when travelling to the Overland map), but the
deeper cause is that the overworld (`overmap`) container was **running the Hagga
Basin level (`Survival_1`) instead of the Overland level**. Because it hosted the
wrong content, it self-reported `farm_state.map = 'Survival_1'`, the Overland
partition never carried real Overland content, and travel could never resolve a
destination. This typically also shows up as an `overmap` crash loop.

Confirm by checking which level the overmap actually loaded:

```bash
docker logs dune-awakening-overmap-1 2>&1 | grep -E "LoadMap:|Invalid multihome"
```

A healthy overworld server logs `LoadMap: /Game/Dune/Systems/Overmap/Overmap`. A
broken one logs `LoadMap: .../Survival_1` (often alongside `Invalid multihome IP
address /Game/.../Overmap.Overmap`, the tell-tale that an empty `-MultiHome=`
swallowed the map path).

**Cause:** Two compounding compose-argument bugs in the game-server `command`:

1. The command used `-MultiHome=$POD_IP` with a single `$`. `docker compose`
   interpolated `$POD_IP` from the compose environment (where it is undefined) to
   an empty string *before* the container started, leaving `-MultiHome=` empty.
   The Funcom entrypoint (`/home/dune/run.sh`) is designed to receive the literal
   `-MultiHome=$POD_IP` and substitute the per-container `POD_IP`, but with an
   already-empty value there was nothing to substitute. The empty `-MultiHome=`
   then consumed the adjacent positional map path as its value, so the map
   argument vanished entirely.
2. Even with `-MultiHome` fixed, the map was passed as a **positional** argument
   placed after all the options. Unreal reads the startup map URL only from the
   first positional argument (immediately after the injected `DuneSandbox`
   project token), so a map placed later is ignored and the server falls back to
   the shipped `ServerDefaultMap` (`Survival_1`).

**Fix (in the compose files):**

1. Escape the variable as `-MultiHome=$$POD_IP` so docker compose passes the
   literal `$POD_IP` through for the entrypoint to substitute.
2. Replace the positional map path with an explicit `ServerDefaultMap` override:
   `-ini:engine:[/Script/EngineSettings.GameMapsSettings]:ServerDefaultMap=<map>`.
   This mirrors how the survival server loads its default map and is immune to
   argument ordering.

Both fixes are applied to every non-survival map server across the `basic`,
`standard`, and `full` profiles. After recreating the affected server it loads
the correct level, writes the correct `farm_state.map`, and becomes discoverable
on its canonical partition. With the overworld server now reporting the correct
map at the source, the gateway-function patch below becomes a redundant
safeguard rather than the sole fix.

### "Error: P83" on overworld travel - gateway reports the wrong map for the overworld server

**Symptom:** A player on the Hagga Basin (`Survival_1`) server gets `Error: P83`
*specifically* when travelling to the **Overland (overworld) map**, while travel
within Hagga Basin works. Unlike the ghost-queue case above, `game-rmq` shows no
`queue.delete ... in use` error. The source server's IGW log shows the hand-off
failing locally:

```
UDuneIgwFunctionLibrary::UpdateTravelDestination(Survival1_to_Overland_E2)
    unable to find destination
... Travel was initiated without specifying Destination.Location or
    Destination.Dimension, so the target partition id cannot be set.
```

The director grants the travel correctly (it routes by the `Overmap`
PerMapConfig), the target overworld server is healthy, and the S2S mesh is
converged - the failure is purely the **source server's local destination
lookup**.

**Cause:** Every game server writes `farm_state.map` as the battlegroup/farm map
name (`Survival_1`) - including the overworld server. The stored
`get_active_servers_for_gateway()` function returned that `fs.map`, so it
reported the overworld server as `map='Survival_1'` instead of `Overmap`. Gateway
destination discovery (the most frequently polled routing function) therefore
found *no* server registered for the overworld map, and the source server's
`UpdateTravelDestination` failed with "unable to find destination". Every other
source of truth - `world_partition.map`, the launch map argument, and
`PARTITION_MAP_NAME` - already names the overworld partition `Overmap`; only this
one discovery function disagreed.

**Fix (durable, no game-server restart):** `scripts/partition_repair.py`
(`fix_gateway_function`) patches `get_active_servers_for_gateway()` to return the
true per-partition map `wp.map` instead of `fs.map`. The overworld server is then
discoverable on its **canonical partition 2** as `Overmap` (which the
`Overland` -> `Overmap` `downgrade_map_name` mapping resolves against), while the
Hagga Basin server is unchanged (`wp.map = fs.map = 'Survival_1'`). This neither
adds an extra partition row nor renames the stored map, so the director keeps
matching its `Overmap` PerMapConfig. Apply immediately with:

```bash
docker compose ... restart partition-repair
```

**Verify** the overworld server now reports `Overmap` (not `Survival_1`):

```bash
docker exec -e PGPASSWORD="$POSTGRES_DUNE_PASSWORD" dune-awakening-postgres-1 \
  psql -U dune -d "$POSTGRES_DB_NAME" -c \
  "SELECT server_id, map, partition_id FROM get_active_servers_for_gateway() ORDER BY partition_id;"
```

Then attempt an in-game overworld travel to confirm. To see which routing
function the travel path exercises, enable PL function tracking around the
attempt and restore the default afterwards:

```bash
psql ... -c "ALTER SYSTEM SET track_functions='pl'; SELECT pg_reload_conf(); SELECT pg_stat_reset();"
# ... attempt travel in-game ...
psql ... -c "SELECT funcname, calls FROM pg_stat_user_functions WHERE calls>0 ORDER BY calls DESC;"
psql ... -c "ALTER SYSTEM RESET track_functions; SELECT pg_reload_conf();"
```

If travel still fails identically on *every* overworld exit (not just one), the
remaining cause is upstream Funcom destination/landing metadata rather than this
routing layer.

## "Apply Update" Fails with `steamcmd failed (rc=8)`

**Symptoms:**

- Clicking **Apply Update** on the dashboard's Updates page immediately fails with a
  toast/error like:
  ```
  steamcmd failed (rc=8): steamcmd.sh[23390]: Starting /home/app/steamcmd/linux32/steamcmd
  ```
- The failure happens right away, before any download progress, and running steamcmd
  manually on the host (outside Docker) works fine.

**Cause:** The dashboard's **Apply Update** button runs SteamCMD *inside the
`dashboard-api` container*, not on the host. SteamCMD's `linux32/steamcmd` binary is a
32-bit executable that needs the 32-bit build of `libstdc++.so.6` to load. Images built
before this fix only installed `lib32gcc-s1`, not `lib32stdc++6`, so the 32-bit binary's
dynamic linker fails right after `steamcmd.sh` hands off to it, producing exit code 8
with no further diagnostic output.

**Fix:**

- Pull the latest changes (`dashboard/backend/Dockerfile` now installs `lib32stdc++6`
  alongside `lib32gcc-s1`) and rebuild the `dashboard-api` image:
  ```bash
  docker compose build dashboard-api
  docker compose up -d dashboard-api
  ```
- If `rc=8` persists after rebuilding, exec into the container to see the full
  dynamic-linker error directly:
  ```bash
  docker compose exec dashboard-api /home/app/steamcmd/steamcmd.sh +quit
  ```
- Quick workaround without a rebuild (lost the next time the container is recreated,
  so rebuilding the image is still the real fix):
  ```bash
  docker compose exec -u root dashboard-api apt-get update
  docker compose exec -u root dashboard-api apt-get install -y lib32stdc++6
  ```

### Same error, but *after* download progress starts (OOM kill)

If `rc=8` happens only partway through an update (you see download progress in the
logs first, e.g. `Update state (0x61) downloading, progress: ...`) rather than
immediately, this is a **different cause**: the `dashboard-api` container's memory
limit is too low for SteamCMD to download/validate the full depot in-process.

**Symptoms:**

- `docker compose logs dashboard-api` shows real download progress before the
  failure, not just `Starting ...`.
- `sudo dmesg -T | grep -i oom` shows a `Memory cgroup out of memory: Killed process
  ... (steamcmd)` entry around the same timestamp.
- `docker stats dashboard-api` shows memory usage pinned at the container's
  `mem_limit` right before the crash.

**Fix:** `docker-compose.yml` sets `mem_limit`/`memswap_limit: 2g` on `dashboard-api`
(previously `512m`, which left too little headroom above the ~200MiB idle baseline
once SteamCMD started downloading). Pull the latest changes and recreate the
container:
```bash
docker compose up -d dashboard-api
```
If you've customized this file and are stuck on an older `512m` limit, raise it to at
least `2g` (adjust based on available host RAM).

- If the update was interrupted mid-download, SteamCMD's own manifest can get stuck
  reporting `Error! App '<id>' state is 0x6 after update job` with 0 bytes planned to
  download on every retry. Force a fresh update plan by removing the stale manifest
  before retrying:
  ```bash
  docker compose exec dashboard-api rm -f /workspace/steam/steamapps/appmanifest_<STEAM_APP_ID>.acf
  ```

### "Apply Update" succeeds but the server keeps running the old build

**Symptoms:**

- The dashboard's **Apply Update** (or a manual `steamcmd ... app_update`) reports
  success, but the server later disappears from the in-game browser or shows a
  version mismatch to players.
- `docker ps --format '{{.Names}}\t{{.Image}}'` shows game-server containers still on
  the previous `DUNE_IMAGE_TAG`.

**Cause:** Downloading is only step 3 of a 6-step pipeline (`backup, stop, download,
load, tag, restart` -- see `scripts/update.sh`'s header). SteamCMD staging new files
into `DUNE_STEAM_SERVER_DIR` does **not** automatically `docker load` the new image
tarball, bump `DUNE_IMAGE_TAG` in `.env`, or recreate any containers. If only the
download step ran (e.g. the dashboard's Updates page only triggers SteamCMD, or
`./scripts/update.sh` was interrupted/resumed with `--skip-restart`), the stack keeps
serving the old build indefinitely with no error -- FLS registration and heartbeats
all still succeed on the old build, so nothing looks broken until a client checks the
revision.

**Diagnosis:** compare what's downloaded/published against what's actually running:

```bash
# What Steam currently publishes for the app (retail: 4754530, PTC: 3104830)
steamcmd +login anonymous +app_info_print 4754530 +quit | grep -A2 branches

# What's actually loaded and running right now
grep DUNE_IMAGE_TAG .env
docker ps --format '{{.Names}}\t{{.Image}}' | grep seabass-server
```

If the running image tag is older than the published build, the update was staged but
never deployed.

**Fix:** finish the remaining pipeline steps -- load the tarball, update the tag, and
recreate the stack:

```bash
./scripts/update.sh --skip-backup --skip-download
```

If the script's own restart prompt hangs when run non-interactively (e.g. over a
scripted SSH session), skip it and bring the stack up manually instead:

```bash
./scripts/update.sh --skip-backup --skip-download --skip-restart
./dune start
```

## Game Settings Page Shows "Unable to load game settings"

**Symptoms:**

- The dashboard's **Game Settings** page fails to load with "Unable to load game
  settings" / "An unexpected error occurred."
- `docker compose logs dashboard-api` shows a traceback ending in:
  ```
  configparser.DuplicateOptionError: While reading from '...UserGame.ini' [line NN]:
  option '-m_Maps' in section '/Script/DuneSandbox.MapFpsSettings' already exists
  ```

**Cause:** UE5's ini format legitimately repeats the same option name multiple times
within a section to add/remove array entries -- `config/UserGame.ini`'s
`[/Script/DuneSandbox.MapFpsSettings]` section has one `-m_Maps=...`/`+m_Maps=...`
pair per map (removing Funcom's default FPS cap and replacing it). Python's
`configparser.ConfigParser()` defaults to `strict=True`, which rejects any repeated
option name within a section and raises on the very first `GET
/api/v1/config/UserGame.ini` call. This is a pre-existing config file, not something
introduced by a recent change -- it only surfaces once someone opens the Game
Settings page.

**Fix:** `dashboard/backend/services/config_service.py` now reads config files with
`configparser.ConfigParser(strict=False)` so repeated options no longer raise.
Saving a setting no longer round-trips the whole file through `parser.write()`
either (which would have silently collapsed every repeated `-m_Maps`/`+m_Maps` line
down to just the last one on the very next save) -- `update_config` now rewrites
only the single `key=value` line being changed via a targeted text replacement,
leaving every other line -- including the repeated `MapFpsSettings` entries --
byte-for-byte untouched. Rebuild/restart `dashboard-api` to pick up the fix:
```bash
docker compose up -d --build dashboard-api
```

## Image Loading Failures

**Cause:** The Steam download path is wrong, the extracted files are incomplete, or the tarball layout is unexpected.

**Fix:**

- Confirm the SteamCMD download completed without errors
- Verify `DUNE_STEAM_SERVER_DIR` points at the folder containing the server payload
- Check whether the update/load script expects tarballs or already-extracted files
- Re-download the package with `steamcmd +login anonymous +app_update 4754530 validate +quit`
- **Use App ID `4754530` (retail)**. App ID `3104830` is the Public Test Client (PTC) build and is
  invisible to players running the retail game. See the [PTC vs Retail](#ptc-vs-retail-wrong-steam-app-id) section below.

## Gateway Patch Needed After Restart

**Cause:** The gateway can come up before the rest of the stack is ready, or the patched config was lost after image updates.

**Fix:**

- Run the included gateway patch helper if your environment requires it
- Restart the gateway after PostgreSQL and RabbitMQ are healthy
- Re-apply local gateway config changes after updating images
- Review `scripts/gateway-patch.sh` and `config/gateway.ini` for environment-specific adjustments

## WSL2-Specific Issues

### Out of Memory / Containers Killed

**Cause:** WSL2 defaults to 50% of host RAM, which may not be enough for the game servers.

**Fix:**

- Create or edit `%USERPROFILE%\.wslconfig`:
  ```ini
  [wsl2]
  memory=24GB
  swap=4GB
  ```
- Restart WSL: `wsl --shutdown`, then reopen your terminal
- Use the `basic` profile if RAM is limited

### Cannot Access Dashboard from Windows Browser

**Cause:** WSL2 uses a virtual network adapter. `localhost` forwarding works for most setups, but some configurations require the WSL2 IP.

**Fix:**

- Try `http://localhost:18080` first (Docker Desktop forwards ports automatically)
- If that fails, find the WSL2 IP: `hostname -I` inside WSL2, then use `http://<WSL2_IP>:18080`
- Set `DUNE_ADMIN_BIND_ADDRESS=0.0.0.0` in `.env` to allow non-localhost access

### Slow File I/O Performance

**Cause:** Accessing files on the Windows filesystem (`/mnt/c/...`) from WSL2 is significantly slower than using the native Linux filesystem.

**Fix:**

- Clone the repository inside WSL2's native filesystem (e.g., `~/dune-server-docker`), not under `/mnt/c/`
- Move Docker volumes to the WSL2 filesystem if they were created on the Windows mount

## Expected Log Warnings (Safe to Ignore)

These messages appear in normal operation and do not indicate a problem:

| Service | Message | Explanation |
|---------|---------|-------------|
| Gateway | `Got invalid partition index (None)` | The overmap server registers itself but does not own a partition. The partition-repair sidecar handles this. |
| Director | `Failed to process travel queue for partition 2` | Partition 2 does not exist in a single-survival setup (only partition 113). The director retries harmlessly. |
| Overmap | `Could not serialize <hostname>` | DNS lookup for the external hostname fails inside the Docker network. Cosmetic only. |
| RabbitMQ | `management_metrics_collection` deprecation | Suppressed by config. If the warning persists, verify `rabbitmq-admin.conf` and `rabbitmq-game.conf` include `deprecated_features.permit` lines. |
| Gateway | `function get_active_servers_for_gateway() does not exist` | Older retail schemas (e.g. `1979201`) did not include this stored procedure, and the gateway fell back to RMQ-based server discovery (~50 s after startup). Newer builds (e.g. `1988751`) ship it and the gateway polls it actively for destination discovery - `partition_repair.py` patches it to report `world_partition.map` (see "P83 on overworld travel" above). No action needed for the "does not exist" message itself. |
| PostgreSQL | `duplicate key value violates unique constraint "world_partition_label_key"` | Ghost server entries from previous runs. Handled by partition-repair. |
| Survival/Overmap | `DuneAISpawn: Warning: ... Failed to find valid spawn location for NPC` | UE5 NPC spawner couldn't find a valid nav point on this attempt. Spawner retries on next tick. Hundreds per startup is normal. |
| Overmap | `LogDuneSandworm: Warning: ASplineSafezone::FillSampleMatrix no sample attempts detected an area` and `ASplineSafezone::GenerateConvexHulls No convex hulls generated` | Sandworm safezone generator probing zero-volume zones during overmap startup. Tens to hundreds of these fire in a single burst around startup; safe to ignore. |
| Survival | `LogDuneSandworm: Error: ASplineSafezone::BeginPlay and m_bForceSplineUsage is false` | Some Funcom-shipped safezone prefabs are flagged as not requiring a spline; the system disables sandworm for that zone. Cosmetic. |
| Overmap | `LogStreaming: Error: Couldn't find file for package /Script/FunctionalTesting` | UE5 referencing the FunctionalTesting plugin that's stripped from shipping builds. Funcom-side, harmless. |
| Survival | `LogPhysics: Warning: Init Instance N of Primitive Component BlockingVolume_N.BrushComponentN failed` | A handful of Funcom-shipped BlockingVolumes lack collision data. UE warns once on level load. Cosmetic. |
| Survival | `LogLevel: Warning: Level CB_SB_DesertersBase_*_Art is marked as lighting scenario but will be ignored by r.LightingScenario.ForceDisable` | Server intentionally disables lighting scenarios for performance. Expected. |
| Overmap | `LogPowerIK: Warning: PowerIK: Missing effector bone: None` | UE PowerIK plugin warning on a rig that lacks an effector. Cosmetic. |
| Overmap | `LogSpiceHarvestingSystem: Error: Fields of type Small do not have a spawn rate multiplier over coriolis cycle` | Funcom data table is missing a `Small`-tier multiplier; system uses default. Cosmetic. |
| Director | `Slow operation: ServerSettingsUpdate: 23-65 ms` / `Reload settings: 65-69 ms` | UE flags >50 ms operations. Director's settings reload pushes the full per-map config (~200+ map entries) which legitimately takes that long. Not actionable unless it climbs >250 ms. |
| RabbitMQ (admin/game) | `Deprecated features: transient_nonexcl_queues` (and `management_metrics_collection`) | Funcom's game servers declare transient non-exclusive queues. We already permit both via `deprecated_features.permit.*=true` in `config/rabbitmq-{admin,game}.conf`  -  RMQ still logs an informational deprecation reminder once per queue type even when permitted. Verify by running `rabbitmqctl environment` inside the container and confirming `permit_deprecated_features` includes the feature. |
| RabbitMQ (admin/game) | `client unexpectedly closed TCP connection` from a `sg.<battlegroup>.<server-id>` user | Emitted when game-server containers (survival_1/overmap/deepdesert) shut down without a clean AMQP `Connection.Close` handshake  -  typical during compose restarts or our 2-phase shutdown. Harmless; the client reconnects on container start. Burst of 4-8 lines per restart is normal. |
| Text-router | `[Party cache] Create party "N"` / `Remove user X from party M` with mismatched N/M | The text-router uses a local monotonic counter for `Create` log lines while `Remove` lines print the persistent `dune.parties.party_id`. The two IDs are deliberately different namespaces; not a corruption signal. |
| Survival/Overmap | `LogStreaming: Error: Couldn't find file for package /Game/Dune/GadgetsAbilities/GrenadePoisonCluster/...` | Asset reference left over after Funcom moved/removed content. Cosmetic. |
| Survival | `LogColdness: WarmingGameplayEffectClass not set!` / `FreezingGameplayEffectClass not set!` | New cold-weather mechanic shipped with build 1979201; default effects aren't wired up server-side yet. Cosmetic, fires on every server tick during initialization. |
| Survival | `LogFuncomLiveServices: Setting 'FlsGetServerFunctionsCode' was not found in section 'FuncomLiveServices_retail' of *Engine.ini` | Build 1979201 looks for a new config key the shipped Engine.ini doesn't define. Falls back to default; FLS still works (verified by server browser registration). Funcom-side oversight. |
| Overmap | `LogNet: Warning: UIpNetDriver::TickDispatch: Socket->RecvFrom: 33 (SE_ECONNREFUSED) from 0.0.0.0:0` | UE5 IP socket noise when a transient connection times out. Fires ~once per minute. Cosmetic. |
| Survival | `LogAttractorSlot: Warning: BeginAttractorAnimations with invalid AttractorMontage. AttractorName:(BP_Attractor_Conversation*_C_*)` | NPC conversation animation prop with no assigned montage. Cosmetic. |
| Overmap | `LogTravelEvent: DiSignal 11 caught.` followed by `Unhandled Exception: SIGSEGV ...` + `Segmentation fault (core dumped)` | **Real but transparent**: build 1979201 has a Funcom-side bug that segfaults the overmap process on certain cross-map travel events. Docker's `restart: unless-stopped` brings it back in ~30 s. Players mid-travel will see a single failed handoff and retry. Observed rate: ~10-15 crashes/hour on our server. If the rate exceeds ~20 crashes/hour, first verify whether Steam depot 4754532 has a newer self-hosted build than image tag `1979201-0-shipping`; 1.4.0.1 included a cloud-side server crash fix, but self-hosted remains on base until Funcom pushes that depot. |

## Overmap Partition Load Failure (LoadPartitionDefinition)

**Symptoms:**

```
LogIgwDatabaseInterface: Error: LoadPartitionDefinition:
  Sql::load_world_partition(Survival_1, <SERVER_ID>, 0, 2) got 0 rows, expected exactly 1.
LogIGW: Error: On partition loaded: FAIL!
```

The overmap enters a tight retry loop, the gateway logs `Got invalid partition index (None)`,
and the overmap shows as `ready=false` in `farm_state`.

**Cause:** Each game server generates a new process correlation ID (PCID/server_id) on every
restart. Servers register themselves in `farm_state`, but the `world_partition` table is NOT
updated automatically. The overmap tries to look up its own server_id in `world_partition`
and finds zero rows.

**Fix (automatic):**

The `partition-repair` service runs automatically on `docker compose up` and fixes the
partition table. If the overmap is already stuck, restart it after the repair runs:

```bash
docker compose run --rm partition-repair
docker compose restart overmap
```

**Fix (manual):**

```sql
-- Check current state
SELECT * FROM dune.farm_state WHERE alive = true;
SELECT * FROM dune.world_partition;

-- Insert/update the overmap partition (replace <OVERMAP_SERVER_ID> with actual PCID)
INSERT INTO dune.world_partition (server_id, map, partition_definition, dimension_index)
VALUES (
  '<OVERMAP_SERVER_ID>',
  'Survival_1',
  '{"box": {"max_x": 1, "max_y": 1, "min_x": 0, "min_y": 0}, "type": "box2d_array"}',
  0
)
ON CONFLICT (server_id, map) DO NOTHING;
```

**Prevention:** Keep the `partition-repair` service in your compose configuration. It waits
for servers to register in `farm_state`, then ensures matching `world_partition` rows exist.

## "Server not appearing in browser after a Funcom update"

**Symptoms:**

- A new Funcom build is live on Steam (visible via `steamcmd +login anonymous +app_info_print 4754530`).
- Your server doesn't appear in the in-game browser, or players see "version mismatch."
- The dashboard's Updates page shows `update_available: true`.

**Why (likely cause):**

On rare occasions, Funcom may delay depot manifest availability for a few minutes after
publishing a new build. Anonymous SteamCMD can temporarily fail with:

```
CDepotDownloadMgr::BYldRequestDepotManifest(App: 4754530, Depot: 4754532, ...):
  Failed to get manifest request code, 'Access Denied'
AppID 4754530 update canceled : Failed downloading 1 manifests (No connection)
```

(Logged inside `/root/.local/share/Steam/logs/content_log.txt` in the SteamCMD container.)

This is transient — anonymous login works for both retail (`4754530`) and PTC (`3104830`)
under normal conditions. Simply retry after a few minutes.

**Recommended workflow (Windows operator, Linux host):**

If you're downloading from a Windows machine and pushing the result to a separate Linux
host, a local (not repo-tracked) PowerShell helper script that wraps SteamCMD and rsyncs
the result over is a convenient pattern. Two important details
that aren't obvious if you write your own:

1. **Force Linux platform.** Without `+@sSteamCmdForcePlatformType linux`,
   SteamCMD running on Windows downloads the **Hyper-V edition** of the
   self-hosted server (`.vhdx` virtual disk, `.bat` launcher, no Docker
   tarballs). The script does this automatically.

2. **Re-tag images on load.** Recent Funcom builds ship images namespaced as
   `registry.funcom.com/funcom/self-hosting/<name>:<tag>`, but our compose
   files reference the shorter `funcom/self-hosting/<name>:<tag>` form (the
   tag pattern older builds used). `scripts/load-images.sh` now mirrors the
   long form to the short form automatically after every `docker load`. If
   you previously updated without this fix, `docker compose up` will try to
   pull from the registry and fail with `pull access denied`. Re-tag
   manually with:
   ```bash
   for full in $(docker images --format '{{.Repository}}:{{.Tag}}' \
       | grep '^registry.funcom.com/.*seabass.*:<NEW_TAG>'); do
     docker tag "$full" "${full#registry.funcom.com/}"
   done
   ```

3. **appmanifest ownership.** If you previously ran SteamCMD as root in a
   Docker container, the `steamapps/appmanifest_4754530.acf` may be owned
   by `root` and reject overwrites by your operator user. Just `rm` the
   file from the operator-owned parent directory and re-scp it; no sudo
   needed.

**Recovery commands (after the new files are on the host):**

```bash
cd ~/dune-server-docker
./scripts/load-images.sh
docker compose -f docker-compose.yml -f docker-compose.basic.yml \
  -f docker-compose.dashboard.yml up -d --force-recreate \
  survival_1 overmap director gateway text-router \
  admin-rmq game-rmq partition-repair rmq-auth-shim dashboard-api
curl -sS -X POST \
  -H "X-Admin-Token: $DUNE_ADMIN_TOKEN" \
  http://127.0.0.1:18080/api/updates/mark-current
```

The dashboard's `update_available` alert is still useful while the update
is gated  -  it tells you a new build exists so you know whether the
browser-hidden state is "expected during update lag" vs. "something else
is wrong."

### Spice-Infused Fuel Cell recipe cost changed in 1.4.0.0

1.4.0.0 reduced the Spice-Infused Fuel Cell recipe from 65->48 Spice Residue and 3->2 Irradiated Slag per craft. If your players notice their crafting cost dropped, this is intentional Funcom-side rebalancing, not a server config drift.

### One map server left on a stale image tag after an update ("not network compatible")

**Symptoms:**

- The server intermittently disappears from the browser, or only some maps are reachable.
- One or more map server logs (`docker logs dune-awakening-<map>-1`) show:
  ```
  LogIGW: Error: Server not network compatible DuneS2sIpConnection_... (Local=..., Remote=...)
  ```
  on S2S connections to/from a specific sibling map.

**Cause:** Docker does **not** automatically recreate running containers when
`.env`'s `DUNE_IMAGE_TAG` changes -- each game-server service must be explicitly
`docker compose up -d <service>`'d to pick up a new tag. If an earlier update only
recreated *some* services (a partial/interrupted update run, or a container that
was manually restarted rather than recreated), it can keep running the **old**
image indefinitely, even though every other map has moved on. Game servers running
different internal build/protocol versions can't establish S2S connections with
each other, which is exactly what the "not network compatible" error means.

**Diagnosis:** compare the image tag every game-server container is actually
running against `.env`:
```bash
grep DUNE_IMAGE_TAG .env
docker ps --format '{{.Names}}\t{{.Image}}' | grep seabass-server
```
Any container not on the `.env` tag is the culprit.

**Fix:** recreate just the stale container(s) so they pick up the current tag:
```bash
docker compose up -d <service-name>   # e.g. deep_desert_1
```
No rebuild needed -- the image is already loaded, the container just needs to be
recreated to reference it. Verify with `docker ps` again and confirm the S2S errors
stop appearing in fresh logs.

## "Server not appearing in browser"

**Symptoms:** All containers are healthy, FLS heartbeats succeed, but the server does not
appear under the **Experimental** tab in the game's server browser.

### Quick Diagnosis Checklist

Run through these in order before digging deeper:

1. Run `./dune preflight` and resolve any failures.
2. **Wait at least 5 minutes** after a fresh start (10+ minutes after an image update). The
   `DeclareBattlegroupUpdates` FLS call fires roughly 4 minutes after game servers become
   ready -- the server will not appear in the browser before this fires.
3. Verify `31982/tcp` (RabbitMQ AMQP) is reachable from the internet.
4. Verify `7777/udp` is port-forwarded.
5. Check director logs for a successful `DeclareBattlegroupUpdates` with `UpDeclarationsByPartitionId`:
   ```bash
   docker logs dune-awakening-director-1 2>&1 | grep "DeclareBattlegroupUpdates"
   ```
   If you see `Exception thrown in FlsDeclareBattlegroupUpdates`, see the **Director Nudge** section below.
6. Check gateway logs that `GameRmqHttpAddress` is NOT `x.x.x.x:None`:
   ```bash
   docker logs dune-awakening-gateway-1 2>&1 | grep -i "GameRmqHttpAddress\|GatewayDeclareFarmStatus"
   ```
7. Verify your FLS token has not expired. Note: **generating a new token at
   account.duneawakening.com immediately revokes every previously issued token** for that
   account, even ones that were still working -- if you rotate the token, you must update
   `FLS_SECRET` everywhere it's configured and restart, or every server using an old token
   will start failing auth at the same moment.
8. If another host accidentally started with the same `WORLD_UNIQUE_NAME`, it can steal the
   FLS identity. Stop the duplicate stack and restart gateway on the live host.
9. All FLS calls succeeding is **not proof the running build is current** -- the client
   filters the browser list by build/revision, silently, with no error. If FLS looks
   completely healthy and none of the above explains it, see **"Apply Update" succeeds but
   the server keeps running the old build** above.

### FLS rejects world registration with Invalid Authorization

If FLS rejects your world registration with `Invalid Authorization to manage SelfHosted Battlegroup`, the most common cause is a numeric or short suffix on `WORLD_UNIQUE_NAME`. Live FLS requires the form `sh-<hostid>-<6-lowercase-letters>`, for example `sh-<host-id>-abcdef`. Numeric or non-6-char suffixes get rejected by FLS even though earlier closed-beta suffixes worked.

### Director Nudge (Browser Shows Nothing / FLS Declaration Stale)

When game servers are running correctly but FLS declarations are stale or missing (for
example, after a partition swap recovery, or after fixing a stale image tag on a map
server), restart only the Director -- do NOT restart game servers. The dashboard's
**Director nudge** button (Overview page) does exactly this and is the preferred way to
do it; use the CLI form below only if the dashboard is unreachable:

```bash
docker compose -f docker-compose.yml restart director
# Then watch for successful DeclareBattlegroupUpdates:
docker logs -f dune-awakening-director-1 2>&1 | grep -i "DeclareBattlegroupUpdates"
```

A successful declaration looks like:
```
("api/Battlegroups_DeclareBattlegroupUpdates") Request successful. ...
  "UpDeclarationsByPartitionId":{"19":{"ServerId":"...","GameAddress":"...","GamePort":7777,...}}
```

Only the "starting map" partition (the entry-point server players first spawn into, e.g.
`Survival_1`) needs to appear here -- the other partitions are internal travel
destinations, not separate browser entries, so seeing only one partition ID is normal.

The Director restarts in seconds and immediately re-reads `farm_state` + `world_partition`
from PostgreSQL, rebuilding a clean FLS state. **After nudging, wait 5-10 minutes** before
re-checking the in-game browser -- the FLS declaration needs time to propagate. It is
normal to see a handful of one-time `WRN Failed to process travel queue for partition N` /
`Error:Server does not have a valid last server state!` lines in the seconds right after
the restart, while the Director is still re-reading state from Postgres; they should not
recur once the first `DeclareBattlegroupUpdates` succeeds.

If clicking **Director nudge** fails with "Service action failed" on a deployment older
than this fix, the button was passing the literal string `"director"` to the restart API
instead of the real container name (`dune-awakening-director-1`), which the backend
rejects. Update to the latest `dashboard-frontend` build to fix it, or restart via the
CLI command above in the meantime.

### Partition Swap Recovery (Overmap / Survival Partitions Swapped)

**Symptom:** Overmap crash-loops every 25-30 seconds, logs show:
```
ERROR:  duplicate key value violates unique constraint "world_partition_label_key"
DETAIL:  Key (label)=(Overland) already exists.
```

**Cause:** When both game servers restart simultaneously, there is a race condition where the
overmap server grabs the Survival_1 partition and survival_1 ends up with the Overmap
partition. The `partition-repair` service detects this mismatch and corrects it, but the
Director then needs a nudge to re-declare the corrected state to FLS.

**Fix:**
```bash
# 1. Check current state
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 \
  -c "SELECT partition_id, server_id, map, label FROM dune.world_partition"

# 2. If swapped (survival_1 server has map='Overmap' or vice versa), correct manually:
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  BEGIN;
  UPDATE dune.world_partition SET server_id = '<SURVIVAL1_SERVER_ID>' WHERE partition_id = <SURVIVAL_PID>;
  UPDATE dune.world_partition SET server_id = NULL WHERE partition_id = <OVERMAP_PID>;
  COMMIT;
"

# 3. Restart overmap to pick up corrected assignment
docker compose -f docker-compose.yml -f docker-compose.basic.yml restart overmap

# 4. Director nudge to re-declare to FLS
docker compose -f docker-compose.yml restart director
```

The `partition-repair` service (with the map-type validation fix) now detects and corrects
this swap automatically on every 3-second cycle.

**Root causes (additional checks):**

1. **Database version mismatch.** If the Funcom images were upgraded but the database was
   not recreated, the game server logs `Database version mismatch` and the persistence
   layer never loads. The server stays in `S2S_Starting` state and never becomes `ready`.

   ```bash
   # Check for the error
   docker compose logs survival_1 2>&1 | grep "Database version mismatch"
   ```

   **Fix:** Drop and recreate the database, then re-run db-init (same procedure as
   [Operations - After an Image Version Upgrade](./OPERATIONS.md#after-an-image-version-upgrade-db-re-init-required)):

   ```bash
   docker compose stop survival_1 director gateway text-router
   docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
     -c "DROP DATABASE IF EXISTS dune_sb_1_4_0_0;"
   docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
     -c "CREATE DATABASE dune_sb_1_4_0_0 OWNER dune;"
   docker compose rm -f db-init
   docker compose up db-init --force-recreate
   docker compose up -d
   ```

   **Warning:** This destroys all world data. Take a backup first if you have player progress.

2. **Wrong partition_definition format.** The `world_partition` table must use the
   `box2d_array` JSON format. Without the `"type"` field, the game server fails with:

   ```
   Ensure condition failed: Object->HasTypedField<EJson::String>(u"type")
   ```

   **Fix:** The correct format is:
   ```json
   {"type":"box2d_array","box":{"min_x":0,"min_y":0,"max_x":1,"max_y":1}}
   ```

   The `db-init` service seeds this automatically on fresh databases. To fix an existing
   database:

   ```sql
   UPDATE world_partition
   SET partition_definition = '{"type":"box2d_array","box":{"min_x":0,"min_y":0,"max_x":1,"max_y":1}}'::jsonb;
   ```

3. **`BattlegroupMaxPlayerCapacity` is 0.** The director reports 0 capacity to FLS, so the
   server is hidden. Check that `farm_state` shows `ready = true`:

   ```sql
   SELECT server_id, map, ready, alive FROM farm_state;
   ```

   If `ready` is `false`, the game server has not finished loading. Check its logs for errors.

4. **Port forwarding incomplete.** Players need:
   - `7777-7810 UDP` for game traffic
   - `31982 TCP` for RabbitMQ (login/auth)
   - `31983 TCP` for RabbitMQ HTTP API

5. **Missing BackendLogin auth secrets.** If `DUNE_SERVER_LOGIN_PASSWORD_SECRET` and
   `DUNE_USERNAME_SERVER_LOGIN_SECRET` are blank, player authentication will fail.
   Generate them with `openssl rand -hex 32` and ensure the same values are set for
   the director and all game servers.

## Performance Tuning

If your server feels sluggish, has high latency, or containers are being OOM-killed:

### Apply Host Tuning

```bash
# Preview changes without modifying anything
sudo ./scripts/host-tuning.sh --dry-run

# Apply kernel + Docker tuning
sudo ./scripts/host-tuning.sh

# Also add swap on low-memory hosts (< 32 GB)
sudo ./scripts/host-tuning.sh --swap 8
```

This sets `vm.swappiness=10`, increases UDP buffers for game traffic, disables transparent
hugepages, and configures Docker log rotation. See `vm/README.md` for per-map memory profiles.

### Increase Container Memory Limits

Edit `.env` and raise the `MEM_LIMIT_*` values:

```bash
MEM_LIMIT_SURVIVAL=16g   # Default 12g, increase if OOM-killed
MEM_LIMIT_DEEP_DESERT=12g
```

Then `docker compose up -d` to apply.

### In-Game Rubberbanding on Multi-Map Hosts (CPU Core Contention)

If players rubberband (teleport/snap back) on a host running the standard or full profile
(3+ map servers) even though CPU and RAM averages look fine, the cause is usually
sub-tick scheduling contention: the other servers' threads preempt the main world's
game thread for 10-50 ms, the 30 Hz tick misses its deadline, and UE5 sends a movement
correction. Average load tools (`top`, `vmstat`) cannot see these stalls; only per-thread
run-queue latency can.

**Fix:** pin the player-facing map servers to dedicated physical cores:

```bash
# Preview changes
./scripts/cpu-pin.sh --dry-run

# Apply pinning (live, no restart)
./scripts/cpu-pin.sh

# Persist across reboots (installs a systemd timer)
sudo ./scripts/cpu-pin.sh --install

# Measure the game-thread scheduling delay (needs kernel.sched_schedstats=1)
./scripts/cpu-pin.sh --measure
```

The defaults target a 6 physical core / 12 HT thread host. Override for other
hardware with environment variables:

```bash
CPUSET_SURVIVAL=0,1,6,7 CPUSET_DEEP_DESERT=2,3,8,9 CPUSET_BACKGROUND=4,5,10,11 \
  ./scripts/cpu-pin.sh
```

The script also pins NIC hardware interrupts to the background pool so
interrupt/softirq processing never preempts the game-server cores.

**Measuring:** a healthy pinned game thread shows ~1-2% scheduling delay. Double-digit
percentages mean the player will rubberband. One physical core is NOT enough for a busy
UE5 server (it has ~30 helper threads that preempt the game thread); always allocate at
least two physical cores per player-facing map.

**Rubberbanding coming back after an update, with no config changes:** CPU pinning is
applied to a *running container instance*, not the service definition, so it is silently
discarded whenever containers are recreated (`dune update`, `dune stop && dune start`, a
dashboard-triggered recreate, etc.) — `docker inspect` will show an empty `CpusetCpus` for
every game map after this happens. `dune start` is supposed to re-apply pinning
automatically as its last step, so this should self-heal within ~30-60 seconds of any
restart. If it doesn't:

1. As of the fix in PR #13/#14, `dune start` invokes the fallback script explicitly via
   `bash scripts/cpu-pin.sh` and only checks that the file exists (`[[ -f ... ]]`), so a
   lost executable bit can no longer silently skip pinning the way it used to — you do
   **not** need to `chmod +x scripts/cpu-pin.sh`. If pinning still isn't applied, run
   `bash scripts/cpu-pin.sh` by hand and read the actual error output (common causes:
   `docker update` permission issues, or `dune start` not reaching this step at all
   because an earlier step in the script failed — check `dune start`'s full log for
   errors before this point).
2. If you have a hand-tuned `dune-cpu-pin.service` installed (`systemctl cat
   dune-cpu-pin.service`), `dune start` prefers restarting that service over running
   `scripts/cpu-pin.sh` directly, since a host-specific hand-tuned layout (individual
   cores per map server) can outperform the script's generic P-core/E-core
   auto-detection on hosts with many cores or unusual topology. Verify it actually ran
   recently with `systemctl status dune-cpu-pin.service` (look at the "Active" timestamp)
   and re-run it manually if needed: `sudo systemctl restart dune-cpu-pin.service`.
3. Either way, re-verify with `docker inspect -f '{{.HostConfig.CpusetCpus}}'
   dune-awakening-<service>-1` for each map server, and confirm with
   `./scripts/cpu-pin.sh --measure` that scheduling delay is back down to ~1-2%.

### In-Game Rubberbanding - Host Networking Overlay

If players still rubberband after CPU pinning, and every server-side diagnostic
(tick warnings, movement corrections, UDP drops, NIC errors, CPU pressure) looks
clean, the Docker **bridge** network itself is the likely cause: the iptables /
veth / NAT path adds per-packet processing jitter on the game UDP socket. An A/B
test on this stack confirmed it - bridge mode rubberbands, host mode is smooth.

**Recommended: Put the survival map on host networking** using
`docker-compose.hostnet.yml` (see
[NETWORKING.md - Host Networking Overlay](./NETWORKING.md#host-networking-overlay-anti-rubberbanding)).
This overlay moves `survival_1` - the map players actually experience rubberbanding
on - to `network_mode: host`, bypassing Docker's networking stack for its game
traffic. Other servers stay on bridge networking; their S2S traffic to `survival_1`
is routed via `extra_hosts` entries pointing at the host LAN IP instead of Docker
DNS, so it isn't affected by the bridge/NAT jitter either. **This is the
configuration currently deployed in production and confirmed to resolve
rubberbanding.**

Enable it by setting these in `.env`:

```bash
# In .env
HOST_LAN_IP=<YOUR_LAN_IP>                       # this host's real LAN IP
DUNE_HOSTNET_OVERLAY=docker-compose.hostnet.yml
```

```bash
./dune restart
```

The `./dune` CLI reads `DUNE_HOSTNET_OVERLAY` and includes the overlay
automatically on every `docker compose` invocation - no `-f` flags needed, no
risk of forgetting.

**Alternative: Put ALL game servers on host networking** using
`docker-compose.hostnet-all.yml` instead (set
`DUNE_HOSTNET_OVERLAY=docker-compose.hostnet-all.yml`). This moves every game
server - not just `survival_1` - to `network_mode: host`. It exists because an
earlier iteration of the mixed setup (before the `extra_hosts`-based S2S routing
above) saw cross-container mesh latency from the asymmetric networking. Only
reach for it if the single-server overlay doesn't fully resolve rubberbanding for
you: it requires planning a unique host port range for every game server (see the
file's header comments) and hasn't been necessary in production since `extra_hosts`
routing was added.

Requirements:

- `HOST_LAN_IP` set to the host's LAN address (used for `-MultiHome`)
- Router forwards UDP `7777` and `7888` to that LAN IP (other ports are S2S-internal)
- Game ports are free on the host (no other process bound)

Verify which servers landed on the host network:

```bash
for srv in survival_1 overmap deep_desert_1 arrakeen harko_village; do
  echo -n "$srv: "
  docker inspect -f '{{.HostConfig.NetworkMode}}' dune-awakening-${srv}-1
done
# With docker-compose.hostnet.yml (recommended): only survival_1 shows "host",
# the rest show your bridge network name.
# With docker-compose.hostnet-all.yml (alternative): all of them show "host".
```

### In-Game Rubberbanding - UDP Socket Receive-Buffer Overflow

Bursty inter-server (S2S) traffic from the peer map servers can overflow the game
server's UDP receive buffer faster than UE5 drains it during a tick, silently
dropping datagrams. The lost movement packets surface as rubberbanding even though
nothing logs an error.

Diagnose with the per-protocol UDP error counters - a climbing `receive buffer
errors` / `RcvbufErrors` is the smoking gun:

```bash
netstat -su | grep -i 'receive buffer'
# or
nstat -az | grep -i UdpRcvbufErrors
```

The stack already ships the fix: every game server requests a 16 MB receive
buffer and 4 MB send buffer on both the game (`IpNetDriver`) and S2S
(`IgwNetDriver`) net drivers via the shared compose anchor:

```
-ini:engine:[/Script/OnlineSubsystemUtils.IpNetDriver]:ServerDesiredSocketReceiveBufferBytes=16777216
-ini:engine:[/Script/InfiniteGameWorlds.IgwNetDriver]:ServerDesiredSocketReceiveBufferBytes=16777216
```

For the kernel to grant a buffer that large, `net.core.rmem_max` must be at least
16 MB. `scripts/host-tuning.sh` sets it to 25 MB; if you do not run that script,
raise it yourself:

```bash
sudo sysctl -w net.core.rmem_max=26214400 net.core.wmem_max=26214400
```

### Disable Docker Userland Proxy for Game Traffic

Docker's default `userland-proxy: true` spawns a Go process per published port,
routing game UDP through userspace. On a standard-profile host this creates 36
proxy processes. Disabling it forces all port forwarding through kernel iptables
DNAT, eliminating per-packet context switches and ~144 schedulable Go threads.

Add to `/etc/docker/daemon.json`:

```json
{
  "userland-proxy": false
}
```

Then restart Docker and the stack:

```bash
sudo systemctl restart docker
./dune start
```

Verify with `pgrep -c docker-proxy` (should return 0) and
`sudo iptables -t nat -L DOCKER -n` (should show DNAT rules for game UDP ports).

### NIC Ring Buffer and Offload Tuning (Physical Hosts)

On bare metal, a small NIC RX ring or aggressive generic-receive-offload can drop
or reorder bursty game UDP under load. Raise the RX ring toward its hardware max
and enable UDP GRO forwarding. Replace `eno2` with your interface
(`ip route get 1.1.1.1 | awk '{print $5; exit}'`):

```bash
# Inspect current vs hardware-max ring sizes
ethtool -g eno2

# Raise the RX ring to the "Pre-set maximum" reported above (4096 is common)
sudo ethtool -G eno2 rx 4096

# Coalesce forwarded UDP without breaking game packet pacing
sudo ethtool -K eno2 rx-udp-gro-forwarding on
```

These reset on reboot - persist them via your distro's network config or a
systemd unit. Pair this with the NIC IRQ pinning that `scripts/cpu-pin.sh`
applies (it keeps hardware-interrupt processing off the dedicated game cores).

## Collecting a Diagnostic Snapshot

When filing a bug report or asking for help, collect a snapshot:

```bash
./scripts/collect-snapshot.sh
```

This creates a tarball with system info, container state, logs, database status, and network
config. All credentials are automatically redacted before packaging.

## Dashboard Data Lost After Container Rebuild

**Cause:** The dashboard SQLite database was stored inside the container at `/app/dashboard.db` with no persistent volume mount.

**Fix (already applied in v1.4.0):**

The `docker-compose.yml` now mounts `./dashboard-data:/workspace/data` and sets `DUNE_DASHBOARD_DB_URL` to use that path. After upgrading:

```bash
mkdir -p dashboard-data && chmod 777 dashboard-data
docker compose up -d dashboard-api
```

Discord webhooks, scheduled announcements, and other dashboard settings will persist across rebuilds.

## Overview Page Stuck Loading

**Cause:** The `/api/status` endpoint crashes with a 500 error when PostgreSQL is temporarily unreachable (DNS resolution failure, container restarting, etc.).

**Fix (applied in v1.4.0):** The status endpoint now uses `return_exceptions=True` in `asyncio.gather` so a PostgreSQL failure degrades gracefully (shows 0 players) instead of crashing the entire page.

## Post-Deploy Smoke Test

Run the smoke test after any deployment to catch regressions:

```bash
make smoke
# or directly:
bash scripts/smoke-test.sh
```

The test checks 42 items across 7 categories: container health, API endpoints, frontend routes, volume persistence, configuration, database connectivity, and recent error logs.

## Partition Crash-Loop (Server Won't Start)

**Root cause:** The game server must find a matching `world_partition` row for its freshly generated `server_id` almost immediately after startup.

1. The game binary generates a random `server_id` on each startup.
2. It registers that `server_id` in `farm_state` through RabbitMQ and the director.
3. It then queries `load_world_partition` using that `server_id` within about 5 seconds.
4. If `world_partition` does not contain the matching `server_id`, the server crashes with `Local partition is not found`.
5. `scripts/survival-pre-start.sh` handles this automatically by parsing the startup output, waiting for `farm_state`, and inserting the partition row.
6. If the pre-start flow fails, manually delete stale rows from `farm_state` and `world_partition`, then restart the affected server.

Suggested recovery steps:

```sql
DELETE FROM dune.farm_state WHERE server_id = '<stale_server_id>';
DELETE FROM dune.world_partition WHERE server_id = '<stale_server_id>';
```

Then run:

```bash
docker compose run --rm partition-repair
docker compose restart overmap
```

## Idle Multi-Map Crash-Loop (S2S ConnectionTimeout)

**Symptoms:** With several map servers running and no players (or only a few) connected, every game-server container restarts together roughly every 10 minutes. `docker inspect -f '{{.RestartCount}}' <container>` climbs in lockstep across all map servers, while the infrastructure containers (postgres, RabbitMQ, director, gateway, dashboard) stay at 0 restarts.

**Root cause:** The map servers form a server-to-server (S2S / Inter Game World) mesh, one connection per server pair over the internal Docker network. When no players are crossing zones, those links carry no traffic. Funcom's `IgwNetDriver` closes an idle connection once it passes its `ConnectionTimeout` (shipped default `600.0` seconds in `DefaultEngine.ini`):

```text
LogNet: Warning: UNetConnection::Tick: Connection TIMED OUT ... Threshold: 600.00 ...
  [UDuneS2sIpConnection] ... Driver: IgwClientNetDriver IgwNetDriver_...
LogDuneNet: Log: NetworkFailure (secondary conn to server <NONE>): ConnectionTimeout
```

A dropped S2S link makes `AS2sController::RefreshSortedServerList` mark the peer dead and reset the world partition, which trips a Funcom engine bug while rebuilding the partition quad tree:

```text
LogIGW: Display: Reseting World Partition from UDuneWorldPartitioner::OnPartitionDefinitionMapLoaded
Fatal error: [...] DuneWorldPartitioner.cpp [Line: 1138] Failed to find local server in quad tree
```

The segfault cascades across the mesh, Docker (`restart: unless-stopped`) restarts every map server, they re-converge, idle again, and the cycle repeats on roughly the 600-second cadence. The blast radius grows with the number of maps, so the all-maps `standard` and `full` profiles hit it far more often than a one or two map deployment.

**Fix (already applied in the compose files):** Stop idle S2S links from being dropped during normal operation by raising the inter-server idle timeout. Every game server is launched with:

```text
-ini:engine:[/Script/InfiniteGameWorlds.IgwNetDriver]:ConnectionTimeout=604800.0
```

This targets only the inter-server driver (`IgwNetDriver` / `DuneS2sIpConnection`). The game-client driver (`[/Script/OnlineSubsystemUtils.IpNetDriver]`, `ConnectionTimeout=60.0`) is intentionally left alone, so real player connections still time out normally. Container liveness is still covered by Docker health checks and the director/gateway readiness state, so a genuinely dead map server is still detected and restarted.

**Verify:** After recreating the game servers, confirm the override reached the binary and that the timeout no longer fires:

```bash
# Override present on the running server
docker inspect dune-awakening-overmap-1 --format '{{json .Args}}' | tr ',' '\n' | grep IgwNetDriver

# Watch for 15 to 20 minutes (longer than the old 600s cadence); this should print nothing
for c in $(docker ps --format '{{.Names}}' | grep -E 'overmap|survival_1|deep_desert|arrakeen|harko|hephaestus|carthag|waterfat|proces'); do
  docker logs --since 25m "$c" 2>&1 | grep -E 'Threshold: 600.00|DuneWorldPartitioner.cpp' && echo "  ^ $c"
done
```

Restart counts should stop climbing and no new `DuneWorldPartitioner` fatal should appear.

## Crafting and Refinery Timer Glitches

**Symptoms:** Refineries stay paused, timers cycle backward, or crafting durations keep extending.

**Root cause:** Server tick-rate drops when the host is starved for CPU or memory.

**Most common trigger:** `overmap` enters a crash-loop and burns 100 percent or more CPU during repeated restarts.

**Diagnosis:**

```bash
docker stats
```

Check the CPU and memory percentages for `overmap`, survival shards, and supporting services.

**Fix:** Stop the offending container, increase resource limits, then restart it.

```bash
docker compose stop overmap
# edit .env and raise MEM_LIMIT_OVERMAP or the matching MEM_LIMIT_<SERVICE>
docker compose up -d overmap
```

## Credential Rotation

Rotate credentials carefully so connected services stay in sync.

### `DUNE_ADMIN_TOKEN`

1. Update `.env`.
2. Restart the API:
   ```bash
   docker compose restart dashboard-api
   ```

### `POSTGRES_DUNE_PASSWORD`

1. Update `.env`.
2. Update the PostgreSQL user password inside the database.
3. Restart all game containers and any service that connects to PostgreSQL.

### RabbitMQ credentials

1. Update `.env`.
2. Restart RabbitMQ.
3. Restart all connected services so they reconnect with the new credentials.

### Discord webhook

1. Update `.env`.
2. Restart the API:
   ```bash
   docker compose restart dashboard-api
   ```

## Multiple or Duplicate Entries in Server Browser (Ghost Servers)

**Symptoms:** The server browser shows 3, 5, or more copies of your server even though only 2
partitions are running (Overmap + Survival).

**Root cause:** Every time a game server process starts, it generates a **new random server ID**.
Funcom Live Services (FLS) tracks each ID independently. When you restart a container (whether via
`docker compose restart`, `docker compose up -d`, or a crash recovery), FLS registers a fresh
entry for the new ID while the old entry remains until its heartbeat TTL expires. Multiple
rapid restarts accumulate stale entries.

**Important:** `docker compose restart` does **not** preserve the server ID. Each process
invocation produces a unique ID.

**Can we delete ghost entries manually?** **No.** This was verified by:

1. Enumerating every FLS endpoint our director and gateway call (`Battlegroups_SendBattlegroupHeartbeat`, `_DeclarePopulationAndActivity`, `_DeclareMaxPlayerCapacities`, `_DeclareBattlegroupUpdates`, `_UpdateRevision`) - none accept a `Remove`, `Delete`, or `Deregister` action.
2. Searching the game server binary (`DuneSandboxServer-Linux-Shipping`, ~370 MB) for any `deregister`, `unregister`, `RemoveServer`, `DeleteBattlegroup`, or similar string - **zero matches**.
3. Searching the same binary for any `-ServerID=` CLI flag, `ServerIdOverride`, `ReuseServerId`, or `Bgd.ServerId` config var that would let us persist a stable server ID across restarts - **zero matches**.

Funcom intentionally does not expose this surface to self-hosted operators. The only way to remove an entry is to let its FLS-side TTL expire.

**How long do ghost entries last?** Based on observed behaviour, FLS TTL appears to be
12-24 hours after the last heartbeat for self-hosted servers. Ghost entries clear on their own - they just
take time.

**What to do right now:**

1. Stop restarting containers (additional restarts only add more ghost entries).
2. Verify the *currently running* entries are healthy:
   ```bash
   docker logs dune-awakening-director-1 --since 5m 2>&1 | grep '"displayName"' | tail -4
   ```
   The two current entries should show your configured display names with `"ready":true`.
3. Wait 12-24 hours. Stale entries expire automatically.

**How to identify the current entries:**

```bash
# Get the current server IDs from gateway logs
docker logs dune-awakening-gateway-1 2>&1 | grep 'came up' | tail -4
```

The last line for each partition index (1 = Survival, 2 = Overmap) is the active entry.
All earlier entries for the same partition index are ghosts.

**Prevention:**

- Batch all necessary configuration changes and do a single clean restart rather than
  multiple sequential ones.
- When changing display names, update `.env` and `data/*/UserSettings/UserEngine.ini` on
  disk before restarting - the pre-start script handles this automatically now.
- Prefer `docker compose up -d <service>` over repeated `docker compose restart` when
  iterating on configuration.

## PTC vs Retail: Wrong Steam App ID {#ptc-vs-retail-wrong-steam-app-id}

**Symptom:** Server appears online (director reports `DeclareBattlegroupUpdates` success) but
is completely invisible to players running the retail game. Or the server is visible but
players receive a version mismatch error when connecting.

**Cause:** There are two separate dedicated server packages on Steam:

| Steam App ID | Build | Who can connect | Anonymous steamcmd? |
|---|---|---|---|
| `4754530` | Retail (Production) | Retail game clients | Yes (anonymous works) |
| `3104830` | PTC (Public Test Client) | PTC game clients | Yes (anonymous works) |

Running the PTC build when your players use the retail game (or vice versa) means the server
is invisible on the correct FLS environment. **Both apps are valid choices**  -  pick whichever
matches your players' clients. Both dedicated server packages download anonymously - no Steam
account or game ownership is required for either one; this repo's own update automation
(`scripts/update.sh`, the dashboard's "Apply Update") relies on this and always uses
`+login anonymous`. **`STEAM_APP_ID` in `.env` MUST match the manifest in
`steam/steamapps/appmanifest_*.acf`** or update checks will compare against the wrong app and
produce false-positive "update available" notifications.

**Fix:**

1. Verify your `.env`:
   ```bash
   grep STEAM_APP_ID .env
   # Should be: STEAM_APP_ID=4754530
   grep DUNE_IMAGE_TAG .env
   # Retail image tag example: DUNE_IMAGE_TAG=1979201-0-shipping
   ```

2. Download the retail server with the correct App ID:
   ```bash
   steamcmd +login anonymous +app_update 4754530 validate +quit
   ```

3. Load and tag the new image (Funcom ships tarballs; the loaded image has a `registry.funcom.com`
   prefix that must be re-tagged to match the compose file):
   ```bash
   # Load the tarball (adjust filename to match downloaded version)
   docker load < server-1979201-0-shipping.tar.gz
   # Re-tag to the short name used by docker-compose.yml
   docker tag registry.funcom.com/funcom/self-hosting/seabass-server:1979201-0-shipping \
     funcom/self-hosting/seabass-server:1979201-0-shipping
   ```

4. Update `.env` and reinitialize the database (same procedure as
   [Operations - After an Image Version Upgrade](./OPERATIONS.md#after-an-image-version-upgrade-db-re-init-required);
   the schema changes between major versions):
   ```bash
   # Update image tag
   sed -i 's/DUNE_IMAGE_TAG=.*/DUNE_IMAGE_TAG=1979201-0-shipping/' .env
   sed -i 's/STEAM_APP_ID=.*/STEAM_APP_ID=4754530/' .env

   # Stop all services
   docker compose -f docker-compose.yml -f docker-compose.basic.yml down

   # Drop and recreate the database (WARNING: destroys world data -- backup first)
   docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
     -c "DROP DATABASE IF EXISTS dune_sb_1_4_0_0;"
   docker exec dune-awakening-postgres-1 psql -U dune -d postgres \
     -c "CREATE DATABASE dune_sb_1_4_0_0 OWNER dune;"

   # Re-initialize schema
   docker compose -f docker-compose.yml up db-init --force-recreate

   # Start everything
   docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d
   ```

5. After the stack is up, restart the director to clear any `QueryPlayerOnlineStates`
   exceptions that occur immediately after a DB re-init:
   ```bash
   docker compose -f docker-compose.yml restart director
   ```

**Identifying the current image tag:**

```bash
docker images funcom/self-hosting/seabass-server
# or check the running container
docker inspect dune-awakening-survival-1 --format '{{.Config.Image}}'
```

## "Destination Unavailable" When Joining

**Symptoms:** Player clicks "Join" in the server browser and gets `sb5Q2$ Destination unavailable 5Q2`.

**Cause:** The director cannot find a valid partition for the player. This happens when:
- The `partition_id` on the player's actors references a partition that does not exist in `world_partition`
- Most commonly occurs after a database re-initialization where partition IDs changed (e.g., PTC partition 19 became retail partition 1)

**Diagnosis:**

```bash
# Check what partition the player's actors reference
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT a.id, a.partition_id, a.map
  FROM dune.actors a
  JOIN dune.encrypted_player_state eps ON a.id IN (eps.player_controller_id, eps.player_pawn_id, eps.player_state_id)
"

# Check what partitions actually exist
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT partition_id, map, server_id FROM dune.world_partition
"
```

**Fix:**

```sql
-- Update actors to reference the correct current partition_id
-- Example: PTC used partition_id=19 for HaggaBasin, retail uses partition_id=1
UPDATE dune.actors SET partition_id = 1
WHERE map = 'HaggaBasin' AND (partition_id = 19 OR partition_id IS NULL);

-- Clear stale server_id references on player state
UPDATE dune.encrypted_player_state SET server_id = NULL WHERE server_id IS NOT NULL;

-- Ensure all players are marked offline
UPDATE dune.encrypted_player_state SET online_status = 'Offline';
```

Restart the director after making changes:
```bash
docker compose -f docker-compose.yml restart director
```

## "A Storm Has Reset the Map" / Missing Buildings

**Symptoms:** After restoring player data from a backup, the game shows "A storm has reset the map" and player bases are missing, even though building data exists in the database.

**Cause:** Three tables track a reset counter for the world: `world_partition_reset_seed` (per partition), `world_map_reset_seed` (per map), and `world_farm_reset_seed`. When the game server reads a different seed than the one the buildings were created under, it triggers a "storm reset" and hides the buildings in-game. The building rows usually remain in the database, so this is most often a display problem, not data loss.

This commonly happens after restoring a PTC backup to a retail database, where partition IDs changed (PTC partition 19 with seed 1 becomes retail partition 1 with seed 2).

**Critical detail:** The game server **overwrites** the reset seed back to its default value (2) during late startup, roughly 30-60 seconds after the container starts, and again during runtime. The fix must therefore force the seed **before** the game server reads it at boot, and re-assert it afterward. A one-time SQL fix run against a live server will be reverted on the next restart unless the automated seed protection is enabled.

**Confirm it is a display issue, not data loss:** Building counts that are stable across backups (for example `building_instances` holding steady at the same number for days) mean nothing was deleted. The bases are intact and only hidden by the seed mismatch. Correcting the seed and restarting the affected map server makes them reappear; no backup restore is required.

**Diagnosis:**

```bash
# Check current reset seeds (all three tables)
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT * FROM dune.world_partition_reset_seed;
  SELECT * FROM dune.world_map_reset_seed;
  SELECT * FROM dune.world_farm_reset_seed;
"

# Verify buildings still exist in DB
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT count(*) as buildings FROM dune.buildings;
  SELECT count(*) as pieces FROM dune.building_instances;
  SELECT count(*) as placeables FROM dune.placeables;
"
```

**One-time fix** (will be reverted on next server restart unless the automated protection below is enabled):

```sql
-- If buildings were created under seed 1, set every seed table back to 1
UPDATE dune.world_partition_reset_seed SET world_reset_seed = 1;
UPDATE dune.world_map_reset_seed       SET world_reset_seed = 1;
UPDATE dune.world_farm_reset_seed      SET world_reset_seed = 1;
```

**Permanent fix (recommended):**

Add `SURVIVAL_RESET_SEED=1` to your `.env` file. The `survival-pre-start.sh` entrypoint script then protects the seed in two stages:

1. **Pre-game enforcement** - before launching the game server, it forces `world_partition_reset_seed`, `world_map_reset_seed`, and `world_farm_reset_seed` to the configured value. This closes the race window where the game server's storm-reset check ran before the seed could be corrected (the root cause of bases being "wiped again" after a restart).
2. **Post-start backstop** - a background loop monitors all three tables for about 10 minutes after boot and re-asserts the seed whenever the game server drifts it back to the default, so the value reliably holds through and beyond the storm-reset check.
3. **Seed guardian sidecar** - the `seed-guardian` service (in `docker-compose.basic.yml`) keeps the seed pinned continuously (every `SEED_GUARD_INTERVAL` seconds, default 300), so the value is already correct at any moment a boot might read it, independent of boot timing or which service triggered the restart. It is a safe no-op when `SURVIVAL_RESET_SEED` is unset.

```bash
# In .env
SURVIVAL_RESET_SEED=1
```

Then restart the survival server:

```bash
docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d survival_1
```

Watch the container logs to confirm the seed correction is working:

```bash
docker logs -f dune-awakening-survival-1-1 2>&1 | grep -i "reset.seed"
```

You should see output like:

```
[reset-seed] Attempt 1: current seed = 2, expected = 1 -- fixing
[reset-seed] Attempt 2: current seed = 2, expected = 1 -- fixing
[reset-seed] Attempt 3: current seed = 1 -- correct, stopping
```

**Important:** Use `docker compose up -d` (not `docker compose restart`) if you also changed `.env`. The game server must restart to pick up the corrected seed from the database. This will create one more ghost entry in the browser (clears in 12-24 hours).

## Character Transfer Error M72

**Symptoms:** A player sees "Transfer Character" on login but the transfer always fails with error M72. Cancelling the transfer via the Director's `/CancelTransfer` API appears to succeed, but the transfer is re-offered on the next login.

**Cause:** Funcom Live Services (FLS) stores a pending character transfer token server-side. When a server is decommissioned (e.g., shutting down a PTC server) while a player has an active transfer, the token persists in FLS indefinitely. The local `CancelTransfer` only clears the local database state; FLS re-offers the transfer on every subsequent login.

**Diagnosis:**

```bash
# Check the director logs for transfer-related errors
docker logs dune-awakening-director-1 2>&1 | grep -i "transfer\|M72"

# Check if the player has pending transfer state in the database
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c "
  SELECT * FROM dune.character_transfers ORDER BY id DESC LIMIT 5;
"
```

**Known workarounds (partial):**

1. **Clear local transfer state:** Delete any rows in `dune.character_transfers` for the affected account. This does not fix the FLS-side token but prevents local errors.

2. **Ignore the transfer prompt:** If the player can dismiss the transfer dialog, they can continue playing on their existing character.

3. **Contact Funcom support:** The FLS-side token can only be cleared by Funcom. Open a support ticket referencing error M72 and provide the player's Steam ID.

**This is a known limitation** of the self-hosted server architecture. There is currently no server-side API to clear FLS transfer tokens.

## Teleport Puts Player Underground

**Symptoms:** Using the dashboard map teleport feature, the player logs out and back in but spawns underneath the terrain, falling through the void.

**Cause:** The game world terrain height (Z coordinate) varies wildly across the map, from Z=200 in low areas to Z=3500+ in elevated regions. A fixed default Z value will be underground in some areas. Additionally, building foundation Z values are typically 200-400 units below the player standing height at that location.

**How the smart Z system works:**

The teleport API automatically corrects the Z coordinate to prevent underground spawns. When you teleport via the dashboard:

1. The backend queries all known actor positions (players, buildings) near the target X,Y
2. It finds the nearest actor's Z coordinate
3. It uses `max(nearest_z + 500, requested_z)` as the actual teleport Z
4. This ensures the player spawns at least 500 units above the nearest known entity

**Important: Player must log out FIRST**

The game server holds player position in memory and periodically writes it to the database. If you teleport while the player is online:

1. Dashboard writes new position to DB
2. Player disconnects
3. Game server flushes the player's in-game position to DB, **overwriting the teleport**
4. Player reconnects at their original position

**Correct procedure:**

1. Player logs out of the game completely
2. Set the teleport destination on the dashboard map
3. Click the teleport button for the target player
4. Player logs back in and spawns at the new location

**Manual teleport via SQL (if the dashboard is unavailable):**

```sql
-- Find the player's actor ID
SELECT eps.player_pawn_id, ea.platform_id
FROM dune.encrypted_player_state eps
JOIN dune.encrypted_accounts ea ON ea.id = eps.account_id;

-- Teleport to specific coordinates (player must be offline)
UPDATE dune.actors
SET transform = ROW(
    ROW(156733, 314506, 1200)::vector,
    (transform).rotation
)::transform
WHERE id = <player_pawn_id>;
```

**Choosing safe coordinates:**

Check where other players or bases are to find valid terrain Z values:

```sql
-- See all player and building positions
SELECT a.id, a.transform::text
FROM dune.actors a
WHERE a.transform IS NOT NULL;
```

Use a Z value at least 300-500 units above any nearby actor's Z to ensure the player lands on the surface.

## Granted Items Not Appearing In-Game

**Symptoms:** You grant an item (or solari) to a character through the dashboard or directly via SQL. The API reports success and the row is present in the `dune.items` table, but the item never shows up in the player's inventory in-game -- even after the player logs out and back in. This almost always means the `template_id` is wrong (a recipe name, not an item template); a correctly-templated grant *does* appear after the player relogs.

**Quaternary issue (slot conflicts in `dune.items`):** Postgres has no `UNIQUE` constraint on `(inventory_id, position_index)` because the running game writes its own inventory state and a hard constraint would risk crashing the server. As a result, a row at slot N can collide with a row the game later writes to the same slot (e.g. the player picks up loot that lands at the same `position_index` you used). The game engine renders only one row per slot, so the conflicting items become invisible "ghost" stacks. Detect and repair via:

```bash
bash scripts/inventory-conflicts.sh                # detection only
bash scripts/inventory-conflicts.sh --repair       # move duplicates to free slots
```

The repair script keeps the lowest-id row in place and moves later rows to free slots in `[0, max_item_count)`. It is safe to run on a live server; the moves load on the next main-menu rejoin (same as grant-item).

**Quinary issue (UE engine deduplicates same-template stacks at render):** clicking a grant button multiple times can leave you with several stacks of the same `template_id` in the same inventory. The UE engine seems to deduplicate by template at the render layer  -  only one stack draws, even though all rows are in the database. Symptom: "I clicked the button 3 times, only 1 stack appeared." Fix: move the duplicate stacks to a different inventory (e.g. a storage chest) so each container has at most one stack of the template.

**Catalog dual-verification rule (lessons learned):** when you find an item template id from any source (reference data or a recipe lookup), **always cross-check it against** the live `dune.items` table BEFORE adding it to the spawn catalog. Reference data is necessary but not sufficient  -  this server uses the lowercase variant `healthpack_channeled` (6 real instances) while reference data often documents the PascalCase `HealthPack_Channeled` (0 real instances). Granting under the wrong spelling produces a silent ghost. Run:

```sql
SELECT count(*) FROM dune.items WHERE template_id = '<the id you want to add>';
```

If the count is 0 AND the wiki has it, treat it as unverified until you can grant + rejoin and confirm it renders. The dashboard's `/api/items/templates` search marks each entry with a `source` flag (`inventory` = real instances exist, `recipe` = recipe-only, `catalog` = curated). Prefer `inventory`-source entries.

**Cause #0 (the most common one): wrong `template_id` -- a recipe name, not an item template.** The game instantiates inventory items by their **item template id**, which is frequently different from the **crafting-recipe name**. For example, the recipe that produces silicon is named `T2_Material_Silicone`, but the item template the game actually renders is just `Silicone`. If you grant `T2_Material_Silicone`, a row is written and even passes a naive "does this name exist in game data?" check (it matches the recipe), but the server cannot instantiate it on load -- it reserves the inventory slot as an invisible "ghost" and never draws the item. The dashboard now resolves recipe-style names (trailing segment match, e.g. `T2_Material_Silicone` -> `Silicone`) for **every** grant -- including curated catalog entries such as the tier-prefixed names `T3_Material_CopperBar` -> `CopperBar`, `T2_MiscEquipment_PowerPack` -> `PowerPack`, and `T3_Tool_SurveyProbeLauncher` -> `SurveyProbeLauncher` -- and rejects names that exist only as recipes. To find a correct template id, look at what real items use:

```sql
-- Find the actual item template the game renders (not the recipe name)
SELECT DISTINCT template_id FROM dune.items WHERE template_id ILIKE '%silic%';
-- -> "Silicone"  (NOT "T2_Material_Silicone")
```

If you already injected a ghost row with a bad template, fix it in place. The corrected item loads the next time the player joins the server (see below) -- a relog, not a full restart, is sufficient:

```sql
UPDATE dune.items SET template_id = 'Silicone' WHERE id = <ghost_item_id>;
```

**Cause (the important one): the server reads inventory from the database on player LOGIN.** The game server holds a player's inventory in memory while they are connected and only **writes** it back to the database during the session. It **re-reads** the inventory rows from the database when the player's character loads from persistence -- which happens on **login** (`LoadPlayerActors` / `LoadPawn` / `SpawnPawnFromPersistence` in the server log). A directly inserted item therefore appears after the player **relogs**: return to the main menu and rejoin the server. A full **server restart is NOT required** -- a restart only works because it forces every player to relog.

> Verified empirically: an item written ~31 minutes into server uptime (`RestartCount=0`, no restart) appeared in-game after the player logged out (`UNetConnection::Close`) and logged back in (`LoadPlayerActors`). An earlier belief that "a relog is not enough, only a cold restart works" was a misdiagnosis caused by a ghost `template_id` -- the relog *was* reading the database, but the recipe-named ghost item could not be instantiated, so nothing was drawn.

This is the same mechanism as teleport: the pawn transform and the inventory are both re-read when the player's character spawns on login.

**Secondary issue (granting while online):** If you insert an item while the player is online, the server owns the live inventory and *may* overwrite or delete your row on the player's next logout flush (it rewrites the slots it manages). In practice a row written to a free slot usually survives the flush and loads on the next login, but to be safe prefer granting while the player sits at the main menu, then have them rejoin. If an online grant does not appear after relogging, re-grant at the menu and rejoin.

**Tertiary issue (slot capacity):** Each inventory has a `max_item_count` (a default backpack is 35). Items written to a `position_index` at or above that count exist in the database but are never rendered. The dashboard now allocates the first free slot within `[0, max_item_count)` automatically; if you insert via raw SQL, pick a free slot below `max_item_count`.

**Correct, reliable procedure:**

1. Insert the item (via the dashboard, or via SQL into a free slot below `max_item_count`). Use the correct **item template id**, not a recipe name.
2. Have the player **return to the main menu** and **rejoin** the server. On login the server loads the inventory from the database, including your item.

That is all -- no `docker compose stop`/`up` is needed. (If you prefer to eliminate any chance of the logout flush touching the row, grant while the player is already at the main menu, then have them join.) The granted row stays safely in the database until the player next logs in, so it will also appear after any scheduled server restart if the player does not relog sooner.

**Dashboard behavior:** The grant API returns a `warning` noting that the item appears after the player relogs (no restart required), and adds a second note (and sets `player_online: true`) if the player is currently online. The Characters page surfaces this as a "Relog to load the item" panel.

**Verify the row was written:**

```sql
-- Items in a player's backpack (inventory_type 0)
SELECT it.id, it.template_id, it.stack_size, it.position_index
FROM dune.items it
JOIN dune.inventories inv ON inv.id = it.inventory_id
JOIN dune.actors a ON a.id = inv.actor_id
WHERE a.owner_account_id = <account_id>
  AND inv.inventory_type = 0
ORDER BY it.position_index;

-- Confirm the slot is below the backpack capacity
SELECT id, inventory_type, max_item_count
FROM dune.inventories WHERE id = <inventory_id>;
```

**Oversized stacks:** If you request a `stack_size` larger than the largest stack the game normally uses for that item, the grant still succeeds but the API adds a warning. The server may cap, split, or move the oversized stack to overflow inventory on load. Prefer granting multiple normal-sized stacks over one huge stack.

## Restoring Player Data After DB Re-Init

When the database is dropped and recreated for a major version upgrade, all player data (characters, bases, items, progression) is lost. If you have a pre-upgrade backup, you can restore it.

**Prerequisites:**
- A pre-upgrade PostgreSQL backup (created by `scripts/backup.sh --scope db` or the automatic pre-update backup)
- The backup must be from a compatible server version

### Full Restore from pg_dump Backup

If your backup is a `pg_dump` custom format (`.dump` file):

```bash
# Stop game servers first
docker compose -f docker-compose.yml -f docker-compose.basic.yml stop survival_1 overmap

# Restore into the game database
docker exec -i dune-awakening-postgres-1 pg_restore -U dune -d dune_sb_1_4_0_0 \
  --clean --if-exists < backups/your-backup-file.dump

# Restart everything
docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d
```

### Selective Restore from SQL Backup

If your backup is a gzipped SQL dump (`.sql.gz`), you can extract and restore specific tables. Key player data tables:

| Category | Tables |
|---|---|
| Accounts | `encrypted_accounts`, `encrypted_player_state` |
| Characters | `actors`, `actor_fgl_entities`, `fgl_entities`, `actor_state` |
| Inventory | `inventories`, `actor_inventories`, `items` |
| Bases | `buildings`, `building_instances`, `building_favorites`, `building_progression`, `totems`, `placeables`, `permission_actor`, `permission_actor_rank` |
| Progression | `journey_story_node`, `player_markers`, `markers`, `map_areas`, `lore_pickups`, `dialogue_met_npcs`, `dialogue_taken_nodes`, `tutorial_per_player` |
| Vehicles | `vehicles`, `vehicle_modules` |
| World state | `actor_spawners`, `resourcefield_state`, `game_events`, `factions` |

**Critical post-restore steps:**

1. **Fix partition IDs** if migrating between PTC and retail (partition numbering differs):
   ```sql
   UPDATE dune.actors SET partition_id = 1
   WHERE map = 'HaggaBasin' AND partition_id NOT IN (
     SELECT partition_id FROM dune.world_partition
   );
   ```

2. **Clear stale server references:**
   ```sql
   UPDATE dune.encrypted_player_state SET server_id = NULL, online_status = 'Offline';
   ```

3. **Fix reset seeds** to prevent "storm reset" (see above section).

4. **Reset sequences** to avoid primary key conflicts:
   ```sql
   SELECT setval('dune.actors_id_seq', COALESCE((SELECT MAX(id) FROM dune.actors), 1));
   SELECT setval('dune.inventories_id_seq', COALESCE((SELECT MAX(id) FROM dune.inventories), 1));
   SELECT setval('dune.items_id_seq', COALESCE((SELECT MAX(id) FROM dune.items), 1));
   ```

5. **Restart the director** to refresh its cache:
   ```bash
   docker compose -f docker-compose.yml restart director
   ```

### Backup Best Practices

- **Always back up before updates:** `scripts/update.sh` now creates an automatic pre-update backup
- **Manual backup:** `bash scripts/backup.sh --scope full`
- **Keep multiple backups:** Set `BACKUP_RETENTION_DAYS` in `.env` (default: 30 days)
- **Test restores periodically** to ensure backups are valid

## `docker restart` vs `docker compose up -d`

**Symptom:** You changed `.env` (display name, password, image tag) and restarted the container, but the change did not take effect.

**Cause:** `docker compose restart` restarts the existing container with its original environment. It does NOT re-read `.env` or recreate the container.

**Fix:** Use `docker compose up -d <service>` instead. This recreates the container with the updated environment:

```bash
# This picks up .env changes:
docker compose -f docker-compose.yml -f docker-compose.basic.yml up -d survival_1

# This does NOT pick up .env changes:
docker compose restart survival_1
```

**When to use each:**
- `docker compose restart` - Quick restart, no config changes needed
- `docker compose up -d` - After changing `.env`, compose files, or image tags

## "Connection failure CF4" / "Pending Connection Failure"  -  Open Investigation

**Symptoms:** Players see client error **CF4** or **"Pending Connection Failure"**, most often when their character was last in the Overmap (Deep Desert). The client reaches the game server but is dropped during login, and the game server log shows:

```
LogDuneS2sController: Error: Failing battlegroup director travel validation: Failed to find server for partition for 2
LogIGW: Display: Refusing player by sending NMT_Failure with message: Internal error in authentication.
```

This is **not** a network or port problem: the client reaches the server (its `RemoteAddr` appears in the game server log). The login fails at the **Completion** stage, when the game server makes a server-to-server call asking the Director to validate travel to its partition, and the Director cannot find a server for that partition.

**Status:** Multiple hypotheses have been investigated; none has been definitively validated by a live login attempt. This section documents what's known, what's been tried, and what's been ruled out so the next investigation doesn't repeat dead-ends.

### What is known (verified facts)

- Both game servers run the *same* underlying Unreal level (`Survival_1.Survival_1`). The Overmap is partition 2 / dimension "Overland" of the Survival_1 world; partition 1 ("Abbir") is Hagga Basin.
- Even though the Overmap container is launched with the UE map argument `/Game/Dune/Systems/Overmap/Overmap.Overmap`, at runtime it loads and **reports `map=Survival_1`** in both its RMQ travel-completion message and the gateway "came up" event (`Server X (map=Survival_1, partition_index=2, ...) came up!`).
- `world_partition` labels partition 2 as `map='Overmap'` and partition 1 as `map='Survival_1'`. This is the **correct** topology  -  see "Approaches that broke things" below.
- Both servers register normally in `farm_state` and `world_partition`; partition-repair reports both ports OK with no required updates.

### Approaches that broke things (do not retry without redesign)

1. **Restarting the Director alone.** Made things worse: the Director's per-instance travel-validation registry was wiped, so subsequent logins also failed. **Don't do this in isolation.**
2. **Restarting the gateway alone.** No effect  -  the Director's registry isn't repopulated by gateway came-up events alone for the Completion stage.
3. **Relabeling partition 2 to `map='Survival_1'`** (so both stages resolve to the same map): broke service in two ways:
   - **FLS browser dedupe by map name:** with both partitions sharing `Survival_1`, the in-game server browser shows only the most-recently-registered partition (e.g. only "Sietch Tabr" appears, "Hagga Basin Taco Land" disappears).
   - **Pre-start `SKIP LOCKED` claim ambiguity:** `scripts/survival-pre-start.sh`'s claim subquery selects `WHERE map=$PARTITION_MAP_NAME ORDER BY partition_id LIMIT 1`. With two partitions sharing a map, the claim returns 0 rows, the overmap can't link itself in `world_partition`, farm consensus fails (`Server X thinks farm size is 2 but local size is 1`), and the overmap enters a ~30s crash loop.
   The DB change and the `PARTITION_PORT_MAP`/`PARTITION_MAP_NAME` env changes that backed it have all been reverted. Map labels MUST stay distinct (`Survival_1` for partition 1, `Overmap` for partition 2). **2026-06-06 RESEARCH:** Inspected Funcom's own `/workspace/steam-live/scripts/setup/templates/world-template.yaml`, which is the authoritative partition table. It defines `map: Overmap` for partition_id 2 - confirming our DB schema is correct. The `Survival1_to_Overland_E2 -> Map(Overland)` lookup in `UDuneIgwFunctionLibrary::UpdateTravelDestination` is a destination-registry name (`Overland`) that does not match the battlegroup-routing name (`Overmap`) used by world_partition; the game's pak data registers destinations using gameplay-feature map names while director routes by battlegroup map names. There is no config-based translation between them in `DefaultGame.ini` or any shipped `.ini`/`.yaml` we could find. **2026-06-07 RESOLUTION:** The missing link was `get_active_servers_for_gateway()`. The overworld server self-reports `map=Survival_1` (the battlegroup/farm map) in `farm_state`, and that stored function returned `fs.map`, so gateway destination discovery saw *no* server registered for the overworld map and `UpdateTravelDestination` failed with "unable to find destination". `world_partition.map` already carries the correct per-partition name (`Overmap`), so `scripts/partition_repair.py` (`fix_gateway_function`) now patches the function to return `wp.map` instead of `fs.map`. The overworld server becomes discoverable on its **canonical partition 2** as `Overmap` (which the `Overland` -> `Overmap` `downgrade_map_name` mapping resolves against), with the Hagga Basin server unchanged. This is preferred over the earlier idea of a second `world_partition` alias row (`partition_id=99, map='Overland'`), which would have created a duplicate logical partition for the same physical server and risked routing a hand-off to a partition the target server does not own. See "P83 on overworld travel" earlier in this document; final confirmation requires an in-game travel attempt.

### Hardening that has been kept (real, beneficial fixes)

- **`farm_state` cleanup is now `game_port`-scoped.** `scripts/survival-pre-start.sh` clears stale registrations with `DELETE FROM dune.farm_state WHERE game_port=$GAME_PORT` (driven by `GAME_PORT` env: `7777` survival / `7778` overmap, set in `docker-compose.basic.yml`) instead of by the shared `map`. This prevents a Survival restart from wiping the live Overmap row. Both servers report `farm_state.map='Survival_1'` at runtime, so a `map`-scoped delete on a Survival restart would otherwise also delete the live Overmap row  -  producing the same `Failed to find server for partition for 2` symptom. This is *separate* from CF4's primary cause but produces the same symptom and is worth keeping.

### Confirm the symptom

```bash
# Game server refuses login at the Completion stage
docker logs --since 15m dune-awakening-overmap-1 2>&1 | grep -E "travel validation|Internal error in authentication"

# Director cannot validate the destination partition
docker logs --since 15m dune-awakening-director-1 2>&1 | grep "Failed to find server"

# Confirm both servers are healthy and the topology is correct
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c \
  "SELECT partition_id, server_id, map, label FROM dune.world_partition WHERE partition_id IN (1,2) ORDER BY partition_id;"
docker exec dune-awakening-postgres-1 psql -U dune -d dune_sb_1_4_0_0 -c \
  "SELECT server_id, game_port, map, ready, alive FROM dune.farm_state ORDER BY game_port, alive DESC;"
```

Healthy topology should show: partition 1 → `map=Survival_1`, partition 2 → `map=Overmap`, both with valid `server_id` values; `farm_state` has one ready+alive row per port.

### Next-investigation hypotheses (not yet validated)

These are the most likely directions to explore next, in rough priority order:

1. **Director's per-map dimension-group construction.** The Completion stage uses the RMQ message's `MapName` to look up partition 2 inside a dimension group. If the lookup is keyed on `MapName` and the Director only builds groups from `world_partition.map`, then partition 2 can never be found via `MapName=Survival_1` while it's labeled `map=Overmap`. Investigate the Director's grouping logic (likely in `/Tools/Battlegroups/Director/...`) and whether it can be configured to alias `Overmap` ↔ `Survival_1` for partition 2 without changing `world_partition.map`.
2. **Custom DB function `load_world_partition()` aliasing.** The patched fallback already does `WHERE map=in_map_name OR map='Overmap'`. Investigate whether a similar bidirectional alias for the Director's group lookup is possible (a stored function or a view).
3. **Game-server-side `MapName` override.** Investigate whether the Overmap can be configured (via UE ini or a launch arg) to report `map='Overmap'` in its RMQ travel-completion message instead of `map='Survival_1'`. If so, both Grant and Completion would resolve to `map=Overmap` consistently.
4. **Retail-Funcom topology cross-check.** In retail Dune Awakening the same architecture works; investigate retail's `world_partition` schema to see whether partition 2 is labeled `Overmap` or `Survival_1` and how the Director resolves it.

Each hypothesis above must be **tested with a real Deep-Desert login attempt**  -  server-side metric checks alone (e.g. "0 `Failed to find server` errors over 5 minutes") are NOT sufficient evidence, because the error only fires when a real client login reaches the Completion stage. Multiple "the symptom is gone" reports in this incident were false positives caused by no real login occurring during the verification window.

---

**Last updated:** 2026-05-30  
**Version:** 1.8
