# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed

- Dashboard frontend Next.js 15.5.21 -> 16.3.x, with matching `eslint-config-next`. Dependabot #74 could not merge: once `eslint-config-next` is 16, the previous FlatCompat `extends('next/core-web-vitals')` path crashes ESLint 9 with "Converting circular structure to JSON", so `npm run lint` never ran and the bump stayed a draft. The config now loads `eslint-config-next/core-web-vitals` as a native flat config. `@eslint/eslintrc` is unused after the native flat config and is gone
- `src/middleware.ts` renamed to `src/proxy.ts` and the exported function to `proxy`, matching the Next 16 file convention. CI now asserts the auth gating on that path (and refuses a leftover `middleware.ts`)
- `recharts` 2.15 -> 3.x. The dashboard charts never used `CategoricalChartState` / `<Customized />`, which is the breaking surface
- Session sign-out uses `router.replace('/login')` instead of `window.location.assign`, which Next 16 flags as a relative-destination navigation
- React compiler `refs` and `purity` rules are on. Callback refs update in an effect instead of during render, and clocks go through `useNow` (`useSyncExternalStore`) instead of `Date.now()` in render. `set-state-in-effect` stays off: it still flags ~18 fetch/prop-sync effects across dashboard pages, which is a separate rewrite

### Fixed

- `scripts/security-audit.sh` reported a false failure on the `DUNE_ADMIN_TOKEN=ci-image-smoke` literal that the new image-build job passes to a throwaway container. That value cannot be named `change-me...` like the other placeholders the scan already ignores, because the backend deliberately refuses to start on a token with that prefix, so a CI smoke test needs something real enough to boot and obviously not a credential. An audit that cries wolf is one people stop reading
- The same scan silently reported success on macOS. Its patterns use PCRE negative lookahead, which BSD grep does not support: grep exited 2 with `invalid option -- P`, the error went to `/dev/null`, and an empty result was indistinguishable from "nothing found". It now probes for `grep -P` up front and warns that it skipped the scan, rather than passing without having searched anything

## [1.7.1] - 2026-08-20

### Security

