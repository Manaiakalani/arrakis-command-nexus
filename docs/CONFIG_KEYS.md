# Dune Awakening Server Configuration Keys

Complete reference for known configuration keys used by the Dune Awakening dedicated server.

This index combines keys confirmed in this repository, keys surfaced by `ServerGameplaySettings` style control-plane payloads, and common UE5 dedicated server keys. Defaults are upstream or compose defaults when known.

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

Port note: operators on the k3s/Funcom-operator stack, not this Docker Compose stack, configure UDP ports via env vars `K8S_POOL_GAME_PORT_BASE` and `GAME_UDP_PORT_RANGE`. This Docker Compose stack uses the explicit `-Port` and `-IGWPort` flags via the `survival_1` and `overmap` service definitions.

### Often-tuned shipped keys and console variables

| INI key | Section | Type | Description |
|---------|---------|------|-------------|
| `m_DefaultReconnectGracePeriodSeconds` | `/Script/DuneSandbox.PlayerOnlineStateSettings` | integer | Time to hold a disconnected player session before destroying the pawn. |
| `m_MaxGuildMembersAllowed` | `/Script/DuneSandbox.GuildSettings` | integer | Maximum members allowed in one guild. |
| `m_MaxGuildsAllowed` | `/Script/DuneSandbox.GuildSettings` | integer | Maximum guilds allowed on the server. |
| `m_GuildCreationCost` | `/Script/DuneSandbox.GuildSettings` | integer | Solari cost to create a guild. |
| `m_bIsDbWipeEnabled` | `/Script/DuneSandbox.CoriolisSubsystem` | boolean | Set true to allow Coriolis DB wipe behavior. |
| `m_DayLengthMinutes` | `/Script/DuneSandbox.TimeOfDaySettings` | float | Full in-game day length in real minutes. |
| `m_VehicleQuicksandDamage` | `/Script/DuneSandbox.HazardsSettings` | float | Vehicle quicksand damage; Funcom default is `10000.0`. |
| `Dune.GlobalMiningOutputMultiplier` | `ConsoleVariables` | float | Hand-mining output multiplier. |
| `Dune.GlobalVehicleMiningOutputMultiplier` | `ConsoleVariables` | float | Vehicle mining output multiplier. |
| `SecurityZones.PvpResourceMultiplier` | `ConsoleVariables` | float | Resource multiplier inside PvP-enabled zones. |

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

### Battlegroup

