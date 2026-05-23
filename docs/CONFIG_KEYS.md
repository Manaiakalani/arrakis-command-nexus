# Dune Awakening Server Configuration Keys

Complete reference for known configuration keys used by the Dune Awakening dedicated server.

This index combines keys confirmed in this repository, keys surfaced by `ServerGameplaySettings` style control-plane payloads, and common UE5 dedicated server keys observed in community extracts. Defaults are upstream or compose defaults when known.

## Quick Reference

| File | Purpose |
|------|---------|
| `UserGame.ini` | Gameplay settings for combat, survival, harvesting, persistence, storms, and per-map behavior |
| `UserEngine.ini` | Engine settings for networking, console variables, and Funcom Live Services |
| `director.ini` | Battlegroup director settings for instancing, shard caps, and Deep Desert scaling |
| `gateway.ini` | Gateway registration settings for FLS, display name, and RMQ endpoints |

## UserGame.ini

### Core Settings

| Key | Section | INI key | Type | Default | Description |
|-----|---------|---------|------|---------|-------------|
| `forcePvpOnAllPartitions` | `/Script/DuneSandbox.PvpPveSettings` | `m_bShouldForceEnablePvpOnAllPartitions` | boolean | `false` | Force PvP on every partition. |
| `securityZonesEnabled` | `/Script/DuneSandbox.SecurityZonesSubsystem` | `m_bAreSecurityZonesEnabled` | boolean | `true` | Enable safe zones and related restrictions. |
| `securityZonesForceEnablePvp` | `/Script/DuneSandbox.SecurityZonesSubsystem` | `m_bSecurityZonesForceEnablePvp` | boolean | `false` | Force PvP inside security-zone managed areas. |
| `reconnectGracePeriodSeconds` | `/Script/DuneSandbox.PlayerOnlineStateSettings` | `m_DefaultReconnectGracePeriodSeconds` | integer | `300` | Grace window for reconnecting after disconnect. |
| `overmapReturnGracePeriodSeconds` | `/Script/DuneSandbox.PlayerOnlineStateSettings` | `m_OvermapReturnGracePeriodSeconds` | integer | `90` | Return window before an instanced player is sent back to Overmap. |
| `instancedMapReconnectGracePeriodSeconds` | `/Script/DuneSandbox.PlayerOnlineStateSettings` | `m_InstancedMapReconnectGracePeriodSeconds` | integer | `300` | Reconnect grace window used on instanced maps. |
| `Port` | `/Script/Seabass.SBGameState` or `URL` | `Port` | integer | `7777` | Base gameplay UDP port. |
| `IGWPort` | `/Script/Seabass.SBGameState` or `URL` | `IGWPort` | integer | `7888` | Base inter-server UDP port. |

### Survival Settings

