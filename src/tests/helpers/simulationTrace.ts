/**
 * src/tests/helpers/simulationTrace.ts
 *
 * Deterministic State-Hash Tracing Facility for the DRDO X-Band Digital Twin (M0.1).
 *
 * Implements canonical state serialization and SHA-256 state hashing:
 * 1. Serializes floating-point values via raw 64-bit IEEE-754 representations (float64ToCanonicalHex).
 * 2. Canonicalizes -0.0 to +0.0.
 * 3. Detects and reports unexpected NaN values.
 * 4. Maintains strictly ordered serialization for nodes, queues, packets, link states, and allocations.
 * 5. Excludes wall-clock timestamps and presentation state from the state hash.
 * 6. Excludes process-global packet IDs after mathematically verifying they do not influence simulation decisions.
 * 7. Purely observational: does NOT mutate simulation state.
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { SimulationWorkerManager } from '../../worker/simWorker';

const floatBuf = new Float64Array(1);
const uintBuf = new BigUint64Array(floatBuf.buffer);

/**
 * Serializes a 64-bit float to a 16-character hexadecimal string representing
 * its raw IEEE-754 bit pattern. Canonicalizes -0.0 to +0.0 and throws on NaN.
 */
export function float64ToCanonicalHex(value: number): string {
  if (Number.isNaN(value)) {
    throw new Error(`Unexpected NaN value encountered during canonical state serialization`);
  }
  // Canonicalize -0 to +0
  const normalized = Object.is(value, -0) ? 0 : value;
  floatBuf[0] = normalized;
  return uintBuf[0].toString(16).padStart(16, '0');
}

export interface CanonicalTraceEntry {
  readonly frame_index: number;
  readonly sim_time_s: number;
  readonly state_sha256: string;
}

export interface SimulationTrace {
  readonly schema_version: '1.0';
  readonly provenance: {
    readonly git_commit: string;
    readonly git_branch: string;
    readonly git_dirty: boolean;
    readonly node_version: string;
    readonly platform: string;
    readonly arch: string;
  };
  readonly configuration: {
    readonly seed: number;
    readonly terrain_mode: string;
    readonly terrain_asset_checksum_sha256: string | null;
    readonly simulation_timestep_s: number;
    readonly total_frames: number;
    readonly trace_interval: number;
  };
  readonly trace: readonly CanonicalTraceEntry[];
}

/**
 * Serializes the authoritative simulation state of a SimulationWorkerManager
 * into a stable, canonical string for hashing.
 */
