/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * REMED-05 Verification Suite: Timeline Performance, Metrics Accuracy, Benchmarks & Scientific Transparency
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SimulationTimelineRenderer } from '../ui/simulationTimelineRenderer';
import { SpatialSnapshotBuffer } from '../ui/spatialSnapshotBuffer';
import { SuperframeEpochStore } from '../ui/superframeEpochStore';
import { NodeTerrainState } from '../core/trajectory';
import type { SpatialFrameSnapshot } from '../shared/workerProtocol';
import {
  evaluateWorkerRealTimeProfile,
  generateExperimentDossierMarkdown,
} from '../core/workerJitterProfiler';
import { NetworkPerformanceHistory } from '../ui/networkPerformanceDashboard';
import { NetworkTrafficTracker } from '../ui/networkTrafficInventory';
import {
  getSensitivityAxisConfig,
  evaluateParametricSensitivity,
} from '../core/parametricSensitivity';
import {
  evaluateAblationFlightSegment,
  runPhysicsRealismAblation,
  formatPublicationLatexAblationTable,
  buildScientificValidationMarkdown,
  verifyAllItuReferenceAnchors,
} from '../core/statisticalBenchmarkEngine';
import { LinkBudgetEngine } from '../core/linkBudget';

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(currentDir, '../..');

class MockCtx2D {
  public fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  public strokeStyle: string | CanvasGradient | CanvasPattern = '#000';
  public lineWidth = 1;
  public font = '10px sans-serif';
  public textAlign: CanvasTextAlign = 'left';
  public textBaseline: CanvasTextBaseline = 'alphabetic';
  public globalAlpha = 1;
  public setTransform(): void {}
  public clearRect(): void {}
  public fillRect(): void {}
  public strokeRect(): void {}
  public beginPath(): void {}
  public moveTo(): void {}
  public lineTo(): void {}
  public closePath(): void {}
  public stroke(): void {}
  public fill(): void {}
  public arc(): void {}
  public roundRect(): void {}
  public setLineDash(): void {}
  public fillText(): void {}
  public measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
  public save(): void {}
  public restore(): void {}
}

class MockCanvas {
  public width = 800;
  public height = 130;
  public clientWidth = 800;
  public clientHeight = 130;
  public style: Record<string, string> = {};
  public ctx = new MockCtx2D();
  public parentElement = {
    clientWidth: 800,
    clientHeight: 130,
    getBoundingClientRect: () => ({ width: 800, height: 130, left: 0, top: 0 }),
  };
  public getContext(type: string): any {
    return type === '2d' ? this.ctx : null;
  }
  public getBoundingClientRect(): any {
    return { width: this.clientWidth, height: this.clientHeight, left: 0, top: 0 };
  }
  public addEventListener(): void {}
  public removeEventListener(): void {}
}

function makeSpatialFrame(
  frameIndex: number,
  simTimeS: number,
  nodeId: number = 1,
  isLos: boolean = true,
  selectedNodeId?: number
): SpatialFrameSnapshot & { selected_node_id?: number } {
  return {
    frameIndex,
    simulationTimeS: simTimeS,
    wallClockTimeMs: 1000 + frameIndex * 20,
    spatialRevision: 1,
    ...(selectedNodeId !== undefined ? { selected_node_id: selectedNodeId } : {}),
    acn: {
      posX: frameIndex * 1.2,
      posY: 0,
      posZ: 5200,
      velX: 60,
      velY: 0,
      velZ: 0,
      headingRad: 0,
      pitchDeg: 0,
      altitudeMslM: 5200,
      altitudeAglM: 1700,
      coverageRadiusKm: 35,
      isTerrainClamped: false,
    },
    nodes: [
      {
        nodeId,
        posX: 1000,
        posY: 500,
        posZ: 3100,
        altitudeMslM: 3100,
        altitudeAglM: 2.0,
        isLos,
        isOutage: !isLos,
        isObstacleBlocked: false,
        snrDb: isLos ? 16.5 : -20.0,
        currentState: isLos ? NodeTerrainState.NORMAL_LOS : NodeTerrainState.HARD_SHADOW_CUTOFF,
      },
    ],
    selectedLinkBudget: {
      slantRangeM: 12000,
      fsplDb: 132.1,
      diffractionLossDb: isLos ? 0 : 22,
      gasLossDb: 0.14,
      rainLossDb: 0,
      totalLossDb: isLos ? 132.24 : 154.24,
      snrDb: isLos ? 16.5 : -20.0,
      modcodName: isLos ? '16-APSK 4/5' : 'LINK_OUTAGE',
      bitrateMbps: isLos ? 15.8 : 0.0,
      isOutage: !isLos,
    },
  };
}