| Key | Section | INI key | Type | Default | Description |
|-----|---------|---------|------|---------|-------------|
| `hydrationEnabled` | `/Script/DuneSandbox.HydrationSubsystem` | `m_bHydrationEnabled` | boolean | `true` | Enable thirst and hydration gameplay. |
| `biomeTierUpdateRateSeconds` | `/Script/DuneSandbox.HydrationSubsystem` | `m_BiomeTierUpdateRateSeconds` | float | `2.5` | Hydration biome recalculation interval. |
| `sandstormEnabled` | `ConsoleVariables` | `Sandstorm.Enabled` | boolean | `true` | Enable normal sandstorm events. |
| `sandStormAutoSpawn` | `/Script/DuneSandbox.SandStormConfig` | `m_bAutoSpawnEnabled` | boolean | `true` | Let the server auto-schedule normal sandstorms. |
| `sandStormTreasureEnabled` | `ConsoleVariables` | `Sandstorm.Treasure.Enabled` | boolean | `true` | Spawn sandstorm treasure rewards. |
| `coriolisAutoSpawnEnabled` | `/Script/DuneSandbox.SandStormConfig` | `m_bCoriolisAutoSpawnEnabled` | boolean | `true` | Let Coriolis storms spawn automatically. |
| `sandwormEnabled` | `ConsoleVariables` | `sandworm.dune.Enabled` | boolean | `true` | Enable sandworm spawning. |
| `sandwormDangerZonesEnabled` | `ConsoleVariables` | `Sandworm.SandwormDangerZonesEnabled` | boolean | `true` | Show sandworm danger zones. |
| `vehicleSandwormCollisionInteraction` | `ConsoleVariables` | `Vehicle.SandwormCollisionInteraction` | boolean | `false` | Allow sandworms to collide with vehicles. |
| `vehicleSandwormInvulnerabilitySecondsOnExit` | `ConsoleVariables` | `Vehicle.SandwormInvulnerabilitySecondsOnExit` | float | `900.0` | Vehicle protection time after exit. |
| `vehicleSandwormInvulnerabilitySecondsOnServerRestart` | `ConsoleVariables` | `Vehicle.SandwormInvulnerabilitySecondsOnServerRestart` | float | `7200.0` | Vehicle protection time after restart. |
| `sandBuildUpShelteredTargetValue` | `/Script/DuneSandbox.BuildingSettings` | `m_SandBuildUpPlaceablesShelteredTargetValue` | float | `0.3` | Sand buildup target for sheltered placeables. |
| `sandBuildUpUnshelteredTargetValue` | `/Script/DuneSandbox.BuildingSettings` | `m_SandBuildUpPlaceablesUnShelteredTargetValue` | float | `0.7` | Sand buildup target for unsheltered placeables. |
| `sandBuildupMultiplier` | `/Script/DuneSandbox.BiomeSettings` | `m_SandBuildupMultiplier` | float | `1.0` | Global scalar for sand buildup. |

### Combat Settings

| Key | Section | INI key | Type | Default | Description |
|-----|---------|---------|------|---------|-------------|
| `securityZonesPvpResourceMultiplier` | `ConsoleVariables` | `SecurityZones.PvpResourceMultiplier` | float | `2.5` | Resource multiplier inside PvP-enabled zones. |
| `vehicleDurabilityDamageMultiplier` | `ConsoleVariables` | `dw.VehicleDurabilityDamageMultiplier` | float | `1.0` | Scalar for vehicle durability damage. |
| `maxReinforcementSize` | `/Script/DuneSandbox.DuneAISettings` | `m_MaxReinforcementSize` | float | `150.0` | Upper bound for reinforcement strength. |
| `threatDecayPerSecond` | `/Script/DuneSandbox.DuneAISettings` | `m_ThreatDecayPerSecond` | float | `0.1` | How quickly NPC threat decays. |
| `threatDecayCooldown` | `/Script/DuneSandbox.DuneAISettings` | `m_ThreatDecayCooldown` | float | `1.0` | Delay before threat decay starts. |
| `randomDBNOChance` | `/Script/DuneSandbox.DuneAISettings` | `m_RandomDBNOChance` | float | `0.1` | Chance to enter DBNO instead of dying outright. |
| `pvpRespawnFallbackMinutes` | `/Script/DuneSandbox.DuneAISettings` | `m_PVPRespawn.m_FallbackRespawnTimeMinutes` | float | `8.0` | Fallback PvP respawn timer. |
| `defaultRespawnFallbackMinutes` | `/Script/DuneSandbox.DuneAISettings` | `m_DefaultRespawn.m_FallbackRespawnTimeMinutes` | float | `8.0` | Fallback PvE respawn timer. |
| `repeatedKillCooldownSeconds` | `/Script/DuneSandbox.DunePlayerCharacter` | `s_RepeatedKillCooldown` | float | `300.0` | Same-target kill cooldown for repeated kill logic. |
| `vehicleQuicksandDamage` | `/Script/DuneSandbox.HazardsSettings` | `m_VehicleQuicksandDamage` | float | `10000.0` | Vehicle damage applied by quicksand hazards. |

### Harvesting Settings

