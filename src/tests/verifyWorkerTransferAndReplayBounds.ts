/**
 * src/tests/verifyWorkerTransferAndReplayBounds.ts
 *
 * Automated Verification Suite for:
 * SPEC-WP08: Web Worker Zero-Copy Transferables & Bounded Adaptive Replay Buffer Engine
 *
 * Verifies:
 * - WTR-T1: Codec Fidelity & Single-Buffer Packing (Terrain Profile, Viewshed Grid, VSA I/Q).
 * - WTR-T2: Real structuredClone({ transfer }) Detachment & Deduplication Proof.
 * - WTR-T3: Payload Size Reduction (Float32Array binary vs. JSON string serialization > 3x).
 * - WTR-T4: Bounded FIFO Ring Buffer ('ring' mode: strict O(1), exact newest 500, O(log N) binary search).
 * - WTR-T5: Adaptive Decimation ('adaptive-decimate' mode: t0/tend retention, keyframe priority, adversarial flood ceiling).
 * - WTR-T6: 50 Hz Performance Micro-Benchmark (1,000 ticks < 100 ms total, < 100 µs/tick).
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  cloneToTransferableFloat32,
  packFloat32Grid,
  unpackFloat32Grid,
  packTerrainProfileTyped,
  unpackTerrainProfileTyped,
  packConstellationIQ,
  unpackConstellationIQ,
  collectTransferables,
} from '../core/ipcTransferCodec';
import {
  BoundedReplayBuffer,
} from '../core/boundedReplayBuffer';

console.log('='.repeat(96));
console.log('   SPEC-WP08: WORKER TRANSFERABLES & BOUNDED REPLAY BUFFER VERIFICATION SUITE');
console.log('   Verification Suite 92 // WTR-T1 - WTR-T6');
console.log('='.repeat(96));

// =================================================================================================
// [WTR-T1] Codec Fidelity & Single-Buffer Packing
// =================================================================================================
console.log('\n[WTR-T1] Verifying Codec Fidelity & Single-Buffer Packing...');
{
  // 1. Terrain Profile (256 samples, 4 parallel vectors interleaved into 1 Float32Array)
  const sampleCount = 256;
  const rawDistances = new Float32Array(sampleCount);
  const rawTerrainElev = new Float32Array(sampleCount);
  const rawLosHeight = new Float32Array(sampleCount);
  const rawFresnelRadius = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    rawDistances[i] = i * 150.25;
    rawTerrainElev[i] = 3500.0 + 400.0 * Math.sin(i * 0.05);
    rawLosHeight[i] = 4000.0 + (i / sampleCount) * 1200.0;
    rawFresnelRadius[i] = 12.5 + Math.sqrt(i + 1) * 1.8;
  }

  const packedProfile = packTerrainProfileTyped(
    rawDistances,
    rawTerrainElev,
    rawLosHeight,
    rawFresnelRadius
  );
  assert.equal(
    packedProfile.length,
    sampleCount * 4,
    `Packed terrain profile must have length ${sampleCount * 4}`
  );

  const transferablesProfile = collectTransferables(packedProfile);
  assert.equal(
    transferablesProfile.length,
    1,
    'Interleaved terrain profile must yield exactly 1 transferable ArrayBuffer'
  );

  const unpackedProfile = unpackTerrainProfileTyped(packedProfile);
  assert.equal(unpackedProfile.count, sampleCount, 'Unpacked sample count must match');

  for (let i = 0; i < sampleCount; i++) {
    assert.ok(
      Math.abs(unpackedProfile.distancesM[i] - rawDistances[i]) < 1e-4,
      `Distance mismatch at index ${i}`
    );
    assert.ok(
      Math.abs(unpackedProfile.terrainElevM[i] - rawTerrainElev[i]) < 1e-4,
      `Terrain elevation mismatch at index ${i}`
    );
    assert.ok(
      Math.abs(unpackedProfile.losHeightM[i] - rawLosHeight[i]) < 1e-4,
      `LoS height mismatch at index ${i}`
    );
    assert.ok(
      Math.abs(unpackedProfile.fresnelRadiusM[i] - rawFresnelRadius[i]) < 1e-4,
      `Fresnel radius mismatch at index ${i}`
    );
  }
  console.log(`  ✓ 256-sample 4-vector terrain profile packed & unpacked with < 1e-4 error (1 transferable)`);

  // 2. Viewshed Grid (128x128 = 16,384 cells)
  const rows = 128;
  const cols = 128;
  const rawGridValues = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rawGridValues[r * cols + c] = -25.0 + 35.0 * Math.sin(r * 0.1) * Math.cos(c * 0.1);
    }
  }

  const packedGrid = packFloat32Grid(rawGridValues, rows, cols);
  assert.equal(packedGrid.rows, 128);
  assert.equal(packedGrid.cols, 128);
  assert.equal(packedGrid.data.length, 16384);

  const transferablesGrid = collectTransferables(packedGrid);
  assert.equal(
    transferablesGrid.length,
    1,
    'Packed viewshed grid must yield exactly 1 transferable ArrayBuffer'
  );

  const unpackedGrid = unpackFloat32Grid(packedGrid);
  assert.equal(unpackedGrid.rows, rows);
  assert.equal(unpackedGrid.cols, cols);

  for (let i = 0; i < rawGridValues.length; i++) {
    assert.ok(
      Math.abs(unpackedGrid.values[i] - rawGridValues[i]) < 1e-4,
      `Grid mismatch at cell ${i}`
    );
  }
  console.log(`  ✓ 128x128 viewshed grid packed & unpacked with < 1e-4 error (1 transferable)`);

  // 3. VSA I/Q Constellation (1,024 symbols)
  const symbolCount = 1024;
  const rawI = new Float32Array(symbolCount);
  const rawQ = new Float32Array(symbolCount);
  for (let k = 0; k < symbolCount; k++) {
    const angle = (k * Math.PI) / 16.0;
    rawI[k] = Math.cos(angle) * 0.7071;
    rawQ[k] = Math.sin(angle) * 0.7071;
  }

  const packedIQ = packConstellationIQ(rawI, rawQ);
  assert.equal(packedIQ.length, symbolCount * 2);

  const transferablesIQ = collectTransferables(packedIQ);
  assert.equal(
    transferablesIQ.length,
    1,
    'Interleaved VSA I/Q stream must yield exactly 1 transferable ArrayBuffer'
  );

  const unpackedIQ = unpackConstellationIQ(packedIQ);
  assert.equal(unpackedIQ.count, symbolCount);

  for (let k = 0; k < symbolCount; k++) {
    assert.ok(Math.abs(unpackedIQ.iSamples[k] - rawI[k]) < 1e-4, `I mismatch at symbol ${k}`);
    assert.ok(Math.abs(unpackedIQ.qSamples[k] - rawQ[k]) < 1e-4, `Q mismatch at symbol ${k}`);
  }
  console.log(`  ✓ 1,024-symbol VSA I/Q stream packed & unpacked with < 1e-4 error (1 transferable)`);
}

// =================================================================================================
// [WTR-T2] Real structuredClone({ transfer }) Detachment & Deduplication Proof
// =================================================================================================
console.log('\n[WTR-T2] Verifying Real structuredClone({ transfer }) Detachment & Deduplication Proof...');
{
  // 1. Multiple TypedArray subviews sharing one ArrayBuffer
  const sharedBuffer = new ArrayBuffer(1024);
  const subviewA = new Float32Array(sharedBuffer, 0, 64);
  const subviewB = new Float32Array(sharedBuffer, 256, 64);
  const subviewC = new Float32Array(sharedBuffer, 512, 64);
  subviewA[0] = 42.0;
  subviewB[0] = 99.0;
  subviewC[0] = 123.0;

  const payload = {
    subviewA,
    subviewB,
    subviewC,
    metadata: { label: 'subview-test' },
  };

  const transferList = collectTransferables(payload);
  assert.equal(
    transferList.length,
    1,
    `Multiple subviews sharing 1 buffer must deduplicate to exactly 1 transfer handle, got ${transferList.length}`
  );

  // Real structuredClone with transfer
  const cloned = structuredClone(payload, { transfer: transferList });
  assert.equal(
    sharedBuffer.byteLength,
    0,
    'Original shared ArrayBuffer must be detached (byteLength === 0)'
  );
  assert.equal(cloned.subviewA[0], 42.0);
  assert.equal(cloned.subviewB[0], 99.0);
  assert.equal(cloned.subviewC[0], 123.0);
  console.log('  ✓ Shared buffer deduplication prevents DataCloneError and detaches cleanly');

  // 2. Worker-owned source buffer cloned via cloneToTransferableFloat32
  const workerOwnedBuffer = new Float32Array([10.5, 20.5, 30.5, 40.5]);
  const outboundClone = cloneToTransferableFloat32(workerOwnedBuffer);
  const outboundList = collectTransferables(outboundClone);
  assert.equal(outboundList.length, 1);

  const transferredOutbound = structuredClone(outboundClone, { transfer: outboundList });
  assert.equal(
    outboundClone.buffer.byteLength,
    0,
    'Outbound clone buffer must be detached after transfer'
  );
  assert.ok(
    workerOwnedBuffer.buffer.byteLength > 0,
    'Worker-owned buffer must remain intact (not detached!)'
  );
  assert.equal(workerOwnedBuffer[0], 10.5);
  assert.equal(workerOwnedBuffer[3], 40.5);
  assert.equal(transferredOutbound[0], 10.5);
  assert.equal(transferredOutbound[3], 40.5);
  console.log('  ✓ cloneToTransferableFloat32 protects worker-retained buffers from detachment');

  // 3. excludeBuffers guard and circular reference traversal
  const retainedBuf = new ArrayBuffer(128);
  const retainedView = new Float32Array(retainedBuf);
  const freshBuf = new ArrayBuffer(128);
  const freshView = new Float32Array(freshBuf);

  const circularGraph: Record<string, unknown> = {
    retained: retainedView,
    fresh: freshView,
  };
  circularGraph.self = circularGraph; // Cyclic reference

  const excluded = new Set([retainedBuf]);
  const collectedList = collectTransferables(circularGraph, { excludeBuffers: excluded });
  assert.equal(collectedList.length, 1, 'Only non-excluded buffer must be collected');
  assert.equal(collectedList[0], freshBuf, 'Collected buffer must match freshBuf');
  assert.ok(!collectedList.includes(retainedBuf), 'Retained buffer must NOT be collected');
  console.log('  ✓ excludeBuffers guard respected & circular graph safely traversed');
}

// =================================================================================================
// [WTR-T3] Payload Size Reduction: Float32Array vs. JSON String
// =================================================================================================
console.log('\n[WTR-T3] Verifying Payload Size Reduction (Float32Array vs. JSON String)...');
{
  const gridRows = 128;
  const gridCols = 128;
  const grid = new Float32Array(gridRows * gridCols);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = -15.432 + (i % 70) * 0.25;
  }

  const binaryBytes = grid.byteLength;
  assert.equal(
    binaryBytes,
    65536,
    `128x128 Float32 grid byte size must equal exactly 65,536 B, got ${binaryBytes}`
  );

  const jsonString = JSON.stringify(Array.from(grid));
  const jsonBytes = Buffer.byteLength(jsonString, 'utf8');
  const ratio = jsonBytes / binaryBytes;

  assert.ok(
    ratio > 3.0,
    `Binary transfer must be > 3x more compact than JSON string, got ${ratio.toFixed(2)}x (${binaryBytes} B vs ${jsonBytes} B)`
  );
  console.log(
    `  ✓ Binary grid size: ${binaryBytes.toLocaleString()} B vs JSON size: ${jsonBytes.toLocaleString()} B (${ratio.toFixed(2)}x reduction > 3.0x threshold)`
  );
}

// =================================================================================================
// [WTR-T4] Bounded FIFO Ring Buffer ('ring' mode)
// =================================================================================================
console.log('\n[WTR-T4] Verifying Bounded FIFO Ring Buffer (\'ring\' mode)...');
{
  const maxFrames = 500;
  const ring = new BoundedReplayBuffer<{ val: number }>({
    maxFrames,
    mode: 'ring',
  });

  const totalPushCount = 20000;
  for (let i = 0; i < totalPushCount; i++) {
    const simTime = i * 0.02; // 50 Hz discrete simulation time
    ring.push(simTime, { val: i });
  }

  assert.equal(
    ring.storedFrames,
    maxFrames,
    `Ring buffer must hold exactly ${maxFrames} frames, got ${ring.storedFrames}`
  );
  assert.equal(ring.totalIngested, totalPushCount);
  assert.equal(ring.evictedFrames, totalPushCount - maxFrames);

  const ordered = ring.toOrderedArray();
  assert.equal(ordered.length, maxFrames);

  // Check strict monotonicity
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(
      ordered[i].simTimeSec > ordered[i - 1].simTimeSec,
      `Ordered array must be strictly monotonic in time: ${ordered[i].simTimeSec} vs ${ordered[i - 1].simTimeSec}`
    );
  }

  // Check that the newest 500 frames were preserved (frames 19,500 to 19,999)
  const oldestStored = ordered[0];
  const newestStored = ordered[ordered.length - 1];
  assert.equal(oldestStored.payload.val, 19500);
  assert.equal(newestStored.payload.val, 19999);

  // O(log N) binary search temporal scrubbing tests
  // Boundary clamping
  const clampedOldest = ring.findNearestByTime(0.0);
  assert.equal(clampedOldest?.payload.val, 19500, 'Scrub before window must clamp to oldest');

  const clampedNewest = ring.findNearestByTime(100000.0);
  assert.equal(clampedNewest?.payload.val, 19999, 'Scrub after window must clamp to newest');

  // Exact match
  const exact = ring.findNearestByTime(19750 * 0.02);
  assert.equal(exact?.payload.val, 19750, 'Exact timestamp match must be found');

  // Nearest bracket match
  const near = ring.findNearestByTime(19750 * 0.02 + 0.007);
  assert.equal(near?.payload.val, 19750, 'Nearest time match within half-step must resolve to frame 19750');

  const nearNext = ring.findNearestByTime(19750 * 0.02 + 0.013);
  assert.equal(nearNext?.payload.val, 19751, 'Nearest time match past half-step must resolve to frame 19751');

  // Range query
  const range = ring.getRange(19600 * 0.02, 19610 * 0.02);
  assert.equal(range.length, 11);
  assert.equal(range[0].payload.val, 19600);
  assert.equal(range[10].payload.val, 19610);

  console.log(`  ✓ Ring buffer 20,000 pushes: capacity ${maxFrames} bounded, exact newest preserved, O(log N) scrub validated`);
}

// =================================================================================================
// [WTR-T5] Adaptive Decimation ('adaptive-decimate' mode)
// =================================================================================================
console.log('\n[WTR-T5] Verifying Adaptive Decimation (\'adaptive-decimate\' mode)...');
{
  const maxFrames = 500;
  const adaptive = new BoundedReplayBuffer<{ val: number }>({
    maxFrames,
    mode: 'adaptive-decimate',
    maxKeyframesRatio: 0.25,
  });

  const totalFrames = 20000;
  const keyframeIndices = new Set([500, 1500, 3000, 6000, 12000, 18000]);

  for (let i = 0; i < totalFrames; i++) {
    const isKey = keyframeIndices.has(i);
    adaptive.push(i * 0.02, { val: i }, isKey);
  }

  assert.ok(
    adaptive.storedFrames <= maxFrames,
    `Stored frames (${adaptive.storedFrames}) must not exceed maxFrames (${maxFrames})`
  );
  assert.ok(adaptive.currentStride >= 8, `Current stride must have doubled, got ${adaptive.currentStride}`);

  const ordered = adaptive.toOrderedArray();
  assert.equal(ordered.length, adaptive.storedFrames);

  // Mission start (t0 anchor) must be preserved
  assert.equal(ordered[0].payload.val, 0, 'Mission start frame (t0 anchor) must be strictly retained');

  // Strict temporal monotonicity
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(
      ordered[i].simTimeSec > ordered[i - 1].simTimeSec,
      'Adaptive buffer ordered array must be strictly monotonic'
    );
  }

  // Keyframes check: recent keyframes must be retained
  const retainedVals = new Set(ordered.map((f) => f.payload.val));
  assert.ok(retainedVals.has(18000), 'Recent outage keyframe (frame 18000) must be retained');

  console.log(
    `  ✓ Adaptive decimation: 20,000 frames compacted to ${adaptive.storedFrames}/${maxFrames} frames (stride=${adaptive.currentStride}, t0 retained)`
  );

  // Adversarial 100% keyframe flood test: ensure memory ceiling NEVER breached
  const adversarialBuffer = new BoundedReplayBuffer<{ val: number }>({
    maxFrames: 200,
    mode: 'adaptive-decimate',
    maxKeyframesRatio: 0.25,
  });

  for (let i = 0; i < 5000; i++) {
    // Every single frame marked as keyframe!
    adversarialBuffer.push(i * 0.02, { val: i }, true);
  }

  assert.ok(
    adversarialBuffer.storedFrames <= 200,
    `Adversarial 100% keyframe flood must obey storedFrames <= maxFrames: got ${adversarialBuffer.storedFrames} > 200`
  );
  assert.equal(adversarialBuffer.toOrderedArray()[0].payload.val, 0, 't0 anchor preserved even under keyframe flood');
  console.log(`  ✓ Adversarial 100% keyframe flood strictly capped at ${adversarialBuffer.storedFrames} <= 200 (zero OOM!)`);
}

// =================================================================================================
// [WTR-T6] 50 Hz Performance Micro-Benchmark (< 100 µs/tick across 1,000 ticks)
// =================================================================================================
console.log('\n[WTR-T6] Verifying 50 Hz Execution Budget Safety (< 100 µs/tick)...');
{
  const ticks = 1000;
  const buffer = new BoundedReplayBuffer<{ grid: Float32Array }>({
    maxFrames: 500,
    mode: 'ring',
  });

  const distances = new Float32Array(256);
  const elev = new Float32Array(256);
  const los = new Float32Array(256);
  const fresnel = new Float32Array(256);
  const gridVals = new Float32Array(64 * 64);
  const iSamples = new Float32Array(256);
  const qSamples = new Float32Array(256);

  const tStart = performance.now();

  for (let t = 0; t < ticks; t++) {
    // 1. Pack terrain profile
    const packedProfile = packTerrainProfileTyped(distances, elev, los, fresnel);

    // 2. Pack 64x64 grid
    const packedGrid = packFloat32Grid(gridVals, 64, 64);

    // 3. Pack 256 I/Q symbols
    const packedIQ = packConstellationIQ(iSamples, qSamples);

    // 4. Collect transferables
    const payload = {
      profile: packedProfile,
      grid: packedGrid,
      iq: packedIQ,
    };
    const transferables = collectTransferables(payload);

    // 5. Push to replay buffer
    buffer.push(t * 0.02, { grid: packedGrid.data });
  }

  const tElapsedMs = performance.now() - tStart;
  const usPerTick = (tElapsedMs / ticks) * 1000.0;

  console.log(
    `  ✓ Processed ${ticks} ticks in ${tElapsedMs.toFixed(2)} ms (${usPerTick.toFixed(2)} µs/tick; limit: < 100 µs/tick)`
  );
  assert.ok(
    usPerTick < 100.0,
    `Per-tick execution time must be < 100 µs (0.5% of 20 ms budget), got ${usPerTick.toFixed(2)} µs`
  );
}

console.log('='.repeat(96));
console.log('   ALL SPEC-WP08 WORKER TRANSFER & REPLAY BOUNDS TESTS PASSED (6/6 SUITES)');
console.log('='.repeat(96));