| Key | Section | Type | Default | Description |
|-----|---------|------|---------|-------------|
| `IncomingCharacterTransfers` | `Battlegroup` | enum | `0` | Transfer intake policy: `0` = Default, `10` = DenyAll, `20` = AllowFromPrivateOnly, `30` = AllowFromOfficialOnly, `40` = AllowFromPrivateAndOfficial, `50` = AllowAll. See [Operations](./OPERATIONS.md#character-transfers-1401-behavior-change) before enabling transfers because 1.4.0.1+ transfers delete the origin character. |

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
| `ShouldUpdatePlayerCountOnFls` | `Server` | bool | `false` | Push live population counts to FLS for the global cap. Off for self-hosted to avoid noisy heartbeats. |
| `ForceLock` | `Server` | bool | `false` | When `true`, the battlegroup refuses new joins regardless of caps. Useful for maintenance windows. |
| `DauCap` | `Server` | integer | `1000000` | FLS-side daily-active-users cap. Effectively unlimited for self-hosted. |
| `WauCap` | `Server` | integer | `3360` | FLS-side weekly-active-users cap. Funcom's default; safe to leave alone. |
| `HbsCap` | `Server` | integer | `1000000` | FLS-side concurrent heartbeat cap. Effectively unlimited for self-hosted. |
| `AllowGroupTravel` | `Server` | bool | `true` | **Set to `true`**  -  when `false`, parties are dissolved on every cross-server handoff (disconnect/rejoin, Overmap ↔ Survival, Deep Desert excursions). The Funcom-shipped sample defaults to `false`; flip it to `true` if you want parties to persist. |

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

## Cross-source audit (June 2026)

This section catalogues every gameplay multiplier and toggle commonly requested by server operators, along with the verification status of each key against the shipped server binary.

Statuses:
- **VERIFIED-LIVE**: present in our schema, applied on this server, and observed working in-game.
- **VERIFIED-BINARY**: name appears in shipped `DuneSandboxServer-Linux-Shipping` strings dump or in Funcom's shipped `DefaultGame.ini`.
- **UNVERIFIED**: documented but not confirmed in our binary scan. Treat as "best-effort, may silently no-op".
- **WISHLIST**: no binary evidence; not confirmed.

Verification method:
- Binary string analysis of the shipped `DuneSandboxServer-Linux-Shipping` server binary.
- Funcom's official self-hosted server page and helpshift FAQ #85 ("any User ini file can manipulate any exposed setting").
- Live validation against this server's running configuration.

### Sandstorm controls

| Key | Section | Status | Notes |
|-----|---------|--------|-------|
| `Sandstorm.Enabled` | `[ConsoleVariables]` (UserEngine) | **VERIFIED-LIVE** | Master toggle, in our schema. |
| `Sandstorm.Treasure.Enabled` | `[ConsoleVariables]` | **VERIFIED-LIVE** | In our schema. |
| `m_bAutoSpawnEnabled` | `/Script/DuneSandbox.SandStormConfig` | **VERIFIED-LIVE** | In our schema. |
| `m_bMitigateAllSandstormDamage` | `/Script/DuneSandbox.BuildingSettings` | **VERIFIED-LIVE** | In our schema. |
| `m_bCoriolisAutoSpawnEnabled` | `/Script/DuneSandbox.SandStormConfig` | **VERIFIED-LIVE** | In our schema. |
| `m_StormCycleDuration` | `/Script/DuneSandbox.SandStormConfig` | **UNVERIFIED** | Not in our binary scan. |
| `m_StormDuration` | `/Script/DuneSandbox.SandStormConfig` | **UNVERIFIED** | Not in our binary scan. |
| `m_StormWarningDuration` | `/Script/DuneSandbox.SandStormConfig` | **UNVERIFIED** | Not in our binary scan. |
| `m_CycleDurationInDays` | `/Script/DuneSandbox.SandStormConfig` | **UNVERIFIED** | Coriolis season length. |

### PvP / PvE toggles

| Key | Section | Status |
|-----|---------|--------|
| `m_bShouldForceEnablePvpOnAllPartitions` | `/Script/DuneSandbox.PvpPveSettings` | **VERIFIED-LIVE** |
| `m_bAreSecurityZonesEnabled` | `/Script/DuneSandbox.SecurityZonesSubsystem` | **VERIFIED-LIVE** |
| `m_bSecurityZonesForceEnablePvp` | `/Script/DuneSandbox.SecurityZonesSubsystem` | **VERIFIED-BINARY** |
| `+SecurityZones.PvpResourceMultiplier` | `[ConsoleVariables]` | **VERIFIED-LIVE** |

### Harvesting and resource yield

| Key | Section | Status | Notes |
|-----|---------|--------|-------|
| `+Dune.GlobalMiningOutputMultiplier` | `[ConsoleVariables]` | **VERIFIED-LIVE** | Mining yield. In our schema. |
| `+Dune.GlobalVehicleMiningOutputMultiplier` | `[ConsoleVariables]` | **VERIFIED-LIVE** | Vehicle mining yield. |
| `m_GlobalHarvestAmountMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** | Not in our binary scan. Funcom Q&A says only mining is officially exposed today. |
| `m_GlobalHarvestHealthMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** | Node-health multiplier. |

### XP / Progression / Fame multipliers

| Key | Section | Status | Notes |
|-----|---------|--------|-------|
| `m_GlobalXPMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** | Not in our binary scan. |
| `m_GlobalFameMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** | Same. |
| `m_GlobalProgressionSpeedMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** | Same. |

### Item durability

| Key | Section | Status | Notes |
|-----|---------|--------|-------|
| `UpdateRateInSeconds` | `/DeteriorationSystem.ItemDeteriorationConstants` | **VERIFIED-LIVE** | Tick rate of deterioration. In our schema. |
| `+dw.VehicleDurabilityDamageMultiplier` | `[ConsoleVariables]` | **VERIFIED-LIVE** | Vehicle durability damage. |
| `m_ItemDurabilityLossMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** | Global durability loss. |

### Base / building decay

| Key | Section | Status |
|-----|---------|--------|
| `m_BaseBackupToolTimeRestrictionInSeconds` | `/Script/DuneSandbox.BuildingSettings` | **VERIFIED-LIVE** |
| `m_BaseBackupMaxExtensions` | `/Script/DuneSandbox.BuildingSettings` | **VERIFIED-LIVE** |
| `m_BuildingBlueprintMaxExtensions` | `/Script/DuneSandbox.BuildingSettings` | **VERIFIED-LIVE** |
| `m_MaxNumLandclaimSegments` | `/Script/DuneSandbox.BuildingSettings` | **VERIFIED-LIVE** |
| `m_bBuildingRestrictionLimitsEnabled` | `/Script/DuneSandbox.BuildingSettings` | **VERIFIED-LIVE** |
| `m_BuildingDecayRateMultiplier` | `/Script/DuneSandbox.BuildingSettings` | **UNVERIFIED** | Not in our binary scan. |
| `m_GlobalBuildingDamageMultiplier` | `/Script/DuneSandbox.BuildingSettings` | **UNVERIFIED** | Not in our binary scan. |

### Sandworm

| Key | Section | Status |
|-----|---------|--------|
| `+sandworm.dune.Enabled` | `[ConsoleVariables]` | **VERIFIED-LIVE** |
| `+Sandworm.SandwormDangerZonesEnabled` | `[ConsoleVariables]` | **VERIFIED-LIVE** |
| `+Vehicle.SandwormCollisionInteraction` | `[ConsoleVariables]` | **VERIFIED-LIVE** |
| `m_bGiantWormSystemEnabled` | `/Script/DuneSandbox.SandwormSettings` | **VERIFIED-LIVE** |
| `m_EnableSandwormSystem` | `/Script/DuneSandbox.SandwormSettings` | **VERIFIED-LIVE** |
| `m_GiantWormSpawningCooldown` | `/Script/DuneSandbox.SandwormSettings` | **VERIFIED-LIVE** |
| `m_GiantWormMinimumPlayersOnSpiceField` | `/Script/DuneSandbox.SandwormSettings` | **VERIFIED-LIVE** |
| `m_MinDistanceBetweenSandworms` | `/Script/DuneSandbox.SandwormSettings` | **VERIFIED-LIVE** |
| `ThreatScale` | `/Script/DuneSandbox.SandwormSettings` | **VERIFIED-LIVE** |
| `m_MinWormSpawnInternal` | `/Script/DuneSandbox.SandwormSettings` | **UNVERIFIED** | Note: typo "Internal" preserved from the binary symbol. |
| `m_SandwormQuicksandSpeedModifier` | `/Script/DuneSandbox.SandwormSettings` | **UNVERIFIED** | Not in our binary scan. |

### Survival (water, hunger, health)

| Key | Section | Status |
|-----|---------|--------|
| `m_bHydrationEnabled` | `/Script/DuneSandbox.HydrationSubsystem` | **VERIFIED-LIVE** |
| `m_GlobalHealthMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** |
| `m_GlobalDamageToPlayersMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** |
| `m_GlobalDamageToNpcsMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** |
| `m_WaterConsumptionRate` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** |
| `m_WaterConsumptionInStormMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** |
| `m_PlayerStartingWater` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** |
| `m_InventoryWeightMultiplier` | `/Script/DuneSandbox.DuneGameMode` | **UNVERIFIED** |

### Spice and taxation (additional sections not yet in our schema)

| Key | Section | Status |
|-----|---------|--------|
| `m_bSpawningActive` | `/Script/DuneSandbox.SpiceHarvestingSystem` | **WISHLIST** |
| `m_bPlayerMustWitnessBloom` | `/Script/DuneSandbox.SpiceHarvestingSystem` | **WISHLIST** |
| `m_NodeValueToSpiceResourceRatio` | `/Script/DuneSandbox.SpiceHarvestingSystem` | **WISHLIST** |
| `m_PrimeRateInSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | **WISHLIST** |
| `m_bTaxationEnabled` | `/Script/DuneSandbox.TaxationSettings` | **WISHLIST** |
| `m_SpicePerHour` | `/Script/DuneSandbox.TaxationSettings` | **WISHLIST** |
| `m_TaxationCycleLengthSeconds` | `/Script/DuneSandbox.TaxationSettings` | **WISHLIST** |

### Verification methodology

Binary verification was performed by streaming `DuneSandboxServer-Linux-Shipping` (357 MB stripped ELF) through `strings` and grepping for each key as an exact line match. False negatives are possible because:
- UProperty names sometimes appear only inside FProperty descriptors that don't decode cleanly via plain `strings`.
- Many UClass properties are reflected via the Unreal property system but their string representation lives in `.uobject` data, not in printable strings.

For high-impact UNVERIFIED keys (XP multiplier, harvest multiplier, durability, decay), the recommended next step is **live validation**: set the key to a non-default value (e.g., 2.0), restart the server, and confirm in-game effect. Document the result in the schema. The dashboard already supports a `verification_status` field for future use.

### Funcom official position (helpshift FAQ #85)

> "Some options are documented for them to change, but they are able to create various other User ini files to manipulate any exposed setting."

Funcom does not publish an exhaustive list of exposed settings. The exposed surface can be discovered by reading the shipped `DefaultGame.ini`, scanning the binary, and live-testing on a private server. The dashboard schema only ships keys we have evidence for; users who want to experiment with UNVERIFIED-tier keys can edit `config/UserGame.ini` directly.