| Key | Section | INI key | Type | Default | Description |
|-----|---------|---------|------|---------|-------------|
| `miningOutputMultiplier` | `ConsoleVariables` | `Dune.GlobalMiningOutputMultiplier` | float | `1.0` | Hand-mined resource yield multiplier. |
| `vehicleMiningOutputMultiplier` | `ConsoleVariables` | `Dune.GlobalVehicleMiningOutputMultiplier` | float | `1.0` | Vehicle mining yield multiplier. |
| `resourceLocationSystemEnabled` | `/Script/DuneSandbox.ResourceLocationSystem` | `m_bIsEnabled` | boolean | `true` | Enable the resource location system. |
| `resourceSpawnChance` | `/Script/DuneSandbox.ResourceLocationSystem` | `m_ResourceSpawnChance` | float | `1.0` | Chance for an eligible resource point to spawn. |
| `resourcePointTrace` | `/Script/DuneSandbox.ResourceLocationSystem` | `m_ResourcePointTrace` | string | `MoveUpwards` | Trace method used when placing resource points. |
| `spiceSpawningActive` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_bSpawningActive` | boolean | `true` | Enable spice bloom and spice field spawning. |
| `spicePrimeRateSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_PrimeRateInSeconds` | float | `30.0` | Prime interval for spice field generation. |
| `spiceManagerTickRateSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_ManagerTickRateInSeconds` | float | `5.0` | Tick interval for the spice manager. |
| `spiceManagerRequestRefreshRateSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_ManagerRequestRefreshRateInSeconds` | float | `90.0` | Refresh rate for local spice requests. |
| `spiceGlobalRequestRefreshRateSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_GlobalManagerRequestRefreshRateInSeconds` | float | `120.0` | Refresh rate for global spice requests. |
| `playerMustWitnessBloom` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_bPlayerMustWitnessBloom` | boolean | `false` | Require a player nearby before bloom activation. |
| `nodeValueToSpiceResourceRatio` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_NodeValueToSpiceResourceRatio` | float | `10.0` | Converts node value into spice resource amount. |
| `flourSandFieldsActivePercentage` | `/Script/DuneSandbox.FlourSandSubsystem` | `m_FlourSandFieldsActivePercentage` | float | `1.0` | Share of flour sand fields kept active. |

### Persistence Settings

| Key | Section | INI key | Type | Default | Description |
|-----|---------|---------|------|---------|-------------|
| `itemDeteriorationUpdateRateSeconds` | `/DeteriorationSystem.ItemDeteriorationConstants` | `UpdateRateInSeconds` | float | `1.0` | Interval between item deterioration ticks. |
| `maxLandclaimSegments` | `/Script/DuneSandbox.BuildingSettings` | `m_MaxNumLandclaimSegments` | integer | `6` | Max landclaim segments a player may own. |
| `buildingBlueprintMaxExtensions` | `/Script/DuneSandbox.BuildingSettings` | `m_BuildingBlueprintMaxExtensions` | integer | `4` | Max blueprint extension count. |
| `baseBackupMaxExtensions` | `/Script/DuneSandbox.BuildingSettings` | `m_BaseBackupMaxExtensions` | integer | `8` | Max base-backup extension count. |
| `buildingRestrictionLimitsEnabled` | `/Script/DuneSandbox.BuildingSettings` | `m_bBuildingRestrictionLimitsEnabled` | boolean | `true` | Enforce building restriction limits. |
| `baseBackupToolTimeRestrictionSeconds` | `/Script/DuneSandbox.BuildingSettings` | `m_BaseBackupToolTimeRestrictionInSeconds` | integer | `604800` | Cooldown before a base backup may be reused. |
| `buildRange` | `/Script/DuneSandbox.BuildingSettings` | `m_BuildRange` | float | `2000.0` | Max building interaction range. |
| `buildingHeightLimitInM` | `/Script/DuneSandbox.BuildingSettings` | `m_BuildingHeightLimitInM` | float | `980.0` | Max building height above claim origin. |
| `defaultRepairCostMultiplier` | `/Script/DuneSandbox.BuildingSettings` | `m_DefaultRepairCostMultiplier` | float | `0.5` | Global repair cost scalar. |
| `pickupDurabilityReduction` | `/Script/DuneSandbox.BuildingSettings` | `m_PickupTotalDurabilityPercentageReduction` | float | `0.05` | Durability lost when picking structures up. |

### Deep Desert Settings

| Key | Section | INI key | Type | Default | Description |
|-----|---------|---------|------|---------|-------------|
| `coriolisSpawnWarningsDurationHours` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisSpawnWarningsDurationInHours` | integer | `6` | Warning lead time before Coriolis begins. |
| `coriolisStage1DurationSeconds` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisStage1DurationInSeconds` | float | `32400.0` | Duration of Coriolis stage 1. |
| `coriolisStage2DurationSeconds` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisStage2DurationInSeconds` | float | `3540.0` | Duration of Coriolis stage 2. |
| `coriolisStage3DurationSeconds` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisStage3DurationSeconds` | float | `60.0` | Duration of Coriolis stage 3. |
| `coriolisStage4DurationSeconds` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisStage4DurationSeconds` | float | `60.0` | Duration of Coriolis stage 4. |
| `coriolisStage5DurationSeconds` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisStage5DurationSeconds` | float | `1740.0` | Duration of Coriolis stage 5. |
| `coriolisSandstormSpawnPreventionSeconds` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisSandstormSpawnPreventionSeconds` | float | `600.0` | Blocks normal sandstorms near Coriolis windows. |
| `coriolisDoesDamage` | `/Script/DuneSandbox.SandStormConfig` | `m_bCoriolisDoesDamage` | boolean | `false` | Let Coriolis directly damage entities. |
| `coriolisLightDamage` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisLightDamage` | float | `5.0` | Light damage tick during Coriolis. |
| `coriolisHeavyDamage` | `/Script/DuneSandbox.SandStormConfig` | `m_CoriolisHeavyDamage` | float | `5000.0` | Heavy damage tick during Coriolis. |
| `giantWormSpawningCooldownSeconds` | `/Script/DuneSandbox.SandwormSettings` | `m_GiantWormSpawningCooldown` | float | `7200.0` | Cooldown between giant worm spawns. |
| `giantWormMinimumSpiceAmountHarvested` | `/Script/DuneSandbox.SandwormSettings` | `m_GiantWormMinimumSpiceAmountHarvested` | float | `50000.0` | Spice harvest threshold before giant worm logic can trigger. |
| `giantWormMinimumPlayersOnSpiceField` | `/Script/DuneSandbox.SandwormSettings` | `m_GiantWormMinimumPlayersOnSpiceField` | integer | `4` | Minimum players needed on a spice field for giant worm logic. |
| `giantWormMinimumDistanceFromIgwBoundary` | `/Script/DuneSandbox.SandwormSettings` | `m_GiantWormMinimumDistanceFromIgwBoundary` | float | `2000.0` | Minimum distance from the shard edge for giant worm events. |

### Hydration and Water

| Key | Section | INI key | Type | Default | Description |
|-----|---------|---------|------|---------|-------------|
| `dewRefreshTimeHours` | `/Script/DuneSandbox.DewHarvestSettings` | `m_DewRefreshTime` | float | `12.0` | Refresh interval for standard dew harvests. |
| `dewRefreshTimeNPESeconds` | `/Script/DuneSandbox.DewHarvestSettings` | `m_DewRefreshTimeNPE` | float | `300.0` | New-player dew refresh interval. |
| `buildingShelterThreshold` | `/Script/DuneSandbox.ShelterSettings` | `m_BuildingShelterThreshold` | float | `0.9` | Shelter threshold for building protection checks. |
| `placeableShelterThreshold` | `/Script/DuneSandbox.ShelterSettings` | `m_PlaceableShelterThreshold` | float | `0.65` | Shelter threshold for placeables. |
| `vehicleShelterThreshold` | `/Script/DuneSandbox.DuneVehicle` | `m_VehicleShelterThreshold` | float | `0.75` | Shelter threshold applied to vehicles. |
| `characterShelterThreshold` | `/Script/DuneSandbox.DuneCharacter` | `m_ShelterThreshold` | float | `0.75` | Shelter threshold applied to characters. |

### Resource Respawn

| Key | Section | INI key | Type | Default | Description |
|-----|---------|---------|------|---------|-------------|
| `resourceSpawnChance` | `/Script/DuneSandbox.ResourceLocationSystem` | `m_ResourceSpawnChance` | float | `1.0` | Chance for a resource point to repopulate. |
| `spicePrimeRateSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_PrimeRateInSeconds` | float | `30.0` | Prime cycle for spice field creation. |
| `spiceManagerTickRateSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_ManagerTickRateInSeconds` | float | `5.0` | How often spice respawn state is advanced. |
| `spiceManagerRequestRefreshRateSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_ManagerRequestRefreshRateInSeconds` | float | `90.0` | Local refresh cycle for new spice opportunities. |
| `spiceGlobalRequestRefreshRateSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `m_GlobalManagerRequestRefreshRateInSeconds` | float | `120.0` | Global refresh cycle for spice opportunities. |
| `flourSandFieldsActivePercentage` | `/Script/DuneSandbox.FlourSandSubsystem` | `m_FlourSandFieldsActivePercentage` | float | `1.0` | Share of flour sand fields eligible to stay active. |
| `dewRefreshTimeHours` | `/Script/DuneSandbox.DewHarvestSettings` | `m_DewRefreshTime` | float | `12.0` | Water-source refresh cadence that affects survival loops. |
| `itemDeteriorationUpdateRateSeconds` | `/DeteriorationSystem.ItemDeteriorationConstants` | `UpdateRateInSeconds` | float | `1.0` | Decay tick cadence often changed alongside respawn pacing. |

