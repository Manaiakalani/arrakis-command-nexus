# Deep Desert Configuration Knobs

Focused reference for the Deep Desert controls that are currently known.

## Primary files

| File | Scope |
|------|-------|
| `config/director.ini` | Deep Desert shard count, instancing mode, and hard caps |
| `config/UserGame.ini` | Storm, worm, spice, and event behavior |
| `docker-compose.standard.yml` | Deep Desert shard memory budget and port wiring |

## Confirmed knobs

| Key | Location | Default | Effect |
|-----|----------|---------|--------|
| `DeepDesert_1=ClassicalInstancing` | `director.ini` `[InstancingModes]` | `ClassicalInstancing` | Scales Deep Desert instances based on demand. |
| `PlayerHardCap` | `director.ini` `[DeepDesert_1]` | `80` | Max players per Deep Desert shard. |
| `MinServers` | `director.ini` `[DeepDesert_1]` | `0` | Minimum always-running Deep Desert shards. |
| `NumExtraServers` | `director.ini` `[DeepDesert_1]` | `0` | Extra prewarmed Deep Desert shards. |
| `m_bAutoSpawnEnabled` | `/Script/DuneSandbox.SandStormConfig` | `true` | Enables automatic standard sandstorms. |
| `m_bCoriolisAutoSpawnEnabled` | `/Script/DuneSandbox.SandStormConfig` | `true` | Enables automatic Coriolis events. |
| `m_CoriolisSpawnWarningsDurationInHours` | `/Script/DuneSandbox.SandStormConfig` | `6` | Warning lead time before Coriolis starts. |
| `m_CoriolisStage1DurationInSeconds` | `/Script/DuneSandbox.SandStormConfig` | `32400.0` | Length of Coriolis stage 1. |
| `m_CoriolisStage2DurationInSeconds` | `/Script/DuneSandbox.SandStormConfig` | `3540.0` | Length of Coriolis stage 2. |
| `m_CoriolisStage3DurationSeconds` | `/Script/DuneSandbox.SandStormConfig` | `60.0` | Length of Coriolis stage 3. |
| `m_CoriolisStage4DurationSeconds` | `/Script/DuneSandbox.SandStormConfig` | `60.0` | Length of Coriolis stage 4. |
| `m_CoriolisStage5DurationSeconds` | `/Script/DuneSandbox.SandStormConfig` | `1740.0` | Length of Coriolis stage 5. |
| `m_CoriolisSandstormSpawnPreventionSeconds` | `/Script/DuneSandbox.SandStormConfig` | `600.0` | Blocks regular sandstorms around Coriolis windows. |
| `m_bCoriolisDoesDamage` | `/Script/DuneSandbox.SandStormConfig` | `false` | Lets Coriolis directly damage entities. |
| `m_CoriolisLightDamage` | `/Script/DuneSandbox.SandStormConfig` | `5.0` | Light Coriolis damage amount. |
| `m_CoriolisHeavyDamage` | `/Script/DuneSandbox.SandStormConfig` | `5000.0` | Heavy Coriolis damage amount. |
| `m_GiantWormSpawningCooldown` | `/Script/DuneSandbox.SandwormSettings` | `7200.0` | Cooldown between giant worm events. |
| `m_GiantWormMinimumSpiceAmountHarvested` | `/Script/DuneSandbox.SandwormSettings` | `50000.0` | Spice threshold needed to trigger giant worm logic. |
| `m_GiantWormMinimumPlayersOnSpiceField` | `/Script/DuneSandbox.SandwormSettings` | `4` | Minimum players on a spice field before a giant worm can trigger. |
| `m_GiantWormMinimumDistanceFromIgwBoundary` | `/Script/DuneSandbox.SandwormSettings` | `2000.0` | Keeps giant worm events away from the shard edge. |
| `m_bSpawningActive` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `true` | Enables spice bloom generation in Deep Desert. |
| `m_PrimeRateInSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `30.0` | Prime cadence for spice field creation. |

## Practical tuning notes

- Increase `MinServers` or `NumExtraServers` if Deep Desert login and travel queues are the main problem.
- Increase `PlayerHardCap` only with enough RAM and port space.
- Disable `m_bCoriolisAutoSpawnEnabled` or extend Coriolis stage timers to make Deep Desert less punishing.
- Giant worm pressure is mostly controlled by cooldown and spice-field thresholds.
- Deep Desert spice-field limits of `Small=60`, `Medium=12`, and `Large=1` are sometimes cited, but these limits are not yet exposed in this repository's checked-in INI files.

## Not yet confirmed in this repo

- A direct `deepDesertEventInterval` or `DeepDesertResourceRespawnTime` style key
- A dedicated Deep Desert loot scalar outside general loot and harvesting controls
- Per-event schedule tables stored in `director.ini`