export function serializeCanonicalState(manager: SimulationWorkerManager): string {
  const parts: string[] = [];

  // 1. Frame Index & Simulation Time
  parts.push(`F:${manager.frameIndex}`);
  parts.push(`T:${float64ToCanonicalHex(manager.simTimeS)}`);

  // 2. UAV Kinematics (Authoritative Position & Velocity)
  const trajectoryEngine = (manager as any).trajectoryEngine;
  if (trajectoryEngine) {
    const acnPos = trajectoryEngine.getAcnPosition(manager.simTimeS);
    const acnVel = trajectoryEngine.getAcnVelocity(manager.simTimeS);
    const acnSpeed = trajectoryEngine.getCurrentSpeed(manager.simTimeS);

    parts.push(`UAV:P:${float64ToCanonicalHex(acnPos[0])},${float64ToCanonicalHex(acnPos[1])},${float64ToCanonicalHex(acnPos[2])}`);
    parts.push(`UAV:V:${float64ToCanonicalHex(acnVel[0])},${float64ToCanonicalHex(acnVel[1])}`);
    parts.push(`UAV:S:${float64ToCanonicalHex(acnSpeed)}`);
  }

  // 3. Ground Nodes & Queues (Tac & Static subsystems)
  const nodesTac = (manager as any).nodesTac ?? [];
  const nodesStatic = (manager as any).nodesStatic ?? [];

  // Iterate strictly ordered node IDs 0..15
  for (let i = 0; i < 16; i++) {
    const nodeT = nodesTac[i];
    const nodeS = nodesStatic[i];
    if (!nodeT) continue;

    // Node spatial state
    parts.push(`N${i}:POS:${float64ToCanonicalHex(nodeT.position[0])},${float64ToCanonicalHex(nodeT.position[1])},${float64ToCanonicalHex(nodeT.position[2])}`);
    parts.push(`N${i}:AGL:${float64ToCanonicalHex(nodeT.aglM)}`);
    parts.push(`N${i}:SHADOW:${nodeT.isShadowed ? 1 : 0}`);

    // Queue state for Tac
    const qT = nodeT.queue;
    if (qT) {
      parts.push(`N${i}:Q_TAC:PKTS:${qT.getTotalPackets()}:BYTES:${qT.getTotalBacklogBytes()}:DROP_D:${qT.droppedDelayCount}:DROP_O:${qT.droppedOverflowCount}`);
      // Class subqueues in fixed priority order: 69, 65, 67, 70
      const subqueues = (qT as any).subqueues as Map<number, any[]> | undefined;
      if (subqueues) {
        for (const cls of [69, 65, 67, 70]) {
          const pkts = subqueues.get(cls) ?? [];
          for (let pIdx = 0; pIdx < pkts.length; pIdx++) {
            const p = pkts[pIdx];
            // Exclude process-global packetId; retain qos, size, arrival, deadline, sojourn
            parts.push(`P:${cls}:${p.sizeBytes}:${float64ToCanonicalHex(p.arrivalTimeS)}:${float64ToCanonicalHex(p.deadlineS)}:${float64ToCanonicalHex(p.sojournTimeS)}`);
          }
        }
      }
    }

    // Queue state for Static
    if (nodeS && nodeS.queue) {
      const qS = nodeS.queue;
      parts.push(`N${i}:Q_STAT:PKTS:${qS.getTotalPackets()}:BYTES:${qS.getTotalBacklogBytes()}:DROP_D:${qS.droppedDelayCount}:DROP_O:${qS.droppedOverflowCount}`);
    }
  }

  // 4. Link Statuses (0..15)
  const linkStatuses = (manager as any).linkStatuses as Map<number, any> | undefined;
  if (linkStatuses) {
    for (let i = 0; i < 16; i++) {
      const ls = linkStatuses.get(i);
      if (ls) {
        parts.push(`LS${i}:OUT:${ls.isOutage ? 1 : 0}:BLK:${ls.obstacleBlocked ? 1 : 0}:SNR:${float64ToCanonicalHex(ls.snrDb)}:RATE:${float64ToCanonicalHex(ls.bitrateBps)}:DIFF:${float64ToCanonicalHex(ls.diffractionLossDb)}`);
      }
    }
  }

  // 5. Predictive Lookahead States (0..15)
  const predStates = (manager as any).predStates as Map<number, any> | undefined;
  if (predStates) {
    for (let i = 0; i < 16; i++) {
      const ps = predStates.get(i);
      if (ps) {
        parts.push(`PS${i}:STATE:${ps.currentState}:TO_OCC:${float64ToCanonicalHex(ps.timeToOcclusionS)}:TO_EM:${float64ToCanonicalHex(ps.timeToEmergenceS)}:FRES:${float64ToCanonicalHex(ps.fresnelClearanceM)}`);
      }
    }
  }

  // 6. Scheduler Reports (Static & Tac-TAD)
  const rStatic = (manager as any).lastReportStatic;
  if (rStatic) {
    parts.push(`SCHED_STAT:UL_SCHED:${float64ToCanonicalHex(rStatic.totalUlScheduledS)}:TX:${rStatic.totalBitsTransmitted}:WASTE:${rStatic.totalBitsWastedOnOutage}:DROP_D:${rStatic.packetsDroppedDelay}:DROP_O:${rStatic.packetsDroppedOverflow}`);
    for (let aIdx = 0; aIdx < rStatic.allocations.length; aIdx++) {
      const a = rStatic.allocations[aIdx];
      parts.push(`ALLOC_STAT:${a.nodeId}:${float64ToCanonicalHex(a.durationS)}:${a.capacityBits}`);
    }
  }

  const rTac = (manager as any).lastReportTac;
  if (rTac) {
    parts.push(`SCHED_TAC:UL_SCHED:${float64ToCanonicalHex(rTac.totalUlScheduledS)}:TX:${rTac.totalBitsTransmitted}:WASTE:${rTac.totalBitsWastedOnOutage}:DROP_D:${rTac.packetsDroppedDelay}:DROP_O:${rTac.packetsDroppedOverflow}`);
    for (let aIdx = 0; aIdx < rTac.allocations.length; aIdx++) {
      const a = rTac.allocations[aIdx];
      parts.push(`ALLOC_TAC:${a.nodeId}:${float64ToCanonicalHex(a.durationS)}:${a.capacityBits}:${a.isPreOcclusionFlush ? 1 : 0}`);
    }
  }

  // 7. Accumulated Run Metrics
  const m = manager.metrics;
  if (m) {
    parts.push(`M:SG:${Math.round(m.staticGoodputBits)}:TG:${Math.round(m.tacGoodputBits)}:SW:${Math.round(m.staticWastedBits)}:TW:${Math.round(m.tacWastedBits)}:SD:${m.staticDroppedPkts}:TD:${m.tacDroppedPkts}`);
    parts.push(`M:ST_SCHED:${float64ToCanonicalHex(m.staticScheduledUlTimeS)}:TT_SCHED:${float64ToCanonicalHex(m.tacScheduledUlTimeS)}`);
    parts.push(`M:SB:${Math.round(m.staticFinalBacklogBits)}:TB:${Math.round(m.tacFinalBacklogBits)}`);
  }

  return parts.join('|');
}