## UserEngine.ini

### Networking

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `NetServerMaxTickRate` | `/Script/Engine.Engine` | integer | `60` | Max server tick rate used by this repo. |
| `MaxClientRate` | `/Script/OnlineSubsystemUtils.IpNetDriver` | integer | `100000` | Max client bandwidth rate in bytes per second. |
| `MaxInternetClientRate` | `/Script/OnlineSubsystemUtils.IpNetDriver` | integer | `100000` | Max internet client bandwidth rate in bytes per second. |
| `ClientErrorUpdateRateLimit` | `/Script/Engine.GameNetworkManager` | float | `0.35` | Rate limit for client correction updates. |
| `ClientNetSendMoveDeltaTime` | `/Script/Engine.GameNetworkManager` | float | `0.0333` | Move packet interval for active clients. |
| `ClientNetSendMoveDeltaTimeThrottled` | `/Script/Engine.GameNetworkManager` | float | `0.0666` | Move packet interval for throttled clients. |
| `ClientNetSendMoveDeltaTimeStationary` | `/Script/Engine.GameNetworkManager` | float | `0.0833` | Move packet interval for stationary clients. |
| `MaxMoveDeltaTime` | `/Script/Engine.GameNetworkManager` | float | `0.25` | Max move delta accepted by the server. |
| `MAXPOSITIONERRORSQUARED` | `/Script/Engine.GameNetworkManager` | integer | `64` | Position error tolerance before correction. |
| `bMovementTimeDiscrepancyDetection` | `/Script/Engine.GameNetworkManager` | boolean | `true` | Enable time-discrepancy detection for movement. |
| `bMovementTimeDiscrepancyResolution` | `/Script/Engine.GameNetworkManager` | boolean | `true` | Correct detected movement time drift. |