- `nanoid` 3.3.17 -> 3.3.18, closing CVE-2026-67213 / GHSA-2v37-7h3g-55p8 (high, CVSS 5.9): a custom generator built with `customAlphabet` loops indefinitely when asked for size zero. The package is only reachable transitively, through `postcss`, and `postcss` accepts `^3.3.16`, so the patch satisfied the existing range with no API change (#63)

### Added

- Dependabot configuration (`.github/dependabot.yml`) for npm, pip, GitHub Actions, and Docker. Without a config file GitHub only opens *security* PRs, and only for the two application manifests, so the pinned base images in `dashboard/*/Dockerfile` and the pinned action refs in `.github/workflows` were not being watched at all - a patched base image or action release had no route into the repository. `next`/`eslint-config-next` and the React type packages are grouped, because those are version-locked to each other and splitting them across PRs produces a peer-dependency conflict that cannot merge

### Changed

- `scripts/sanitize-check.sh` now scans for secret material that it previously missed: private keys of every flavour, GitHub/AWS/Google/Slack/npm/OpenAI tokens, `Authorization: Bearer` credentials, and connection strings carrying an inline password. The check ran as a pre-commit hook and as the `--history` auditor, but every deployment-specific pattern in it was a commented-out template, so the three categories the README advertised most prominently - internal hostnames, SSH usernames, IPs - were not actually being checked and the resulting `ALL CLEAN` was weaker than it appeared. Those values now load from an untracked `.sanitize-patterns.local` instead of the tracked pattern list: this repository is public, so committing a pattern to catch your own hostname would publish that hostname. When no local file is present the summary says so rather than implying full coverage. Matches are filtered against an allowlist of placeholders (`change-me*`, `your-host`, `<YOUR_IP>`, RFC documentation values) so the hook stays quiet on the repository's own examples
- `.github/workflows/ci.yml` declares `permissions: contents: read`. No job writes to the repository; stating it explicitly keeps the token read-only even if the org or repo default is later widened
- README: corrected the `sanitize-check.sh` description to match what the script checks, documented `scripts/security-audit.sh` (previously undocumented), and expanded the contributor test commands to the full set CI runs - typecheck, lint, `python -m unittest discover -s tests`, and the `pip-audit`/`npm audit` gates
- CI now builds both runtime images and runs ESLint, neither of which it did before. The other jobs install dependencies through `setup-python`/`setup-node`, so nothing ever read the `FROM` lines and every base-image bump was effectively untested - the python 3.14 bump passed all four checks while producing an image that cannot build at all, because `pydantic-core` publishes no cp314 wheel and `slim-bookworm` has no Rust toolchain to compile one. The new job also boots the backend image and asserts it answers `/health` and still returns 401 on a privileged route without a token, since a successful build says nothing about whether the entrypoint runs. Likewise the repository shipped an ESLint config and a `lint` script that no job invoked, so a config that could not even load counted as passing. CI also moves to node 26 to match `node:26.3.0-alpine3.22` in the frontend Dockerfile, having previously built and tested on a different major than it shipped (#83)
- Dependency updates across both applications: `sqlalchemy` 2.0.52, `uvicorn` 0.52.3, `pika` 1.4.4, `docker` 7.2.0 and `python-dotenv` 1.2.3 on the backend; React 19.2.8, `lucide-react` 1.31 and the dev tooling on the frontend; the frontend base image to `node:26.3.0-alpine3.22`; and `actions/checkout`, `actions/setup-node` and `actions/setup-python` to v7 (#65, #68, #70-#73, #75, #78, #79, #81, #82)

### Fixed

- Server updates triggered from the dashboard could recreate the wrong containers, or report success when they had not worked. Image tags were compared with a substring test, so the tag `2064155` matched `2064155-0-shipping`; services on fixed tags such as PostgreSQL were swept into the set to recreate alongside the Funcom images; a failed rollback was logged as if it had succeeded; and the recreate subprocess inherited the API container's startup `DUNE_IMAGE_TAG` because environment variables take precedence over `--env-file` in Compose, so Compose could resolve a tag the update had already moved past. The host-side project directory is now discovered from the dashboard container's own Compose labels rather than assumed, since the path the Docker daemon needs is the host path, not the container's `/workspace`. Post-update verification checks the exact set of services that were recreated instead of counting substring matches (#62)

- `./dune status` failed outright with a Python `SyntaxError`, and `./dune ready` could not report which service was down. Both embed Python in a single-quoted shell string, and both used single quotes inside it (`item.get('Service', '')`), so the shell ended the string at the first inner quote and handed Python `item.get(Service, )`. The embedded programs now use `%`-formatting and double quotes only, with a comment recording the constraint. `status` is documented in the README as a primary command, so this was broken for every operator rather than an edge case
- `./dune status` and `./dune ready` also assumed `docker compose ps --format json` returns a JSON array. Current Compose releases print one JSON object per line, so `json.load` aborted with `Extra data: line 2 column 1` as soon as more than one service was running - meaning `ready` failed on exactly the multi-service stacks it exists to check. Both now accept newline-delimited objects, a bare array, or a single object, and treat empty input as "nothing running" rather than a crash

## [1.7.0] - 2026-08-06

### Added

- Interactive sign-in for the dashboard. `Settings > Users & Roles` previously listed accounts that could not actually be used to log in: `AdminUser` had no password column, and the Next.js middleware attached the shared `DUNE_ADMIN_TOKEN` to every proxied request, so anyone who could load the page was already a full operator. Accounts now carry a scrypt password hash, optional TOTP multi-factor, and opaque `HttpOnly` session cookies stored as SHA-256 digests. A new `/login` page handles both first-run setup and normal sign-in (#52)
- The security settings that were previously written to the database and never read are now enforced: session timeout (with a sliding window on both the server record and the browser cookie), multi-factor requirement, and the IP allowlist. Roles are enforced from the database row, across three tiers - viewer (read only), editor (configuration, announcements, players, characters) and operator (service lifecycle, updates, backups, credentials, user management) (#53)
- Self-service account management in `Settings`: set or reset another administrator's password, enrol your own authenticator app, and sign out of every session

### Fixed

- An accidental `KeyError` or `IndexError` anywhere in the API was reported to clients as `404 NOT_FOUND`, because both subclass `LookupError` and a blanket `LookupError` handler mapped to 404. That handler has been removed: every deliberate not-found signal in the codebase is already converted to an `HTTPException(404)` at its call site (the character, Discord, watchdog and announcement routers) or swallowed as internal control flow, so it was catching nothing intentional and only masking genuine bugs. Accidental errors now reach the generic handler - a logged `500` with a fixed, non-leaking message - and unhandled `ValueError` is logged too (#58)
- The audit trail page sent an `Authorization: Bearer` header built from `localStorage['admin_token']`, a key nothing ever sets, to a backend that does not read that header. It also routed through `NEXT_PUBLIC_API_URL`, an undocumented variable that would have bypassed server-side token injection had it been set. The page now uses same-origin `/api/v1/audit*` requests like the rest of the dashboard (#55)
- The role check matched privileged routes with a plain substring test, which missed several of them. An editor could restart the server (`/restart/now`, `/server/{action}`, `/services/{name}/{action}`, `/maps/{name}/start`), prepare a host shutdown (`/system/prepare-shutdown`), and rewrite the security policy itself (`/settings/security`). Operator-only routes are now matched with anchored patterns, pinned by a CI assertion and 26 probe cases (#53)
- The Server-Sent Events proxy at `/api/events/stream` is a Next.js route handler, so it shadows the `/api/*` rewrite and the backend's auth middleware never saw the browser's request. It attached the machine token unconditionally, which would have left the live event feed - service state, player joins, host metrics - readable without signing in. It now verifies the caller's session before proxying (#52)
- The Uptime Kuma push token was returned in full to any authenticated caller, including viewers, via `GET /settings`, `GET /settings/{section}` and the settings export. Non-operators now receive a placeholder, and saving that placeholder back restores the stored value rather than overwriting it. The same applies to `integrations.externalWebhooks`, since Slack, Discord and Teams webhook URLs carry the bearer secret in the path (#53)
- Server-rendered pages fetched the API with the machine token, so the backend answered as an operator regardless of who was actually signed in. Redaction was therefore bypassed for exactly the pages that display settings: a viewer's own HTML arrived with the credentials embedded in it. Server-side fetches now forward the caller's session cookie, and the backend prefers it over the token, so a page renders with its viewer's own permissions (#53)
- Importing a settings export written by a non-operator replaced the stored credentials with the literal placeholder string. Import now restores placeholders the same way a section save does (#53)
- The Next.js middleware and the SSE proxy treated a failed session check as "sign-in is not configured" and fell back to attaching the machine token. The flag they consulted is per-worker module state, so a freshly spawned worker had no memory of sign-in being enabled and any transient failure of that check handed out full operator access. Both now fail closed - a caller sees the login page instead. Relatedly, `/auth/session-check` is exempt from the IP allowlist: the frontend calls it server-side, so the backend sees the container's address, and blocking it was precisely what triggered the fallback (#52)
- The middleware briefly cached the "sign-in is not configured" answer. The only requests that cache could speed up were the ones with no session cookie, which are exactly the requests that receive the machine token - so for a few seconds after first-run setup an anonymous caller was still served as an operator. The answer is no longer cached (#52)
- Signing out, changing your own password and managing your own authenticator were rejected for viewers, because they are mutating requests and viewers are read-only. A viewer could not end their own session or rotate a compromised password. Self-service auth endpoints are now exempt from the role check; every other mutation is unaffected (#53)
- Failed sign-in attempts are throttled per username as well as per client IP. The client IP is derived from `X-Forwarded-For`, so an IP-only window could be sidestepped by varying the header
- Sign-in now bounds how much password-hashing work it will do in parallel, rather than spending a fixed budget of attempts per minute. Each attempt costs a deliberate memory-hard scrypt hash - including attempts for usernames that do not exist, which run a dummy verification so that a missing account and a wrong password take the same time - so an attacker cycling usernames could otherwise burn the host's CPU while sidestepping the per-username lockout. A fixed budget would have been its own denial of service, since exhausting it turns legitimate users away too; capping concurrency makes flooders queue behind each other and lets service resume the moment the flood stops. Session cookies that cannot possibly be valid are also rejected before the database is queried, and the failed-attempt table now evicts least-recently-used entries once full
- An open Server-Sent Events stream was only authorised at connect time, so signing out or revoking sessions left the event feed running until the browser disconnected. The proxy now re-checks the session every 60 seconds and closes the stream when it fails (#52)
- A session that lapsed while the dashboard was open left it silently broken - every request failed with nothing on screen to explain why, because no API call had ever handled a `401`. The client now sends you back to the login page, remembering where you were (#52)

### Changed

- `NEXT_PUBLIC_API_BASE_URL` has been removed. Because it was a `NEXT_PUBLIC_` variable it was read in the browser, so setting it made API calls skip the Next.js middleware that attaches the admin token - every request then failed authentication with nothing to indicate why. The token cannot be attached client-side instead, since anything the browser can read is in the bundle. Setting it now logs an explanatory warning and is otherwise ignored (#55)
- The dashboard's proxy target is now configurable server-side via `DUNE_DASHBOARD_API_URL` (default `http://dashboard-api:8080`), replacing the hardcoded destination in `next.config.js`. This is the supported way to point the dashboard at an API on another host: requests still traverse the middleware, so authentication keeps working (#55)
- Upgrading does not change how the dashboard behaves. Until an operator creates the first account it stays in token-only mode exactly as before, so an upgrade cannot lock anyone out of their own server. `DUNE_ADMIN_TOKEN` continues to authenticate scripts (`smoke-test.sh`, `shutdown-host.sh`, `update.sh`) and server-side rendering after sign-in is switched on. `DUNE_ADMIN_READ_AUTH=false` is ignored once accounts exist, since honouring it would silently undo the login requirement
- New settings: `DUNE_DASHBOARD_SECURE_COOKIES` (send the session cookie only over HTTPS; leave `false` for the default plain-HTTP deployment) and a documented `TRUSTED_PROXY_CIDRS`. The IP allowlist is only as trustworthy as that list - with the default private ranges, anything that can reach the dashboard can also choose its own `X-Forwarded-For`, so narrow it to a reverse proxy that overwrites the header before relying on the allowlist as a security boundary
- The `lint-backend` CI smoke check now also asserts that no blanket `LookupError`/`KeyError` exception handler is registered, so the masking behaviour cannot be reintroduced
- CI now pins the auth wiring: `lint-backend` asserts the operator/editor route classification and that `/auth/setup` is not public, and `build-frontend` asserts that the middleware and SSE proxy still gate the machine token behind a backend session check

## [1.6.1] - 2026-08-06

### Fixed

- `GET /api/system/version` returned `{"code": "NOT_FOUND", "message": "3"}` instead of the release version in every deployed stack. The list of candidate `VERSION` paths was built eagerly, so the source-checkout fallback `Path(__file__).resolve().parents[3]` was evaluated while the list was being constructed - before any path was tested. In a checkout that index is the repository root, but the image runs from `/app/routers/system.py`, which has only three parents, so it raised `IndexError`. The valid `/workspace/compose/VERSION` candidate was never reached even though the compose project-root mount makes it correct in a deployed stack
- A bare `IndexError` anywhere in the API was reported to clients as a `404 NOT_FOUND` and logged nothing at all, because `IndexError` subclasses `LookupError` and the `LookupError` handler maps to 404. Genuine crashes were indistinguishable from missing resources and left no trace in the logs, which is how the version bug above reached production unnoticed. `IndexError` now returns a logged `500 INTERNAL_ERROR`; the deliberate `LookupError`/`KeyError` not-found signals raised by the character, Discord, watchdog, and announcement services still return 404, and those are now logged too

### Changed

- The `lint-backend` CI job now runs a smoke check against the container's path layout. `py_compile` and `ast.parse` are purely syntactic, and a source checkout is deep enough that path-depth bugs cannot reproduce in CI, so the job now copies the backend to `/app` (matching the Dockerfile's `WORKDIR /app` and `COPY . .`), stages the project root at `/workspace/compose` as compose does, and asserts the version endpoint returns the contents of `VERSION`

## [1.6.0] - 2026-08-06

### Added

- Watchdog crash forensics: crash, crash-loop, and high-crash-rate Discord alerts now include an exit-code label (e.g. `139 SIGSEGV (segfault)`), an attribution hint (upstream Funcom/UE5 vs local OOM/config), and the best-effort fault line scraped from container logs
- Crash events are now persisted to a `watchdog_crashes` table so forensic history survives dashboard-api restarts; `GET /api/watchdog/crashes` reads from the DB (falling back to the in-memory buffer)
- `smoke-test.sh` now checks `/api/watchdog/status` and `/api/watchdog/crashes`
- `.env.example` now documents `DUNE_COMPOSE_OVERLAY`, `POSTGRES_DB_NAME`, `RESTART_COOLDOWN_SECONDS`, and `WATCHDOG_RMQ_GHOST_CLEANUP`
- Player allowlist management is now fully wired: the Allowlist tab on the Players page can add, list, and remove approved Steam IDs (new `DELETE /api/players/allowlist/{steam_id}` endpoint) with audit logging and Discord admin notifications, replacing the previous read-only placeholder
- New "Server Identity" panel on the Settings page lets operators change the in-game server name (`WORLD_NAME`) and broadcast address (`EXTERNAL_ADDRESS`); saving writes `.env` and recreates the game-server containers so the change is applied for real (new `GET`/`PUT /api/server/identity`)
- New "Connectivity and Travel Recovery" section on the Game Settings page exposes the per-map reconnect grace periods (`m_DefaultReconnectGracePeriodSeconds`, `m_OvermapReturnGracePeriodSeconds`, `m_InstancedMapReconnectGracePeriodSeconds`) with descriptions and recommended presets
- `scripts/dune-stack.service`: a systemd template that runs `dune start`/`dune stop` to bring the whole stack up on boot and down on shutdown (edit `User=` and the install path, then `systemctl enable --now dune-stack.service`)
- Troubleshooting now documents the complete in-game rubberbanding playbook - the `docker-compose.hostnet.yml` host-networking overlay, UDP socket receive-buffer sizing (with `RcvbufErrors` diagnosis), and NIC ring-buffer/GRO tuning - and the README Host Optimization section and docs index now surface `scripts/cpu-pin.sh`, the host-networking overlay, and the Operations and Monitoring guides

### Changed

- The standard profile (all maps) partition wiring was corrected so every map server registers on its canonical partition and cross-map travel works. `survival_1` and `overmap` had their game ports swapped relative to the proven basic profile and to `PARTITION_PORT_MAP`, so partition-repair would assign each server the wrong partition; survival is back on UDP `7777`/`7888` (partition 1) and overmap on `7778`/`7889` (partition 2). The `-PartitionIndex` values for the remaining maps were sequential-by-port instead of matching the canonical `world_partition` ids seeded by `bootstrap_db.py`; they are now aligned (Deep Desert 8, Arrakeen 3, Harko Village 4, Hephaestus 5, Carthag 6, WaterFat 7, Proces-Verbal 9). Every standard map server now sets `GAME_PORT` (previously unset, which skipped the entrypoint's stale `farm_state` cleanup and risked a crash loop on bring-up) and receives the full shared BackendLogin/Authentication secret block (previously only a subset), matching basic so player hand-offs between maps authenticate against the director
- `PARTITION_PORT_MAP` (the partition-repair port-to-map table) is now overridable from `.env` instead of being hardcoded to the two basic-profile ports; `.env.example` documents the full standard-profile value. The basic profile is unchanged: partition_repair.py falls back to its built-in `{"7777":"Survival_1","7778":"Overmap"}` default when the variable is unset
- `partition-repair` watch loop now re-applies the `get_active_servers_for_gateway()` and `load_world_partition()` function patches every cycle (idempotent, quiet unless a re-patch is needed), so a Funcom image upgrade, a `db-init` re-run, or a manual `psql` session that restores the stock definitions can no longer silently regress them until the container is restarted. Both patches detect the already-applied state with a positive sentinel and use `CREATE OR REPLACE` so the heavily-used functions are never briefly dropped
- README "Common CLI Commands" now lists `dune dashboard` and `dune doctor`
- QUICKSTART shows the explicit `http://127.0.0.1:18080` URL for the default local-only bind
- `*.tsbuildinfo` is now gitignored and the previously tracked `dashboard/frontend/tsconfig.tsbuildinfo` build artifact was removed, so a fresh build no longer dirties the working tree
- Spawnable-item grants now validate quantity at every layer (client, API schema, and service): stack size must be 1 to 10000 and quality 0 to 10, and the character editor gives explicit feedback when no character is selected or the quantity is invalid instead of silently doing nothing
- Item-template search and catalog browse now surface failures as an error toast (previously they failed silently) and show an info toast when a search returns no matches
- `allowlist_add` and `allowlist_remove` audit events now count toward the Audit page "Player" summary card
- The Hagga Basin map tactical and chart views now span the full blade width: removed the `min(92vh, 1600px)` max-width cap and `mx-auto` centering so the map fills the available column instead of sitting in a narrow centered box

### Fixed

- **Dashboard "Apply Update" failing with `steamcmd failed (rc=8)`:** the `dashboard-api` image installed `lib32gcc-s1` for SteamCMD's 32-bit `linux32/steamcmd` binary but not `lib32stdc++6`, so the binary's dynamic linker failed immediately after `steamcmd.sh` handed off to it (visible as `steamcmd.sh[PID]: Starting /home/app/steamcmd/linux32/steamcmd` followed by exit code 8, with no further output). `dashboard/backend/Dockerfile` now installs `lib32stdc++6` alongside `lib32gcc-s1`. Existing deployments need to rebuild the `dashboard-api` image (`docker compose build dashboard-api && docker compose up -d dashboard-api`). See `docs/TROUBLESHOOTING.md` → "Apply Update Fails with steamcmd failed (rc=8)"
- **Dashboard "Apply Update" OOM-killed mid-download (same `rc=8` message, different cause):** after fixing the missing library above, SteamCMD could start and log in but still fail with `rc=8` once it began actually downloading the multi-GB game server depot — the kernel's OOM killer was terminating the `steamcmd` process because `dashboard-api`'s `mem_limit`/`memswap_limit` was only `512m`, and the idle dashboard API process alone already used ~200MiB, leaving too little headroom. Raised both limits to `2g` in `docker-compose.yml`. A stuck update can also leave a stale `appmanifest_<id>.acf` reporting `state is 0x6` with 0 bytes planned to download on every retry; deleting that file forces SteamCMD to recompute a fresh update plan. See `docs/TROUBLESHOOTING.md` → "Same error, but after download progress starts (OOM kill)"
- **Game Settings page crashing with "Unable to load game settings":** `config/UserGame.ini`'s `[/Script/DuneSandbox.MapFpsSettings]` section legitimately repeats the same option name (`-m_Maps`/`+m_Maps`, one pair per map) using UE5's array add/remove ini convention, but `configparser.ConfigParser()` defaults to `strict=True` and raised `DuplicateOptionError` on the very first read, 500ing `GET /api/v1/config/UserGame.ini`. `dashboard/backend/services/config_service.py` now parses with `strict=False`. Saving a setting no longer re-serializes the whole file through `parser.write()` either (which would have silently collapsed the repeated `MapFpsSettings` lines down to one each on the next save) — `update_config` now rewrites only the single changed `key=value` line via a targeted text replacement, leaving every other line untouched. See `docs/TROUBLESHOOTING.md` → "Game Settings Page Shows Unable to load game settings"
- **Server missing from the in-game browser due to a stale game-server image tag:** `deep_desert_1` was still running an old `funcom/self-hosting/seabass-server` image tag while every other map server had moved to the current `DUNE_IMAGE_TAG`, causing `LogIGW: Error: Server not network compatible DuneS2sIpConnection_...` on S2S connections between it and its siblings. Docker does not recreate running containers when `.env` changes — each service needs an explicit `docker compose up -d <service>` — so a container skipped during an earlier partial update run is silently left behind indefinitely. No code change; this is an operational recovery documented in `docs/TROUBLESHOOTING.md` → "One map server left on a stale image tag after an update"
- **Dashboard "Director nudge" button always failing with "Service action failed":** the button called the restart API with the literal string `"director"` instead of the actual container name (e.g. `dune-awakening-director-1`), which the backend's `_validate_container_name` rejects as "outside the managed project" since it doesn't match the `dune-awakening-` prefix — every click failed, forcing a manual `docker restart` over SSH instead. `handleDirectorNudge` in `dashboard/frontend/src/app/(dashboard)/page.tsx` now resolves the real container name from the already-loaded service list first, the same way the per-service restart/stop/start buttons do. See `docs/TROUBLESHOOTING.md` → "Director Nudge"
- **S2S reliable-channel overflow crash (NumOutRec 2047):** survival_1 periodically crashed with no visible segfault/OOM because UE5's 2048-slot reliable message queue overflowed on the S2S self-connection (`Channel->NumOutRec 2047 exceeds 2047`). This caused survival_1 to mark itself dead and exit, then Docker auto-restarted it. The overflow occurred because default UE5 bandwidth caps throttled S2S message throughput below the rate needed during busy game events (spice blows, sandworms, cross-partition entity updates). Initial fix attempted `MaxClientRate=0`, `NetServerMaxTickRate=120`, and `-forcelogflush` — this was **reverted in PR #26** because it caused worse rubberbanding (`NetServerMaxTickRate=120` at 30fps creates tick debt), client load timeouts (`MaxClientRate=0` floods initial replication → error 324), and I/O stalls (`-forcelogflush` blocks the game thread). The working baseline uses only socket buffers (`ServerDesiredSocketReceiveBufferBytes=16777216`, `ServerDesiredSocketSendBufferBytes=4194304`) and `ConnectionTimeout=604800.0` with UE5 default tick/bandwidth values. Monitor for `NumOutRec` overflow; if it recurs, test targeted `IgwNetDriver:MaxClientRate=0` only (not `IpNetDriver`).
- **Rubberbanding returned after a game-server update, silently, with no config regression:** `dune start`/`dune restart` were supposed to re-apply CPU core pinning after every container recreate (needed because UE5's game tick is single-threaded and stalls for seconds if maps share cores under scheduler contention), but `scripts/cpu-pin.sh` had been committed without its executable bit (`644` instead of `755`), so the wrapper's own `[[ -x scripts/cpu-pin.sh ]]` guard silently evaluated false and skipped pinning entirely — no warning, no error, just quietly unpinned containers after the next recreate. `scripts/dune-nic-irq-pin.sh` and `scripts/generate-cpupin.sh` had the same `644` mode and are now `755` too. Separately, `dune start` now prefers restarting a host-installed `dune-cpu-pin.service` (e.g. one hand-tuned per-host, or created via `cpu-pin.sh --install`) over running the generic script directly, since `scripts/cpu-pin.sh`'s topology auto-detection can produce a materially different (and on hybrid/many-core hosts, worse — e.g. sharing one large P-core pool between `survival_1` and `deep_desert_1` instead of giving each dedicated cores) layout than a proven hand-tuned assignment. See `docs/TROUBLESHOOTING.md` → "In-Game Rubberbanding - Host Networking Overlay"
- In-game rubberbanding caused by Docker bridge networking jitter: new `docker-compose.hostnet.yml` overlay moves `survival_1` to `network_mode: host`, bypassing the Docker bridge/iptables/veth stack entirely. Game UDP packets go directly from the NIC to the server process socket. Confirmed by A/B test: bridge mode = rubberband, host mode = smooth. Enable via `DUNE_HOSTNET_OVERLAY=docker-compose.hostnet.yml` in `.env` (requires `HOST_LAN_IP`); the `dune` CLI then appends the overlay automatically. See `docs/TROUBLESHOOTING.md` -> "In-Game Rubberbanding - Host Networking Overlay"
- In-game rubberbanding on multi-map hosts from CPU core contention: new `scripts/cpu-pin.sh` partitions physical cores so the main world's UE5 game thread always has a free execution context (measured reduction from 15% scheduling delay to 1.3%). Includes NIC IRQ affinity pinning to keep hardware interrupts off the dedicated game-server cores. Run `sudo ./scripts/cpu-pin.sh --install` to persist via a systemd timer
- Docker `userland-proxy` should be set to `false` in `/etc/docker/daemon.json` for game-server hosts: the default spawns a Go userland proxy process per published port (36 on a standard-profile host), routing all game UDP through userspace instead of kernel iptables DNAT. Disabling it eliminates those processes and lets game packets traverse a pure kernel path. Added to `docs/TROUBLESHOOTING.md`
- UDP socket receive-buffer overflow causing silent packet loss: UE5's default `ServerDesiredSocketReceiveBufferBytes` (256 KB) overflows under S2S mesh traffic bursts from peer servers. All game servers now set `ServerDesiredSocketReceiveBufferBytes=16777216` (16 MB) and `ServerDesiredSocketSendBufferBytes=4194304` (4 MB) for both the game `IpNetDriver` and S2S `IgwNetDriver`, applied across the `basic` and `standard` profiles
- Dashboard game-server restart on settings changes now targets all active game servers instead of only `survival_1` and `overmap`, so identity and password changes apply to the full standard/full fleet
- Dashboard Discord webhook enable/disable toggle now persists correctly (the backend `DiscordWebhookUpdate` model was missing the `enabled` and `name` fields; the save button no longer sends the masked webhook URL back to the server)
- Dashboard admin management endpoints now return proper HTTP 400/404/409 on validation errors instead of HTTP 200 with an error JSON body
- Idle game-server crash loop on multi-map profiles: with no players connected, the inter-server (S2S / Inter Game World) mesh links between map servers carried no traffic and were dropped after Funcom's `IgwNetDriver` `ConnectionTimeout` (shipped default 600 seconds). A dropped S2S link made `AS2sController` mark the peer dead and reset the world partition, which tripped a Funcom world-partition quad-tree segfault (`DuneWorldPartitioner.cpp` "Failed to find local server in quad tree") that cascaded to every map server; Docker then auto-restarted them, repeating on roughly a 10-minute cadence (the blast radius scales with the number of maps, so `standard` and `full` were hit far more often than a one or two map deployment). Every game server is now launched with `-ini:engine:[/Script/InfiniteGameWorlds.IgwNetDriver]:ConnectionTimeout=604800.0`, so idle S2S links are no longer dropped during normal operation; applied across the `basic`, `standard`, and `full` profiles. Only the inter-server driver is affected; the game-client driver (`[/Script/OnlineSubsystemUtils.IpNetDriver]`, 60 seconds) is left unchanged so player connections still time out normally. See `docs/TROUBLESHOOTING.md` -> "Idle Multi-Map Crash-Loop (S2S ConnectionTimeout)"
- Players could not join Deep Desert or Arrakeen on the standard profile and were stuck in the join queue. Deep Desert had `MinServers=0`, so the director never guaranteed a shard for the always-running container, and the social hubs and story shards were missing from `[InstancingModes]` entirely. `config/director.ini` now declares `SH_Arrakeen`, `SH_HarkoVillage`, and the four story maps as `SingleServer`, gives each a player cap, and sets Deep Desert `MinServers=1`
- Overworld travel (`Error: P83`) at the source: the overworld (`overmap`) container was loading the Hagga Basin level (`Survival_1`) instead of the Overland level, so the Overland partition never hosted real overworld content and travel could not resolve a destination (this also drove an `overmap` crash loop). Two compounding compose-argument bugs caused it. First, `-MultiHome=$POD_IP` used a single `$`, which `docker compose` interpolated to an empty string before the entrypoint could substitute the per-container IP, and the empty `-MultiHome=` then swallowed the adjacent positional map path. Second, even once `-MultiHome` was fixed, the map was a positional argument placed after the options, which Unreal ignores (it reads the startup map only from the first positional argument), so the server fell back to the shipped `ServerDefaultMap` (`Survival_1`). Fixed by escaping the variable as `-MultiHome=$$POD_IP` and replacing the positional map with an explicit `ServerDefaultMap` override (`-ini:engine:[/Script/EngineSettings.GameMapsSettings]:ServerDefaultMap=<map>`), applied to every non-survival map server across the `basic`, `standard`, and `full` profiles. The overworld server now loads `/Game/Dune/Systems/Overmap/Overmap`, reports `farm_state.map='Overmap'`, and is discoverable on its canonical partition. See `docs/TROUBLESHOOTING.md` -> "P83 on overworld travel - overworld server loaded the wrong level"
- The Settings "Server name" field was a no-op: it saved only to the dashboard database and never wrote `.env` or recreated the game servers, so renaming the server in the dashboard did not change the name players saw in the in-game server browser. The new Server Identity control writes `.env` and recreates the game-server containers, and the redundant name field was removed from the General panel
- Three shipped `UserGame.ini` keys (`m_OvermapReturnGracePeriodSeconds`, `m_InstancedMapReconnectGracePeriodSeconds`, `m_bBuildingRestrictionLimitsEnabled`) now have field definitions, so they render with a description and a typed input in the dashboard config editor instead of as bare auto-typed values
- Allowlist Steam IDs and player names are now length-checked (max 32 and 255 characters) so over-long input returns a clean 422 instead of a database error, and concurrent duplicate adds to the allowlist or ban list now return 409 instead of an unhandled 500
- The allowlist tab description no longer claims a `UseAllowList` server toggle enforces dashboard entries (`UseAllowList` is a sandworm-system config enum, unrelated to player access); it now accurately describes the allowlist as a dashboard-maintained roster
- The Next.js dashboard build no longer emits the workspace-root inference and `metadataBase` warnings (pinned `outputFileTracingRoot` and set `metadataBase`)
- Overworld travel (`Error: P83` / `UpdateTravelDestination(... unable to find destination)`): `scripts/partition_repair.py` now patches `get_active_servers_for_gateway()` to report each server's true per-partition map (`world_partition.map`) instead of the farm-level `farm_state.map`. Every server writes `farm_state.map='Survival_1'`, so the overworld server was being advertised to gateway destination discovery as `Survival_1` rather than `Overmap`, leaving no server registered for the overworld map. Returning `wp.map` makes the overworld server discoverable on its canonical partition without adding a partition row or renaming the stored map (the director keeps matching its `Overmap` PerMapConfig). See `docs/TROUBLESHOOTING.md` -> "P83 on overworld travel"
- The `dune` CLI and all entry-point scripts are now tracked as executable (mode `755`). Previously they were committed as `644`, so a fresh clone failed with "Permission denied" on `./dune` and on every `dune` subcommand that `exec`s a script (`backup`, `deploy`, `doctor`, `update`, …)
- `fix-perms.sh` (`dune fix-perms`) now also normalizes the bind-mounted `.env`, granting the dashboard-api container group (uid 999) read/write while preserving the host owner (mode 660). Without this, a tightly-permissioned `.env` (for example mode 600 left by a secure copy during a host migration) made `/api/status` fail with a `PermissionError` reading `WORLD_NAME` and blocked the Server Identity and password controls from writing
- `dune backup` and `dune restore` no longer fail with `FATAL: role "postgres" does not exist` on a default install: they now connect to PostgreSQL as the `dune` role and pass `POSTGRES_DUNE_PASSWORD` (the credentials the stack actually provisions) instead of an unset `POSTGRES_USER` that fell back to a nonexistent `postgres` superuser. Both commands and the `dune doctor` Postgres readiness check now also honor `POSTGRES_DB_NAME` when resolving the target database
- `smoke-test.sh` error scan no longer raises a false warning from benign INFO log lines (e.g. pika's `error=None` / clean AMQP `Normal shutdown`); it now matches log-level `ERROR`/`CRITICAL`/`FATAL`, `Traceback`, and unhandled-exception markers
- `preflight` no longer crashes with a `JSONDecodeError` traceback on newer Docker Compose: `compose_running_ports()` now parses both newline-delimited JSON (newer `docker compose ps --format json`) and the legacy JSON array. This also stops preflight from misreporting the stack's own ports as foreign conflicts.
- `dune dashboard` and the `dune init` summary now print the correct dashboard URL (derived from `DUNE_ADMIN_BIND_ADDRESS`/`DUNE_ADMIN_HOST_PORT`, default `http://127.0.0.1:18080`) instead of the stale `http://localhost:3000`
- `dune dashboard` no longer aborts on headless hosts: it always prints the URL and only attempts to open a browser when a launcher (`xdg-open`/`open`) is present
- `preflight` now flags a `change-me` Funcom token (`FLS_SECRET`) as missing instead of letting the placeholder pass
- Watchdog RMQ ghost-cleanup default aligned to disabled (`False`) in code, matching the documented compose default (avoids breaking S2S peer-index convergence when the backend runs outside compose)
- `dune fix-p83` (alias `rmq-ghost-cleanup`) now reaps orphaned `<HEXID>_queue` queues that linger with 0 consumers after a player's connection drops, in addition to closing duplicate "ghost" connections. These queues keep accumulating presence/chat messages and can eventually trip the RMQ memory watermark (a broker-wide P83 cause); the reaper deletes one only when its owner has no running player connection, using `delete_queue --if-unused`, and the game re-declares it on the player's next login
- README clone URLs corrected to `arrakis-command-nexus.git`; contributor branch base corrected from `master` to `main`
- The Announcements placeholder rendered a literal `\u2026` escape sequence instead of an ellipsis; replaced with the literal `…` character
- **Operator `.env` settings were silently ignored by the dashboard API:** `main.py` called `load_dotenv()` with no argument, so python-dotenv searched upward from the container's working directory (`/app`) and never found the `.env` the compose file mounts at `/workspace/.env`. Any key not also re-declared in the `dashboard-api` `environment:` block was invisible to `os.getenv`. The load also ran *after* the local imports, so modules that read configuration at import time were affected even when compose did forward the value - `services/watchdog_service.py` defines all of its `WATCHDOG_*` thresholds at module scope, and compose forwards none of them. The mounted file is now loaded explicitly, before the local imports; values already present in the environment still win, so compose keeps precedence. Verified in production: `BACKUP_RETENTION_DAYS`, `BACKUP_SCHEDULE_ENABLED` and `DUNE_CHAT_GUARD_ENABLED` are absent from the container environment yet now resolve from `.env` (chat guard in particular was configured on and was being ignored)
- **`deploy.sh` reported success after a failed deploy:** the three `docker compose` invocations sent both stdout and stderr to `/dev/null` and were followed by an unconditional success line, so a failed bring-up printed a green check and the script carried on. Compose output is now captured, the real exit status is checked, failures print the captured log, and required steps abort. The Postgres readiness probe also queried as `postgres` rather than the `dune` role the stack actually provisions, consulted only the base compose file instead of every active overlay, and printed "continuing anyway" on timeout instead of failing
- **Fresh installs failed to pull `igw-postgres`:** `docker-compose.yml` and `docker-compose.basic.yml` referenced the bare `igw-postgres:17.4-alpine-fc-13`, but `scripts/load-images.sh` mirrors loaded tarballs into the shorter `funcom/self-hosting/` namespace, so setup tried to pull an image that does not exist publicly. Both now use `funcom/self-hosting/igw-postgres:17.4-alpine-fc-13`, matching every other Funcom image. Thanks to @TheFoolsErrand for reporting it and pinning down the cause ([#46](https://github.com/Manaiakalani/arrakis-command-nexus/issues/46))
- **A game-server rollback could trigger an automatic update:** the update checker reported an update whenever Steam's build id merely *differed* from the recorded baseline, so a depot rollback or a stale read looked identical to a new build. It now compares build ids numerically and declines to guess when either value is non-numeric
- **The auto-update toggle did not survive a restart:** enabling it only mutated the process environment, so it silently reverted to the configured default on the next `dashboard-api` start. It is now persisted with the rest of the update state, and the API returns 503 if that write fails instead of reporting a success it did not achieve
- **Restart warnings could be skipped after a schedule change:** `_send_due_warnings` released the lock before broadcasting, then unconditionally recorded the warning as sent. If the schedule changed while an announcement was in flight, the newly scheduled restart inherited warnings it had never actually sent and silently skipped them. The scheduled time is now captured under the lock and re-validated before the warning is recorded, and the audit entry logs the captured schedule rather than re-reading a value that may have moved
- **Discord webhook creation discarded the operator's input:** the name and enabled flag were dropped on the way through the API, so every webhook was stored as an enabled feed called "Operations Feed" regardless of what was entered
- **Unbounded Discord delivery queue:** a wedged or rate-limited webhook endpoint could grow the outbound queue without limit. It is now capped at 1000 jobs, with drops counted and logged rather than failing silently
- **Dashboard resource limits could read back stale:** `routers/system.py` wrote them through `write_env_var()` (which resolves `DUNE_ENV_FILE`) but read them back from `DUNE_PROJECT_ROOT/.env`. The defaults coincide so it went unnoticed, but any custom `DUNE_ENV_FILE` split reads from writes. Both now derive from `services/env_file.py`
- **`dune start` could stall on CPU pinning:** the `dune-cpu-pin` unit pins cores for containers that are still coming up, so a synchronous `systemctl restart` could sit waiting on them. Pinning is best-effort at that point, so the restart is now issued with `--no-block`
- **Frontend lint was broken and unrunnable:** an ESLint 8 to 10 bump left the repository on a legacy `.eslintrc.json`, which ESLint 9+ ignores in favour of flat config, so `npm run lint` failed outright. Replaced with `eslint.config.mjs`, and `eslint`/`eslint-config-next` are realigned to the pinned Next.js version. Frontend lint is not part of CI, which is why this was not caught automatically
- Recovered nine fixes that had been applied directly to a production host and never pushed, including RabbitMQ auth-shim hardening, centralized `.env` write locking, `docker-socket-proxy` NETWORKS/VOLUMES permissions, an IPv6 workaround for SteamCMD CDN timeouts, and a stale-closure fix in the Discord webhook editor. The player tracker also no longer grows its name cache without bound and now backs off exponentially on repeated failures instead of retrying at a fixed interval

### Security

- Resolved all 13 outstanding Dependabot alerts in the dashboard frontend: `next` to 15.5.21 (SSRF in rewrites and Server Actions, App Router and Image Optimization denial of service, Server Function endpoint disclosure, two cache-confusion advisories, and an unbounded Edge Server Action payload), `postcss` to 8.5.18 (path traversal via `sourceMappingURL`), `sharp` to 0.35.3 (four libvips CVEs), `js-yaml` to 4.3.0 (quadratic CPU via merge-key chains), and `brace-expansion` past both prototype-pollution advisories. `npm audit` now reports no vulnerabilities
- Documented three known gaps rather than leaving them implicit: the dashboard authenticates no client and relies entirely on the network boundary ([#52](https://github.com/Manaiakalani/arrakis-command-nexus/issues/52)), the RBAC, MFA, session-timeout and IP-allowlist settings are stored but never enforced ([#53](https://github.com/Manaiakalani/arrakis-command-nexus/issues/53)), and `NEXT_PUBLIC_API_BASE_URL` silently bypasses server-side token injection ([#55](https://github.com/Manaiakalani/arrakis-command-nexus/issues/55))
- `SECURITY.md` credential-rotation steps no longer reference a nonexistent `rabbitmq` service (the stack runs `admin-rmq` and `game-rmq`), a nonexistent `dune_admin` database role, or the wrong variable names for the Discord webhook and Funcom token

## [1.5.0] - 2026-05-25

### Added
- **Item catalog** expanded to 188 templates with human-readable display names (e.g., `GreatHouseComponent2` shows as "Mechanical Parts")
- **Stack size warnings** on item grants when requested quantity exceeds the game's observed max
- **Startup guard** that fails fast with a clear error if `DUNE_ADMIN_TOKEN` is still a placeholder
- Visible template ID subtitles in the item catalog (no hover required)
- Search now matches on display names, not just template IDs
- `DUNE_DASHBOARD_DB_URL` documented in `.env.example`

### Changed
- `DUNE_ADMIN_READ_AUTH` now defaults to `true` (all GET endpoints require auth)
- `MEM_LIMIT_OVERMAP` default increased from 2g to 8g
- Grant logging now includes inventory ID and position index for debugging
- Player connection tracker uses backoff on repeated failures

### Fixed
- `mktemp -u` race condition in `survival-pre-start.sh` (now uses `mktemp -d`)
- Swallowed database errors in `postgres_service.get_player_progress()` now logged
- Economy service stub methods no longer wrap no-ops in misleading try/except
- `farm_state` cleanup shows informative message instead of silent `|| true`
- CONFIGURATION.md defaults synced with `.env.example` (STEAM_APP_ID, IMAGE_TAG, MEM_LIMIT_OVERMAP)
- README clone URLs and Steam App ID corrected
- `setup.sh` defaults synced (IMAGE_TAG, MEM_LIMIT_OVERMAP)
- System settings UI shows correct 8g default for Overmap memory

### Security
- Read endpoints now require authentication by default
- Placeholder token detection prevents insecure deployments
- FIFO creation hardened against symlink races

## [1.4.0] - 2026-05-25

### Added
- **Server power management** with Stop, Start, and Restart buttons on the System page for bulk game server control
- **Post-deploy smoke test** (`scripts/smoke-test.sh`) with 42 checks across 7 categories (containers, API, routes, volumes, config, database, logs)
- `make smoke` target for quick regression testing after deploys
- `deps` option to `useApi` hook for automatic re-fetching when dependencies change

### Changed
- System telemetry charts now respond immediately to time range switching (15m, 1h, 6h, 24h, 7d, 30d)
- Uptime chart also re-fetches on range change
- Dashboard SQLite database persisted via bind mount (`./dashboard-data/`) to survive container rebuilds

### Fixed
- Overview page crash when PostgreSQL is temporarily unreachable (DNS resolution failure in `asyncio.gather`)
- Dashboard SQLite database wiped on every container rebuild (no persistent volume)
- CSS build failure from invalid Tailwind arbitrary opacity value (`bg-th-surface/78` to `bg-th-surface/[0.78]`)
- Discord webhook data lost on redeploy (same root cause as DB persistence)
- `.env` parsing failure in smoke test when values contain unquoted spaces (e.g., `WORLD_REGION=North America`)

## [1.3.0] - 2026-05-25

### Added
- **Audit trail** page with filterable log of all admin actions, player logins/logouts, config changes, and grants
- **Scheduled announcements** for recurring or one-time in-game messages with interval or specific time
- **Scheduled server restarts** with automatic pre-restart warnings and backup-before-restart
- **Game tweak settings** for sandworm behavior, NPC difficulty, mining rates, loot drops, day/night cycle, crafting costs, hydration, and vehicle durability
- **Toast notifications** across all dashboard pages for real-time user feedback
- **Container-compatible backup/restore scripts** using pg_dump/psql directly (no Docker-in-Docker needed)
- **Design system document** (`docs/DESIGN.md`) with complete token, component, and pattern reference
- **Excalidraw architecture diagrams** for system and dashboard feature mapping
- Sidebar grouped into 6 logical sections (Core, Players, Server, Operations, Communication, Admin)
- Player login/logout events tracked in audit log and connection history
- Item grant stats fix: `FItemStackAndDurabilityStats` now included so granted items appear in-game

### Changed
- Light mode theme warmed up with sandy/amber tones matching the Dune aesthetic
- Sidebar reorganized from 17 flat items into grouped sections with headers
- UserGame.ini and UserEngine.ini file descriptions updated to reflect game tweak capabilities
- API Dockerfile now includes PostgreSQL 17 client for backup compatibility
- README updated with new feature descriptions and documentation links

### Fixed
- Backup creation 404 error (`/app/scripts/backup.sh` not found in API container)
- Backup script POSIX sh compatibility (was using bash-only syntax in dash container)
- pg_dump version mismatch (container had v15, server runs v17)
- Backup directory permissions (owned by root, now writable by app user)
- Granted items not appearing in-game (missing `FItemStackAndDurabilityStats` in stats JSON)
- Unicode ellipsis characters (`...`) replaced with ASCII equivalents across frontend
- Audit page CSS classes fixed from `sand-*` to proper `th-*` theme tokens

## [1.2.0] - 2026-05-24

### Changed
- Upgraded Next.js from 14.2.x to 15.5.18, resolving 13 security advisories (DoS, SSRF, cache poisoning, XSS)
- Upgraded React and React DOM from 18.x to 19.x (required by Next.js 15)
- Upgraded PostCSS to 8.5.x with npm override to patch transitive XSS vulnerability (CVE-2026-41305)
- Upgraded python-dotenv from 1.1.0 to 1.2.2 to fix symlink overwrite vulnerability (CVE-2026-28684)
- Upgraded eslint-config-next to 15.5.18 for compatibility
- Pinned `DUNE_IMAGE_TAG` in `.env.example` to specific version instead of `latest`

### Added
- `.github/CODEOWNERS` file assigning repository ownership
- Graceful shutdown (`stop_grace_period: 30s`) for dashboard-api and dashboard-frontend
- Playwright e2e-check job in CI pipeline

### Security
- All 17 Dependabot alerts resolved (0 remaining)
- PostCSS override ensures no vulnerable transitive copies in the dependency tree
- `CODEOWNERS` enforces review requirements for all code changes

## [1.1.0] - 2026-05-24

### Added
- OOM (Out of Memory) crash detection in watchdog with remediation advice in Discord alerts
- Host tuning script (`scripts/host-tuning.sh`) for VM memory and kernel parameter optimization
- Snapshot collection script (`scripts/collect-snapshot.sh`) for diagnostics
- Playwright end-to-end test suite (46 tests covering all dashboard pages)
- Security response headers middleware (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- Secret rotation runbook, incident response playbook, and log retention policy in SECURITY.md

### Changed
- Upgraded admin token startup check from warning to critical log level; distinguishes dev vs production mode
- Pinned all GitHub Actions to commit SHAs for supply-chain security
- Frontend `depends_on` now uses `service_healthy` instead of `service_started` for reliable boot ordering
- Discord webhook URLs are masked in API responses (shows only last 6 characters)
- Container healthchecks use `kill -0 1` (detects zombies) instead of `/proc/1/status` file check
- Generic error messages on 500 responses; full details logged server-side only

### Removed
- `EXEC` permission from Docker socket proxy (attack surface reduction)

### Security
- Security response headers on all HTTP responses
- Default admin token blocked with critical warning in production mode
- Docker socket proxy EXEC access removed
- CI actions pinned to commit SHAs to prevent tag-swap supply-chain attacks
- Webhook URL masking prevents credential exposure via API
- Exception details no longer leak to HTTP clients

## [1.0.0] - 2026-05-24

### Added
- Docker Compose deployment for the complete Dune Awakening self-hosted stack
- Profile-based battlegroups (basic, standard, full) with scaling guidance
- `dune` CLI for setup, startup, shutdown, updates, backups, and diagnostics
- Arrakis Command Nexus companion dashboard (FastAPI + Next.js)
- Real-time system telemetry (CPU, memory, disk, network) with 15-second intervals
- Map orchestration with start, stop, restart, and backup per shard
- Player tracking with online roster, session timers, kick controls, and connection history
- Live log streaming with search, filtering, and download
- Hagga Basin player position map with heatmap overlay
- Configuration editor with drift detection
- Backup and restore workflows with scheduled retention
- Discord webhook notifications for server events
- Public status page for shareable read-only health view
- Light and dark mode across the entire dashboard UI
- In-game chat announcements via RabbitMQ
- Chat spam protection with configurable thresholds
- Economy anomaly monitoring with alert system
- Character inspection tools
- Automatic crash recovery with health checks and watchdog
- Partition repair sidecar for database consistency
- WSL2 support documentation for Windows hosts
- Token-based admin authentication with secret file support
- Prometheus-compatible metrics endpoint for monitoring integration
- Rate-limited public status endpoint
- GitHub Actions CI for build validation
- Comprehensive documentation suite (quickstart, configuration, networking, profiles, troubleshooting)
- VM image builder with VHD/VHDX/VMDK/QCOW2 output for Hyper-V, VirtualBox, and Proxmox

### Security
- Admin token authentication on all API endpoints
- CORS hardening with explicit origin allowlisting
- Log redaction for sensitive credentials
- Container name allowlisting for Docker operations
- Path traversal protection on config and backup endpoints
- SQL injection prevention in helper scripts
- Symlink blocking in file operations
- Docker socket proxy (tecnativa/docker-socket-proxy) replacing direct socket mount
- Internal backend network isolating dashboard API from public traffic
- Non-root container execution with no-new-privileges policy
- Pinned Docker base images for reproducible builds
- Request audit logging with client IP tracking
- CI security scanning (pip-audit, npm audit)
- SECURITY.md with responsible disclosure and hardening checklist
