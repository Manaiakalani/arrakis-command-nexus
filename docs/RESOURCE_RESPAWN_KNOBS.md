# Resource Respawn Configuration Knobs

Focused reference for known knobs that affect resource respawn or resource availability.

## Important caveat

A single generic `ResourceRespawnTime` key has not been confirmed in this repository. The server currently exposes adjacent systems that influence when resources become available again.

## Confirmed knobs

| Key | Location | Default | Effect |
|-----|----------|---------|--------|
| `m_bIsEnabled` | `/Script/DuneSandbox.ResourceLocationSystem` | `true` | Enables the resource location system. |
| `m_ResourceSpawnChance` | `/Script/DuneSandbox.ResourceLocationSystem` | `1.0` | Chance for an eligible resource point to spawn. |
| `m_ResourcePointTrace` | `/Script/DuneSandbox.ResourceLocationSystem` | `MoveUpwards` | Trace mode used when placing resource points. |
| `m_bSpawningActive` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `true` | Turns spice bloom and field spawning on or off. |
| `m_PrimeRateInSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `30.0` | Prime cycle for spice field generation. |
| `m_ManagerTickRateInSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `5.0` | How often the spice manager advances state. |
| `m_ManagerRequestRefreshRateInSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `90.0` | Local refresh cycle for spice spawn requests. |
| `m_GlobalManagerRequestRefreshRateInSeconds` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `120.0` | Global refresh cycle for spice spawn requests. |
| `m_bPlayerMustWitnessBloom` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `false` | Requires player presence before bloom activation. |
| `m_NodeValueToSpiceResourceRatio` | `/Script/DuneSandbox.SpiceHarvestingSystem` | `10.0` | Controls how much spice a node yields once active. |
| `m_FlourSandFieldsActivePercentage` | `/Script/DuneSandbox.FlourSandSubsystem` | `1.0` | Percentage of flour sand fields kept active. |
| `m_DewRefreshTime` | `/Script/DuneSandbox.DewHarvestSettings` | `12.0` | Refresh cadence for standard dew sources. |
| `m_DewRefreshTimeNPE` | `/Script/DuneSandbox.DewHarvestSettings` | `300.0` | Refresh cadence for new-player dew sources. |
| `UpdateRateInSeconds` | `/DeteriorationSystem.ItemDeteriorationConstants` | `1.0` | Item decay tick interval often tuned alongside respawn pacing. |
| `Dune.GlobalMiningOutputMultiplier` | `ConsoleVariables` | `1.0` | Does not change respawn time, but changes effective harvest throughput. |
| `Dune.GlobalVehicleMiningOutputMultiplier` | `ConsoleVariables` | `1.0` | Does not change respawn time, but changes vehicle harvest throughput. |
| `SecurityZones.PvpResourceMultiplier` | `ConsoleVariables` | `2.5` | Boosts yield inside PvP-enabled areas. |

## Deep Desert specific notes

- Community extracts point to Deep Desert spice-field caps of `Small=60`, `Medium=12`, and `Large=1`.
- Those per-map caps are useful context, but they are not currently surfaced in this project's checked-in config files.
- For now, the most actionable Deep Desert respawn knobs are the spice manager timers and `m_GiantWormMinimumSpiceAmountHarvested`, which indirectly changes how often major spice events escalate.

## Tuning guidance

- Start with `m_ResourceSpawnChance` for broad node availability changes.
- Use the spice manager timers for Deep Desert spice pacing.
- Use mining multipliers only when you want faster progression without changing actual respawn cadence.
- Keep notes on which shard you changed, because Deep Desert pacing issues are often capacity issues in `director.ini`, not just respawn issues.
