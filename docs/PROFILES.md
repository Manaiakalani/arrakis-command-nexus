# Deployment Profiles

The stack is split into profile overlays so you can run a smaller battlegroup for personal use or scale up for a community server.

## Basic

**Maps**

- `overmap`
- `survival_1`

**Ports**

- UDP `7777-7778`
- UDP `7888-7889`
- TCP `31982`
- TCP `31983`

**Recommended RAM:** ~20 GB

## Standard

**Maps**

- `overmap`
- `survival_1`
- `deep_desert_1`
- `arrakeen`
- `harko_village`
- `testing_hephaestus`
- `testing_carthag`
- `testing_waterfat`
- `proces_verbal`

**Ports**

- UDP `7777-7785`
- UDP `7888-7896`
- TCP `31982`
- TCP `31983`

**Recommended RAM:** ~30-40 GB

## Full

**Maps**

- Everything in Standard
- additional `survival_2` through `survival_17`
- additional `deep_desert_2` through `deep_desert_5`
- second instances of social/story shards such as `arrakeen_2`, `harko_village_2`, and extra testing maps

**Ports**

- UDP `7777-7810`
- UDP `7888-7921`
- TCP `31982`
- TCP `31983`

**Recommended RAM:** ~40 GB+

## Switching Profiles

1. Edit `.env`
2. Change `DEPLOYMENT_PROFILE=basic|standard-lean|standard|full`
3. Re-run `./dune preflight`
4. Restart the stack with `./dune restart`

If you are moving to a larger profile, update port forwarding and firewall rules first.

## Creating a Custom Profile

1. Copy the closest overlay, for example `docker-compose.standard.yml`
2. Rename it to something like `docker-compose.community.yml`
3. Add or remove map services and adjust memory limits
4. Ensure every added shard gets unique `DUNE_GAME_PORT`, `DUNE_S2S_PORT`, and `DUNE_PARTITION_INDEX` values
5. Update your start workflow to include the custom compose file, or adapt the CLI/scripts if you want first-class profile support

For long-term maintenance, keep custom profile changes documented alongside your `.env` and router/firewall rules.