### FuncomLiveServices

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `ServiceAuthToken` | `FuncomLiveServices` | string | `""` | FLS JWT used to register the battlegroup. |
| `DefaultFlsEnvironment` | `FuncomLiveServices` | string | `retail` | FLS environment such as `beta` or `retail`. |

### OnlineSubsystem and ConsoleVariables

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `ServerName` | `OnlineSubsystem` | string | `""` | Unique world or battlegroup name. |
| `DatacenterId` | `OnlineSubsystem` | string | `North America` | Region or datacenter identifier. |
| `Bgd.ServerDisplayName` | `ConsoleVariables` | string | `""` | Public display name shown to players. |
| `Bgd.ServerLoginPassword` | `ConsoleVariables` | string | `""` | Optional join password. |

## director.ini

### Instancing Modes

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `Overmap` | `InstancingModes` | string | `SingleServer` | Instancing mode for Overmap. |
| `Survival_1` | `InstancingModes` | string | `Dimension` | Instancing mode for the main survival shard. |
| `DeepDesert_1` | `InstancingModes` | string | `ClassicalInstancing` | Instancing mode for the Deep Desert shard. |

### Global Director Limits

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `PlayerHardCap` | `Server` | integer | `40` | Global default player cap applied when a map override is absent. |

### Per-map Director Overrides

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `PlayerHardCap` | `Survival_1` | integer | `60` | Player cap for Survival_1. |
| `NpeGrantDurationInMinutes` | `Survival_1` | integer | `90` | NPE grant window for Survival_1. |
| `PlayerHardCap` | `DeepDesert_1` | integer | `80` | Player cap for Deep Desert. |
| `MinServers` | `DeepDesert_1` | integer | `0` | Minimum always-running Deep Desert instances. |
| `NumExtraServers` | `DeepDesert_1` | integer | `0` | Prewarmed extra Deep Desert instances. |
| `PlayerHardCap` | `Overmap` | integer | `40` | Player cap for Overmap. |

