/**
 * scripts/measure_memory_child.ts
 *
 * Standalone child process memory benchmark for spatial and communication stores.
 * Architecture Specification: DRDO-TAC-XBAND-ARCH-TIMELINE-17 (Section 8).
 *
 * Measures:
 * 1. Baseline heap footprint.
 * 2. Full capacity footprint (3,000 spatial frames at specified nodeCount + 6,000 epoch records).
 * 3. Backing typed-array byte length via spatialBuffer.getTotalByteLength().
 * 4. Premature eviction prevention via WeakRef probes.
 * 5. Full 2x capacity overwrite and eviction behavior.
 * 6. Post-eviction heap stability: postEvictionHeapBytes <= populatedHeapBytes * 1.10.
 *
 * Exit Codes:
 * 0 - SUCCESS (stable heap)
 * 2 - ENVIRONMENT_FAILURE (missing --expose-gc)
 * 3 - HEAP_STABILITY_FAILURE (heap inflation > 10%)
 * 4 - PREMATURE_EVICTION (probe collected before capacity)
 */

import os from 'os';
import { SpatialSnapshotBuffer } from '../src/ui/spatialSnapshotBuffer';
import { SuperframeEpochStore } from '../src/ui/superframeEpochStore';
import type {
  SpatialFrameSnapshot,
  SpatialNodeSnapshot,
  SuperframeEpochRecord,
} from '../src/shared/workerProtocol';
import { NodeTerrainState } from '../src/core/trajectory';

if (typeof (global as any).gc !== 'function') {
  console.error('FATAL: --expose-gc is mandatory for memory verification.');
  process.exitCode = 2; // ENVIRONMENT_FAILURE
} else {
  const nodeCountArg = parseInt(process.argv[2] ?? '16', 10);
  const runIndexArg = parseInt(process.argv[3] ?? '1', 10);
  runChildMeasurement(nodeCountArg, runIndexArg).catch((err) => {
    console.error('Child execution failed:', err);
    process.exitCode = 1;
  });
}

function generateMockSpatialSnapshot(frameIndex: number, nodeCount: number): SpatialFrameSnapshot {
  const nodes: SpatialNodeSnapshot[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      nodeId: i,
      posX: 1000 + i * 10,
      posY: 2000 + i * 10,
      posZ: 3500,
      altitudeMslM: 3500,
      altitudeAglM: 10,
      isLos: i % 2 === 0,
      isOutage: i % 4 === 0,
      isObstacleBlocked: i % 8 === 0,
      snrDb: 18.0 - (i * 0.1),
      currentState: NodeTerrainState.NORMAL_LOS,
    });
  }

  return {
    frameIndex,
    simulationTimeS: frameIndex * 0.020,
    wallClockTimeMs: 1000 + frameIndex * 20,
    spatialRevision: frameIndex,
    acn: {
      posX: 1000 + frameIndex,
      posY: 2000 + frameIndex,
      posZ: 5000,
      velX: 50,
      velY: 0,
      velZ: 0,
      headingRad: 0.5,
      pitchDeg: 1.0,
      altitudeMslM: 5000,
      altitudeAglM: 1500,
      coverageRadiusKm: 35.0,
      isTerrainClamped: false,
    },
    nodes,
    selectedLinkBudget: {
      slantRangeM: 15000,
      fsplDb: 130,
      diffractionLossDb: 0,
      gasLossDb: 0,
      rainLossDb: 0,
      totalLossDb: 130,
      snrDb: 20,
      modcodName: '16-APSK 2/3',
      bitrateMbps: 25,
      isOutage: false,
    },
  };
}

