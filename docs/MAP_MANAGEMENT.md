# Map Server Management

## Available Maps (standard-lean profile)

| Map | Container | Port | RAM Usage | Description |
|-----|-----------|------|-----------|-------------|
| **Survival (Hagga Basin)** | `dune-awakening-survival_1-1` | UDP 7777 | ~11 GB | Main open world — **always required** |
| **Overmap (Sietch Tabr)** | `dune-awakening-overmap-1` | UDP 7778 | ~1 GB | Social hub — **always required** |
| **Deep Desert** | `dune-awakening-deep_desert_1-1` | UDP 7779 | ~10 GB | PvP deep desert — **optional, heavy RAM** |
| **Arrakeen** | `dune-awakening-arrakeen-1` | UDP 7780 | ~1 GB | City hub — optional |
| **Harko Village** | `dune-awakening-harko_village-1` | UDP 7781 | ~1 GB | Village hub — optional |

## Quick Commands

### Stop a map server
```bash
docker stop dune-awakening-deep_desert_1-1
```

### Start a stopped map server
```bash
docker start dune-awakening-deep_desert_1-1
```

### Check which maps are running
```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "survival|overmap|deep|arrak|harko"
```

### Check memory usage per map
```bash
docker stats --no-stream --format "{{.Name}}: {{.MemUsage}}" $(docker ps --format "{{.Names}}" | grep -E "survival|overmap|deep|arrak|harko")
```

## RAM Guidelines (30 GB host)

| Configuration | Maps | ~RAM Used | ~RAM Free | Stability |
|---------------|------|-----------|-----------|-----------|
| All 5 maps | survival + overmap + deep_desert + arrakeen + harko | ~25 GB | ~5 GB | ⚠️ Tight — pak file hitching likely |
| 4 maps (no deep desert) | survival + overmap + arrakeen + harko | ~14 GB | ~16 GB | ✅ Good |
| 3 maps (minimal hubs) | survival + overmap + arrakeen | ~13 GB | ~17 GB | ✅ Excellent |
| Basic (2 maps) | survival + overmap | ~12 GB | ~18 GB | ✅ Excellent |

> **Important:** Keep at least 10 GB free for the OS page cache. The game
> binary loads assets from pak files — if these get evicted from cache,
> the server stalls for 5–28 seconds ("searching the disk instead of
> finding the file in the pak file").

## Networking Notes

All game servers **must** use the same networking mode. The current
deployment uses Docker **bridge networking** (default). Do NOT mix
`network_mode: host` with bridge — the S2S mesh cannot route between
them, causing constant World Partition resets and rubberbanding.

## ⚠️ Caveats

- **Never stop survival_1 or overmap** — they are required for the battlegroup.
- Stopping a map server is safe (players on that map get disconnected).
  Restarting it brings the map back online without affecting other maps.
- Deep Desert is the heaviest map (~10 GB). On a 30 GB host, running it
  leaves insufficient page cache and causes hitching. Only enable it if
  you have 40+ GB RAM.