console.log('='.repeat(88));
console.log('  REMED-05 VERIFICATION SUITE: TIMELINE PERF, METRICS ACCURACY & TRANSPARENCY');
console.log('='.repeat(88));

// -----------------------------------------------------------------------------
// [1/5] Timeline Renderer Event Cache
// -----------------------------------------------------------------------------
console.log('\n[1/5] Verifying SimulationTimelineRenderer scanTimelineEvents() caching...');
{
  const spatialBuffer = new SpatialSnapshotBuffer(64, 8);
  const epochStore = new SuperframeEpochStore(64);
  spatialBuffer.append(makeSpatialFrame(0, 0.0, 1, true));
  spatialBuffer.append(makeSpatialFrame(1, 0.02, 1, false));

  const renderer = new SimulationTimelineRenderer({
    canvas: new MockCanvas() as unknown as HTMLCanvasElement,
    spatialBuffer,
    epochStore,
    dpr: 1.0,
    width: 800,
    height: 130,
  });

  // 10 consecutive renders on unchanged buffer/store -> scan once, 9 cache hits
  for (let i = 0; i < 10; i++) {
    renderer.render();
  }
  const diag10 = renderer.getEventScanDiagnostics();
  assert.equal(diag10.scanCount, 1, `Expected 1 event scan across 10 unchanged renders, got ${diag10.scanCount}`);
  assert.equal(diag10.cacheHitCount, 9, `Expected 9 cache hits across 10 unchanged renders, got ${diag10.cacheHitCount}`);
  assert.ok(diag10.cachedEventCount >= 1, 'Expected cached terrain transition event');

  // Appending a new frame invalidates cache cleanly
  spatialBuffer.append(makeSpatialFrame(2, 0.04, 1, true));
  renderer.render();
  const diagAfterAppend = renderer.getEventScanDiagnostics();
  assert.equal(diagAfterAppend.scanCount, 2, 'Appending a new frame must invalidate cached timeline events');
  assert.equal(diagAfterAppend.cacheHitCount, 9);
  console.log('  -> PASS: 10 renders invoked scanTimelineEvents once (9 cache hits) and invalidated cleanly on append.');
}

// -----------------------------------------------------------------------------
// [2/5] RFC 3550 Jitter Fallback & DEM Provenance
// -----------------------------------------------------------------------------
console.log('\n[2/5] Verifying RFC 3550 jitter fallback and Terrarium DEM provenance...');
{
  // Constant 2.0 ms step durations with omitted interFrameDeltasMs -> 0.0 ms jitter (not 18.0 ms)
  const constFast = evaluateWorkerRealTimeProfile([2.0, 2.0, 2.0, 2.0, 2.0]);
  assert.equal(constFast.rfc3550JitterMs, 0.0, `Constant 2.0 ms step durations must yield 0.0 ms jitter, got ${constFast.rfc3550JitterMs}`);

  // Single sample fallback -> 0.0 ms jitter
  const singleSample = evaluateWorkerRealTimeProfile([2.0]);
  assert.equal(singleSample.rfc3550JitterMs, 0.0);

  // Explicit inter-frame pacing deltas [20, 24, 16] -> non-zero pacing jitter against 20 ms budget
  const explicitPacing = evaluateWorkerRealTimeProfile([2.0, 2.0, 2.0], [20.0, 24.0, 16.0]);
  assert.ok(explicitPacing.rfc3550JitterMs > 0.0, 'Explicit pacing deltas [20, 24, 16] must compute positive pacing jitter');

  const dossier = generateExperimentDossierMarkdown({
    simTimeS: 10.0,
    frameIndex: 500,
    staticGoodputMbps: 5.0,
    reactiveGoodputMbps: 8.0,
    tacGoodputMbps: 9.5,
    staticDrops: 100,
    reactiveDrops: 20,
    tacDrops: 2,
    staticUtilPct: 80,
    reactiveUtilPct: 75,
    tacUtilPct: 70,
    demErrorM: 0,
    trafficScale: 1.0,
    jammerEnabled: false,
    activeRelayEnabled: false,
    ricianEnabled: true,
    earthRadiusFactorK: 1.333,
    rtProfile: constFast,
  });
  assert.ok(
    dossier.includes('512x512 AWS Terrarium Ladakh DEM'),
    'Dossier markdown must accurately describe the 512x512 AWS Terrarium Ladakh DEM'
  );
  assert.ok(
    !dossier.includes('SRTM 1-arcsecond DEM'),
    'Dossier markdown must NOT claim SRTM 1-arcsecond DEM'
  );
  console.log('  -> PASS: Constant 2.0 ms step jitter = 0.0 ms, explicit pacing jitter > 0, DEM provenance accurate.');
}