function generateMockEpochRecord(epochIndex: number): SuperframeEpochRecord {
  return {
    recordType: 'EPOCH',
    epochIndex,
    startTimeS: epochIndex * 0.020,
    endTimeS: (epochIndex + 1) * 0.020,
    durationMs: 20.0,
    configuredDurationMs: 20.0,
    nominalSimTimeS: (epochIndex + 1) * 0.020,
    associatedSimulationFrameIndex: epochIndex,
    staticMetrics: {
      transmittedNonOutageBits: 8000,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 8000,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: 0,
      droppedOverflowBytes: 0,
      totalDroppedBytes: 0,
      ulUtilizationPct: 50.0,
    },
    tacMetrics: {
      transmittedNonOutageBits: 8000,
      outageWastedBits: 0,
      totalPayloadBitsDequeued: 8000,
      droppedDelayPkts: 0,
      droppedOverflowPkts: 0,
      totalDroppedPkts: 0,
      droppedDelayBytes: 0,
      droppedOverflowBytes: 0,
      totalDroppedBytes: 0,
      ulUtilizationPct: 50.0,
    },
    activeSchedulerMode: 'tac_tad',
  };
}

async function runChildMeasurement(nodeCount: number, runIndex: number): Promise<void> {
  const gc = (global as any).gc;
  for (let i = 0; i < 3; i++) gc();
  const baselineHeapBytes = process.memoryUsage().heapUsed;

  let snap0: SpatialFrameSnapshot | null = generateMockSpatialSnapshot(0, nodeCount);
  let epoch0: SuperframeEpochRecord | null = generateMockEpochRecord(0);
  const probeSnapRef = new WeakRef(snap0);
  const probeEpochRef = new WeakRef(epoch0);

  const spatialBuffer = new SpatialSnapshotBuffer(3000, Math.max(16, nodeCount));
  const epochStore = new SuperframeEpochStore(6000);

  spatialBuffer.append(snap0);
  epochStore.append(epoch0);
  snap0 = null;
  epoch0 = null;

  for (let i = 1; i < 3000; i++) spatialBuffer.append(generateMockSpatialSnapshot(i, nodeCount));
  for (let i = 1; i < 6000; i++) epochStore.append(generateMockEpochRecord(i));

  // Premature collection check
  if (probeSnapRef.deref() === undefined || probeEpochRef.deref() === undefined) {
    console.error('PREMATURE_EVICTION: Probe objects collected before reaching buffer capacity');
    process.exitCode = 4; // PREMATURE_EVICTION
    return;
  }

  for (let i = 0; i < 3; i++) gc();
  const populatedHeapBytes = process.memoryUsage().heapUsed;
  const populatedDeltaMb = (populatedHeapBytes - baselineHeapBytes) / (1024 * 1024);
  const typedArrayBackingBytes = spatialBuffer.getTotalByteLength();

  // Evict probe objects by inserting full second capacity
  for (let i = 3000; i < 6000; i++) spatialBuffer.append(generateMockSpatialSnapshot(i, nodeCount));
  for (let i = 6000; i < 12000; i++) epochStore.append(generateMockEpochRecord(i));

  // Bounded retry loop with macrotask turn
  let collectionObserved = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 20)); // Macrotask boundary
    gc();

    if (probeSnapRef.deref() === undefined && probeEpochRef.deref() === undefined) {
      collectionObserved = true;
      break;
    }
  }

  const postEvictionHeapBytes = process.memoryUsage().heapUsed;
  const postEvictionDeltaMb = (postEvictionHeapBytes - baselineHeapBytes) / (1024 * 1024);
  const heapStable = postEvictionHeapBytes <= populatedHeapBytes * 1.10;

  const resultPayload = {
    nodeCount,
    runIndex,
    baselineHeapBytes,
    populatedHeapBytes,
    postEvictionHeapBytes,
    populatedDeltaMb,
    postEvictionDeltaMb,
    typedArrayBackingBytes,
    typedArrayBackingMb: typedArrayBackingBytes / (1024 * 1024),
    collectionDiagnostic: collectionObserved ? 'PROBE_COLLECTION_OBSERVED' : 'COLLECTION_NOT_OBSERVED',
    heapStable,
    gcAvailable: true,
    env: {
      nodeVersion: process.version,
      v8Version: process.versions.v8,
      osPlatform: process.platform,
      arch: process.arch,
      totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    },
  };

  console.log(JSON.stringify(resultPayload));

  if (!heapStable) {
    process.exitCode = 3; // HEAP_STABILITY_FAILURE
  } else {
    process.exitCode = 0; // SUCCESS
  }
}