/**
 * Computes a 64-character SHA-256 hash of the canonical state string.
 */
export function computeCanonicalStateHash(manager: SimulationWorkerManager): string {
  const serialized = serializeCanonicalState(manager);
  return createHash('sha256').update(serialized).digest('hex');
}

export interface TraceOptions {
  readonly seed: number;
  readonly frames: number;
  readonly terrainMode: 'synthetic' | 'real';
  readonly traceInterval?: number;
  readonly realDemBuffer?: Buffer | null;
  readonly terrainAssetChecksum?: string | null;
}

/**
 * Runs a simulation while recording canonical state hashes at frame 0 and after
 * every `traceInterval` steps.
 */
export function generateSimulationTrace(options: TraceOptions): SimulationTrace {
  const { seed, frames, terrainMode, traceInterval = 1, realDemBuffer, terrainAssetChecksum = null } = options;

  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let gitDirty = false;
  try {
    gitCommit = execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const status = execSync('git status --porcelain', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitDirty = status.length > 0;
  } catch (_) {}

  const manager = new SimulationWorkerManager(seed * 100_000);

  if (terrainMode === 'real' && realDemBuffer) {
    const demArray = new Float32Array(realDemBuffer.buffer, realDemBuffer.byteOffset, 512 * 512);
    manager.terrainEngine.loadCustomDem(demArray);
    (manager as any).resampleGroundNodeAltitudes?.();
  } else {
    manager.terrainEngine.setTerrainMode('synthetic');
  }

  manager.isPaused = true;

  const entries: CanonicalTraceEntry[] = [];

  // Capture Frame 0 state prior to first tick
  entries.push({
    frame_index: manager.frameIndex,
    sim_time_s: manager.simTimeS,
    state_sha256: computeCanonicalStateHash(manager),
  });

  // Step loop
  for (let i = 1; i <= frames; i++) {
    manager.tickSimulation();
    if (i % traceInterval === 0 || i === frames) {
      entries.push({
        frame_index: manager.frameIndex,
        sim_time_s: manager.simTimeS,
        state_sha256: computeCanonicalStateHash(manager),
      });
    }
  }

  return {
    schema_version: '1.0',
    provenance: {
      git_commit: gitCommit,
      git_branch: gitBranch,
      git_dirty: gitDirty,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    configuration: {
      seed,
      terrain_mode: terrainMode,
      terrain_asset_checksum_sha256: terrainAssetChecksum,
      simulation_timestep_s: 0.020,
      total_frames: frames,
      trace_interval: traceInterval,
    },
    trace: entries,
  };
}