## gateway.ini

### OnlineSubsystem

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `ServerName` | `OnlineSubsystem` | string | `""` | Battlegroup world name injected at startup. |
| `DatacenterId` | `OnlineSubsystem` | string | `North America` | Region identifier injected at startup. |

### Gateway

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `display_name` | `Gateway` | string | `WORLD_NAME` | Human-readable battlegroup title registered with FLS. |
| `Provider` | `Gateway` | string | `self-hosted` | Provider label shown in registration metadata. |

## Command Line Arguments

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `-FarmRegion` | string | `North America` | Region sent to the game server at launch. |
| `-ini:engine:[FuncomLiveServices]:ServiceAuthToken` | string | `""` | Inject FLS authentication token. |
| `-ini:engine:[FuncomLiveServices]:DefaultFlsEnvironment` | string | `retail` | Select the target FLS environment. |
| `-ini:engine:[OnlineSubsystem]:ServerName` | string | `WORLD_UNIQUE_NAME` | Set the unique battlegroup name. |
| `-ini:engine:[OnlineSubsystem]:DatacenterId` | string | `North America` | Set the world region or datacenter label. |
| `-ini:engine:[ConsoleVariables]:Bgd.ServerLoginPassword` | string | `""` | Set an optional join password. |
| `-ini:game:[DuneDatabaseInterfacePSQL]:DatabaseHost` | string | `postgres:5432` | Point the game server at PostgreSQL. |
| `-ini:game:[DuneDatabaseInterfacePSQL]:DatabaseUser` | string | `dune` | Set the PostgreSQL username. |
| `-ini:game:[DuneDatabaseInterfacePSQL]:DatabasePassword` | string | `POSTGRES_DUNE_PASSWORD` | Set the PostgreSQL password. |
| `-RMQGameTlsEnabled` | boolean | `true` | Enable TLS for game-facing RMQ traffic. |
| `-ExternalAddress` | string | `EXTERNAL_ADDRESS` | Public address advertised to clients and services. |
| `-MultiHome` | string | `POD_IP` | Bind the server process to a specific local IP. |
| `-Port` | integer | `7777` | Base gameplay UDP port for a shard. |
| `-IGWPort` | integer | `7888` | Base inter-server UDP port for a shard. |
| `-PartitionIndex` | integer | `1` | Partition or shard index passed to the server. |
| `--RMQGameHostname` | string | `game-rmq` | Hostname for game RMQ. |
| `--RMQGamePort` | integer | `5672` | Port for game RMQ. |
| `--RMQAdminHostname` | string | `admin-rmq` | Hostname for admin RMQ. |
| `--RMQAdminPort` | integer | `5672` | Port for admin RMQ. |
| `--RMQGameHttpPort` | integer | `31983` | Gateway HTTP auth port for game RMQ. |

## Notes

- `config/UserGame.ini` in this repository currently overrides only a small subset of the larger gameplay surface.
- Some gameplay knobs are exposed as `ConsoleVariables` rather than traditional class section keys.
- No generic `ResourceRespawnTime` key has been confirmed in this repo. Resource pacing is currently inferred from `ResourceLocationSystem`, `SpiceHarvestingSystem`, `FlourSandSubsystem`, and dew refresh settings.
- Deep Desert event timing is mostly controlled through `SandStormConfig`, `SandwormSettings`, and `director.ini` capacity settings.