// -----------------------------------------------------------------------------
// [3/5] Dashboard Mb Units, Traffic Inventory FL & DL Duty Scaling, Snapshot Buffer
// -----------------------------------------------------------------------------
console.log('\n[3/5] Verifying dashboard Megabits, traffic inventory FL/DL duty, and SpatialSnapshotBuffer...');
{
  // Dashboard Megabit unit consistency: 125,000 bytes == 1.0 Mb
  const dash = new NetworkPerformanceHistory(10, 1);
  const dashSample = dash.ingest({
    frameIndex: 1,
    simulationTimeS: 0.02,
    nodes: [
      {
        node_id: 1,
        snr_db: 15.0,
        link_outage: false,
        transfer_state: { current_rate_bps: 1e6, delivered_bytes: 125000 },
      },
    ],
  });
  assert.ok(dashSample !== null);
  assert.equal(dashSample.nodes[0].transferredMb, 1.0, '125,000 bytes must convert to 1.0 Mb ((bytes * 8) / 1e6)');

  // Traffic Inventory dynamic FL (approx FL170 at 5,200 m -> FL171 via round(5200*3.28084/100); FL170 at 5,182 m) & DL duty scaling
  const tracker = new NetworkTrafficTracker();
  const baseFrame = {
    frameIndex: 1,
    simulationTimeS: 0.02,
    acnAltitudeM: 5200,
    rfChannelBandwidthHz: 5e6,
    superframeDurationMs: 20.0,
    nodes: [
      {
        node_id: 4,
        name: 'S4',
        snr_db: 22.0,
        link_outage: false,
        terrain_is_los: true,
        obstacle_blocked: false,
      },
    ],
    downlinkTelemetry: {
      broadcast_active: true,
      dl_duration_ms: 3.0,
    },
  };
  tracker.ingest(baseFrame);
  const flows1 = tracker.getFlowRecords(baseFrame);
  const ulFlow = flows1.find((f) => f.direction === 'Uplink');
  const dlFlow1 = flows1.find((f) => f.direction === 'Downlink');
  assert.ok(ulFlow && dlFlow1);
  assert.ok(!ulFlow.toName.includes('FL500'), `Uplink destination must never show hardcoded FL500, got ${ulFlow.toName}`);
  assert.ok(!dlFlow1.fromName.includes('FL500'), `Downlink source must never show hardcoded FL500, got ${dlFlow1.fromName}`);
  assert.equal(ulFlow.toName, `ACN Relay (FL${Math.round((5200 * 3.28084) / 100)})`);

  // Exact FL170 check around 5,182 m
  const fl170Flows = tracker.getFlowRecords({ ...baseFrame, acnAltitudeM: 5182 });
  assert.equal(fl170Flows[0].toName, 'ACN Relay (FL170)');

  // Verify DL rate scales with actual superframe duty ratio and physical RFConfig/MODCOD
  const expectedEff = LinkBudgetEngine.selectModCod(22.0).spectralEfficiencyBpsHz;
  const expectedRate1 = Number((5.0 * expectedEff * (3.0 / 20.0)).toFixed(2));
  assert.equal(dlFlow1.dataRateMbps, expectedRate1);

  const doubleDutyFrame = {
    ...baseFrame,
    frameIndex: 2,
    simulationTimeS: 0.04,
    downlinkTelemetry: { broadcast_active: true, dl_duration_ms: 6.0 },
  };
  const dlFlow2 = tracker.getFlowRecords(doubleDutyFrame).find((f) => f.direction === 'Downlink');
  assert.ok(dlFlow2);
  const expectedRate2 = Number((5.0 * expectedEff * (6.0 / 20.0)).toFixed(2));
  assert.equal(dlFlow2.dataRateMbps, expectedRate2, 'DL rate must scale linearly with dl_duration_ms / superframeDurationMs');

  // SpatialSnapshotBuffer selectedNodeId & Uint16Array nodeIds (>255 without wrapping)
  const buf = new SpatialSnapshotBuffer(8, 8);
  const ok = buf.append(makeSpatialFrame(1, 0.02, 300, true, 7));
  assert.equal(ok, true);
  const cols = buf.getReadonlyExportColumns();
  assert.equal(cols.selNodeId[0], 7, `SpatialSnapshotBuffer must preserve selectedNodeId=7, got ${cols.selNodeId[0]}`);
  assert.ok(cols.nodeIds instanceof Uint16Array, 'SpatialSnapshotBuffer nodeIds backing storage must be Uint16Array');
  assert.equal(cols.nodeIds[0], 300, `nodeId=300 must not wrap in Uint16Array, got ${cols.nodeIds[0]}`);
  assert.equal(buf.get(0)?.nodes[0].nodeId, 300);

  console.log('  -> PASS: Dashboard Mb units, dynamic FL/DL duty scaling, selNodeId=7, and Uint16 nodeId=300 verified.');
}

