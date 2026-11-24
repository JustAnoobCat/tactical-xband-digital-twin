import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateUuidV4 } from '../core/nodeRegistry.ts';
import { parseMissionScenarioJson } from '../core/militaryGisEngine.ts';
import {
  parseByteRangeHeader,
  MAX_OFFLINE_TILE_CHUNK_BYTES,
} from '../core/offlineTileProtocol.ts';
import {
  computeParametricSensitivityCurve,
  evaluateParametricSensitivity,
} from '../core/parametricSensitivity.ts';
import { FQCoDelQueue, GroundNodeTrafficSubsystem, Packet } from '../core/queues.ts';
import { TerrainAwareDynamicScheduler, ReactiveMlwdfScheduler } from '../core/scheduler.ts';
import { TerrainEngine } from '../core/terrain.ts';
import { ACNTrajectoryEngine } from '../core/trajectory.ts';
import { PolarViewshedEngine } from '../core/viewshedEngine.ts';
import { RFConfig, EnvironmentConfig, ACNFlightConfig } from '../core/config.ts';
import type { LinkStatus, PredictiveState } from '../shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Audit remediation unit tests', () => {
  it('generateUuidV4 uses deterministic non-Math.random fallback without Math.random calls in nodeRegistry', () => {
    const src = fs.readFileSync(path.join(ROOT_DIR, 'src', 'core', 'nodeRegistry.ts'), 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(codeOnly.includes('Math.random'), false, 'nodeRegistry.ts code must not call Math.random()');
    const id1 = generateUuidV4();
    const id2 = generateUuidV4();
    assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(id1, id2);
  });

  it('parseMissionScenarioJson blocks unicode-escaped prototype pollution keys while allowing benign strings and enforcing array caps', () => {
    const protoAttempt = parseMissionScenarioJson(
      '{"schemaVersion":"xband-dt-scenario-v3","\\u005f\\u005fproto\\u005f\\u005f":{"polluted":true}}',
    );
    assert.equal(protoAttempt.ok, false);
    assert.match(protoAttempt.error || '', /forbidden key/i);

    const valid = parseMissionScenarioJson(
      JSON.stringify({
        schemaVersion: 'xband-dt-scenario-v3',
        title: 'Mountain road constructor convoy',
        nodes: [{ nodeId: 1, name: 'S1', xM: 0, yM: 0, aglM: 2, role: 'soldier' }],
      }),
    );
    assert.equal(valid.ok, true, valid.error);
    assert.equal(valid.scenario?.title, 'Mountain road constructor convoy');
    assert.equal(valid.scenario?.nodes.length, 1);

    const hugeNodes = Array.from({ length: 300 }, (_, i) => ({
      nodeId: i + 1,
      name: `S${i + 1}`,
      xM: i * 10,
      yM: 0,
      aglM: 2,
      role: 'soldier',
    }));
    const capped = parseMissionScenarioJson(
      JSON.stringify({ schemaVersion: 'xband-dt-scenario-v3', nodes: hugeNodes }),
    );
    assert.equal(capped.ok, true);
    assert.ok((capped.scenario?.nodes.length ?? 0) <= 256, 'Node list must be capped at 256');
    assert.ok(capped.warnings.some((w) => /truncat|cap|256/i.test(w)));
  });

  it('parseByteRangeHeader rejects oversized range requests with 413 before allocation', () => {
    const oversized = parseByteRangeHeader('bytes=0-99999999', 100 * 1024 * 1024);
    assert.equal(oversized.ok, false);
    if (!oversized.ok) {
      assert.equal(oversized.status, 413);
    }

    const valid = parseByteRangeHeader('bytes=0-4095', 100 * 1024 * 1024);
    assert.equal(valid.ok, true);
    if (valid.ok) {
      assert.equal(valid.start, 0);
      assert.equal(valid.end, 4095);
      assert.equal(valid.chunkLength, 4096);
      assert.ok(valid.chunkLength <= MAX_OFFLINE_TILE_CHUNK_BYTES);
    }
  });

  it('computeParametricSensitivityCurve is physics-backed and responds to live RF bandwidth and rain rate', () => {
    const clearCurve = computeParametricSensitivityCurve('traffic_load', {
      rfConfig: new RFConfig({ channelBandwidthHz: 10e6 }),
      envConfig: new EnvironmentConfig({ rainRateMmH: 0 }),
    });
    const heavyRainNarrowCurve = computeParametricSensitivityCurve('traffic_load', {
      rfConfig: new RFConfig({ channelBandwidthHz: 2e6 }),
      envConfig: new EnvironmentConfig({ rainRateMmH: 45 }),
    });
    assert.ok(clearCurve.points.length >= 5);
    assert.ok(
      clearCurve.points[clearCurve.points.length - 1].tacGoodputMbps >
        heavyRainNarrowCurve.points[heavyRainNarrowCurve.points.length - 1].tacGoodputMbps,
      'Higher bandwidth and clear weather should yield strictly higher peak goodput',
    );

    const pt = evaluateParametricSensitivity('traffic_load', 3.5);
    assert.ok(pt.tacGoodputMbps >= pt.reactiveGoodputMbps);
    assert.ok(pt.reactiveGoodputMbps >= pt.staticGoodputMbps);
  });

  it('FQCoDelQueue.requeueForHarq retains undecoded packets without inflating totalEnqueued', () => {
    const q = new FQCoDelQueue(400, 120);
    const pkt = new Packet(101, 1, 69, 1200, 0.0, 60.0);
    const [accepted] = q.enqueue(pkt);
    assert.equal(accepted, true);
    assert.equal(q.totalEnqueued, 1);

    const served = q.dequeue(1200, 0.02);
    assert.equal(served.length, 1);
    assert.equal(q.getTotalBacklogBytes(), 0);

    q.requeueForHarq(served);
    assert.equal(q.totalEnqueued, 1, 'totalEnqueued must not double-count HARQ retries');
    assert.equal(q.getTotalBacklogBytes(), 1200, 'Undecoded packet must remain in queue');
  });

  it('TerrainAwareDynamicScheduler applies guardScale and retains packets on CQI decode failure', () => {
    const sched = new TerrainAwareDynamicScheduler();
    const node = new GroundNodeTrafficSubsystem(1, 'soldier', [1000, 1000, 3500], 42);
    node.queue.enqueue(new Packet(1, 1, 65, 160, 0.0, 0.5));

    const link: LinkStatus = {
      nodeId: 1,
      slantRangeM: 12000,
      fsplDb: 132,
      diffractionLossDb: 0,
      gaseousLossDb: 0.2,
      rainLossDb: 0,
      rxPowerDbm: -80,
      noiseFloorDbm: -102,
      snrDb: 12.0,
      modcodName: '16APSK-2/3',
      spectralEfficiencyBpsHz: 2.6,
      dataRateBps: 2.6e6,
      isLos: true,
      isOutage: false,
      terrainBulgeM: 2.0,
      maxFresnelIntrusion: 0,
      inCoverage: true,
    };
    const pred: PredictiveState = {
      nodeId: 1,
      timeToOcclusionS: 10.0,
      occlusionImminent: false,
      horizonClear: true,
    };

    const res = sched.scheduleFrame(
      1,
      0.02,
      [node],
      new Map([[1, link]]),
      new Map([[1, pred]]),
      0,
      {
        nodeGuardScale: new Map([[1, 0.9]]),
        nodeDelayedCqiSnrDb: new Map([[1, 18.0]]),
      },
    );

    assert.equal(res.totalPayloadBitsDequeued, 0, 'CQI decode failure must not count as delivered payload');
    assert.equal(node.queue.getTotalBacklogBytes(), 160, 'Undecoded packet must be retained in queue for HARQ');

    // Verify ReactiveMlwdfScheduler also delivers cleanly in Pass-2 without artificial 4ms cap
    const reactive = new ReactiveMlwdfScheduler();
    const node2 = new GroundNodeTrafficSubsystem(2, 'soldier', [1000, 1000, 3500], 42);
    for (let i = 0; i < 6; i++) {
      node2.queue.enqueue(new Packet(10 + i, 2, 67, 1200, 0.0, 0.5));
    }
    const reactiveRes = reactive.scheduleFrame(
      1,
      0.02,
      [node2],
      new Map([[2, { ...link, nodeId: 2, dataRateBps: 4e6 }]]),
      new Map([[2, { ...pred, nodeId: 2 }]]),
      0,
    );
    assert.ok(reactiveRes.totalUlScheduledS > 0.005, 'Reactive Pass-2 must allow work-conserving airtime beyond 4ms');
  });

  it('PolarViewshedEngine.computeOptimalRelayPlacement uses real thermal noise and reacts to EW jammer', () => {
    const terrain = new TerrainEngine({ terrainMode: 'synthetic' });
    const traj = new ACNTrajectoryEngine(new ACNFlightConfig());
    const viewshed = new PolarViewshedEngine();
    const rf = new RFConfig({ channelBandwidthHz: 5e6 });
    const envClear = new EnvironmentConfig({ jammerEnabled: false });
    const envJammed = new EnvironmentConfig({ jammerEnabled: true, jammerEirpDbm: 78.0 });

    const groundNodes = [
      { nodeId: 1, position: [2000, 1500, terrain.getElevation(2000, 1500) + 2] as [number, number, number] },
      { nodeId: 2, position: [-2500, 1000, terrain.getElevation(-2500, 1000) + 2] as [number, number, number] },
    ];

    const clearRec = viewshed.computeOptimalRelayPlacement(traj, terrain, groundNodes, rf, envClear, 6);
    const jammedRec = viewshed.computeOptimalRelayPlacement(traj, terrain, groundNodes, rf, envJammed, 6);

    assert.equal(Number.isFinite(clearRec.meanSinrToAcnDb), true);
    assert.equal(Number.isFinite(jammedRec.meanSinrToAcnDb), true);
    assert.ok(
      clearRec.meanSinrToAcnDb > jammedRec.meanSinrToAcnDb,
      `Active jammer should degrade relay orbit SINR (clear=${clearRec.meanSinrToAcnDb.toFixed(2)}, jammed=${jammedRec.meanSinrToAcnDb.toFixed(2)})`,
    );
  });
});