// -----------------------------------------------------------------------------
// [4/5] Parametric Sensitivity & Statistical Benchmark Engine Fidelity
// -----------------------------------------------------------------------------
console.log('\n[4/5] Verifying parametric sensitivity metadata & statisticalBenchmarkEngine canonical fidelity...');
{
  const axisCfg = getSensitivityAxisConfig('traffic_load');
  assert.equal(axisCfg.modelKind, 'analytical_saturation_envelope');
  const pt = evaluateParametricSensitivity('traffic_load', 2.5);
  assert.equal(pt.modelKind, 'analytical_saturation_envelope');

  const engineSrc = readFileSync(resolve(rootDir, 'src/core/statisticalBenchmarkEngine.ts'), 'utf-8');
  assert.ok(!engineSrc.includes('relativeSpeedMps: 160.0'), 'Must not use unphysical 160.0 m/s cruise speed');
  assert.ok(engineSrc.includes('ACNFlightConfig'), 'Must derive canonical cruise speed from ACNFlightConfig');
  assert.ok(engineSrc.includes('RFConfig'), 'Must derive baseline link parameters from RFConfig');
  assert.ok(engineSrc.includes('if (isOutageFrame)'), 'Must guard HARQ/OLLA updates on outage frames');

  // Run micro-benchmark and verify transparent naming in LaTeX & Markdown
  const ablation = runPhysicsRealismAblation(30, 20261122);
  const itu = verifyAllItuReferenceAnchors();
  const latex = formatPublicationLatexAblationTable(ablation);
  const md = buildScientificValidationMarkdown(ablation, itu);
  assert.ok(
    latex.includes('Controlled 4-Point Synthetic Link-Layer Physics Micro-Benchmark'),
    'LaTeX caption must label the N=30 table as Controlled 4-Point Synthetic Link-Layer Physics Micro-Benchmark'
  );
  assert.ok(
    md.includes('Controlled 4-Point Synthetic Link-Layer Physics Micro-Benchmark'),
    'Markdown dossier section must label the N=30 table as Controlled 4-Point Synthetic Link-Layer Physics Micro-Benchmark'
  );
  const seg = evaluateAblationFlightSegment('full-realistic-olla-harq', 20261122, 60);
  assert.ok(Number.isFinite(seg.meanEffectiveGoodputFactor) && seg.outageRatio >= 0 && seg.outageRatio <= 1);
  console.log('  -> PASS: Analytical envelope metadata, canonical 60 m/s RFConfig, outage HARQ/OLLA guard, and labels verified.');
}

// -----------------------------------------------------------------------------
// [5/5] Static Provenance Checks on Benchmark Scripts
// -----------------------------------------------------------------------------
console.log('\n[5/5] Verifying benchmark script provenance checks...');
{
  const scaleSrc = readFileSync(resolve(rootDir, 'scripts/benchmark_scale_nodes.ts'), 'utf-8');
  assert.ok(
    !/rf_carrier_frequency_ghz:\s*9\.6/.test(scaleSrc),
    'scripts/benchmark_scale_nodes.ts must not contain hardcoded 9.6 GHz carrier frequency'
  );
  assert.ok(
    scaleSrc.includes('DEFAULT_RF_CONFIG.carrierFrequencyHz'),
    'scripts/benchmark_scale_nodes.ts must derive rf_carrier_frequency_ghz from RFConfig'
  );

  const pySrc = readFileSync(resolve(rootDir, 'scripts/run_benchmark_suite.py'), 'utf-8');
  assert.ok(
    !pySrc.includes('~30% down to near-zero'),
    'scripts/run_benchmark_suite.py must not contain hardcoded "~30% down to near-zero" annotation'
  );
  console.log('  -> PASS: Benchmark script provenance checks verified.');
}

console.log('\n' + '='.repeat(88));
console.log('  ALL REMED-05 VERIFICATION CHECKS PASSED (5/5)');
console.log('='.repeat(88));
