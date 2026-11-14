/**
 * src/tests/verifyActiveTwoHopRelay.ts
 *
 * Automated Verification Suite for Active Two-Hop Decode-and-Forward (DF) Tactical Mesh Relay.
 * Specification: docs/specs/SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH.md
 *
 * Test Suites:
 * - ATR-T1: Exact Harmonic Decode-and-Forward Capacity Formula & Timing Advance
 * - ATR-T2: Valley Outage Rescue via Ridgeline Relay
 * - ATR-T3: End-to-End Worker Packet Drop Reduction with Active Relay
 * - ATR-T4: DOM & Specification Persistence Check
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RFConfig, EnvironmentConfig, SPEED_OF_LIGHT } from '../core/config';
import { TerrainEngine } from '../core/terrain';
import { LinkBudgetEngine, LinkStatus } from '../core/linkBudget';
import { SimulationWorkerManager } from '../worker/simWorker';
import type { Position3D } from '../shared/types';

function close(actual: number, expected: number, tolerance = 1e-4, message?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `${message ? `${message}: ` : ''}expected ${expected} ± ${tolerance}, received ${actual} (diff: ${diff})`
  );
}

console.log('='.repeat(96));
console.log('   ACTIVE TWO-HOP DECODE-AND-FORWARD (DF) TACTICAL MESH RELAY VERIFICATION SUITE');
console.log('   Specification: SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH // ATR-T1 - ATR-T4');
console.log('='.repeat(96));

// =================================================================================================
// [ATR-T1] Exact Harmonic Decode-and-Forward Capacity Formula & Timing Advance
// =================================================================================================
console.log('\n[ATR-T1] Verifying Exact Harmonic Decode-and-Forward Capacity & Timing Advance...');
{
  const rHop1Bps = 30.0e6; // 30.0 Mbps
  const rHop2Bps = 60.0e6; // 60.0 Mbps
  const dHop1M = 5000.0;
  const dHop2M = 15000.0;

  const mockDirectOutage: LinkStatus = {
    nodeType: 'soldier',
    slantRangeM: 18000.0,
    fsplDb: 135.0,
    diffractionLossDb: 80.0,
    gasLossDb: 0.2,
    rainLossDb: 0.0,
    cableLossDb: 1.5,
    implementationMarginDb: 2.5,
    totalLossDb: 219.2,
    pTxDbm: 23.0,
    txGainDbi: 0.0,
    rxGainDbi: 15.0,
    prxDbm: -181.2,
    pNoiseDbm: -111.0,
    snrDb: -70.2,
    modcodName: 'LINK_OUTAGE',
    spectralEfficiency: 0.0,
    bitrateBps: 0.0,
    bitrateMbps: 0.0,
    isOutage: true,
  };

  const mockHop1Link: LinkStatus = {
    nodeType: 'soldier',
    slantRangeM: dHop1M,
    fsplDb: 124.5,
    diffractionLossDb: 0.0,
    gasLossDb: 0.06,
    rainLossDb: 0.0,
    cableLossDb: 1.5,
    implementationMarginDb: 2.5,
    totalLossDb: 128.56,
    pTxDbm: 23.0,
    txGainDbi: 0.0,
    rxGainDbi: 12.0, // Ridgeline MCP mast receive gain
    prxDbm: -93.56,
    pNoiseDbm: -111.0,
    snrDb: 17.44,
    modcodName: '16-APSK 4/5',
    spectralEfficiency: 3.16,
    bitrateBps: rHop1Bps,
    bitrateMbps: 30.0,
    isOutage: false,
  };

  const mockHop2Link: LinkStatus = {
    nodeType: 'mcp',
    slantRangeM: dHop2M,
    fsplDb: 134.0,
    diffractionLossDb: 0.0,
    gasLossDb: 0.18,
    rainLossDb: 0.0,
    cableLossDb: 1.5,
    implementationMarginDb: 2.5,
    totalLossDb: 138.18,
    pTxDbm: 30.0,
    txGainDbi: 6.0,
    rxGainDbi: 15.0,
    prxDbm: -87.18,
    pNoiseDbm: -111.0,
    snrDb: 23.82,
    modcodName: '64-APSK 5/6',
    spectralEfficiency: 4.95,
    bitrateBps: rHop2Bps,
    bitrateMbps: 60.0,
    isOutage: false,
    activeSectorId: 1,
    sectorBoresightDeg: 90,
  };

  const relayed = LinkBudgetEngine.computeDecodeAndForwardRelayLink(
    mockDirectOutage,
    mockHop1Link,
    mockHop2Link,
    dHop1M,
    dHop2M,
    SPEED_OF_LIGHT
  );

  // Exact harmonic rate: (30 * 60) / (30 + 60) = 1800 / 90 = 20.000 Mbps
  const expectedRateBps = (rHop1Bps * rHop2Bps) / (rHop1Bps + rHop2Bps);
  assert.equal(expectedRateBps, 20.0e6, 'Analytical harmonic calculation must equal 20 Mbps');

  close(relayed.bitrateBps, 20.0e6, 1e-3, 'Relayed bitrate in bps');
  close(relayed.bitrateMbps, 20.0, 1e-4, 'Relayed bitrate in Mbps');
  assert.equal(relayed.isOutage, false, 'Relayed link must not be in outage');
  assert.equal(relayed.isRelayed, true, 'isRelayed flag must be true');
  assert.equal(relayed.activeSectorId, 1, 'Relayed link must adopt Hop 2 ACN sector');
  assert.equal(relayed.sectorBoresightDeg, 90, 'Relayed link must adopt Hop 2 sector boresight');
  assert.equal(relayed.modcodName, '2HOP:16-APSK 4/5', 'Relayed modcod must reflect bottleneck Hop 1');
  close(relayed.snrDb, 17.44, 1e-3, 'Relayed SNR must reflect bottleneck min(SNR1, SNR2)');
  close(relayed.slantRangeM, 20000.0, 1e-3, 'Slant range must be sum of dHop1 + dHop2');

  const expectedTauUs = ((2.0 * (dHop1M + dHop2M)) / SPEED_OF_LIGHT) * 1e6;
  close(relayed.timingAdvanceUs ?? 0, expectedTauUs, 1e-4, 'Two-hop timing advance in microseconds');
  console.log(`  ✓ Exact harmonic Decode-and-Forward capacity: ${relayed.bitrateMbps.toFixed(3)} Mbps (expected 20.000 Mbps)`);
  console.log(`  ✓ Two-hop propagation Timing Advance: ${relayed.timingAdvanceUs?.toFixed(3)} μs (expected ${expectedTauUs.toFixed(3)} μs)`);

  // Direct link superior case: direct rate 25 Mbps > 20 Mbps harmonic rate
  const mockDirectBetter: LinkStatus = {
    ...mockDirectOutage,
    isOutage: false,
    bitrateBps: 25.0e6,
    bitrateMbps: 25.0,
    snrDb: 15.0,
    modcodName: '16-APSK 2/3',
  };
  const directRetained = LinkBudgetEngine.computeDecodeAndForwardRelayLink(
    mockDirectBetter,
    mockHop1Link,
    mockHop2Link,
    dHop1M,
    dHop2M,
    SPEED_OF_LIGHT
  );
  assert.equal(directRetained.isRelayed, false, 'Direct link must be retained when direct rate exceeds relay rate');
  assert.equal(directRetained.bitrateMbps, 25.0, 'Retained direct rate must match direct link');
  console.log('  ✓ Direct link retained when direct bitrate (25 Mbps) exceeds DF harmonic rate (20 Mbps)');
}

// =================================================================================================
// [ATR-T2] Valley Outage Rescue via Ridgeline Relay
// =================================================================================================
console.log('\n[ATR-T2] Verifying Terrain-Occluded Valley Outage Rescue via Ridgeline Relay...');
{
  const rf = new RFConfig();
  const env = new EnvironmentConfig({ activeRelayEnabled: true });

  // Custom terrain with a tall knife-edge mountain ridge at x=0 separating valley from ACN
  const terrain = new TerrainEngine({
    customElevationFn: (x, _y) => {
      // Gaussian peak at x = 0 with peak height 4,200 m MSL, falling to 2,500 m in valley
      const distFromRidge = Math.abs(x);
      if (distFromRidge < 2000.0) {
        return 4200.0 - (distFromRidge / 2000.0) * 1700.0;
      }
      return 2500.0;
    },
  });

  const linkEngine = new LinkBudgetEngine();
  const acnPos: Position3D = [-10000.0, 0, 4800.0]; // ACN West of ridge
  const valleyTerminalPos: Position3D = [4000.0, 0, 2502.0]; // Terminal East of ridge in shadowed valley
  const ridgelineRelayPos: Position3D = [0, 0, 4212.0]; // Relay on ridge crest with 12m mast

  // 1. Direct Link: ACN to Valley Terminal (Obstructed by 4200m ridge)
  const directObs = terrain.evaluateTerrainObstruction(valleyTerminalPos, acnPos, rf, env);
  assert.equal(directObs.isLos, false, 'Direct ray between valley terminal and ACN must be occluded by ridge');
  assert.ok(directObs.diffractionLossDb > 40.0, 'Direct ray must suffer severe knife-edge diffraction loss');

  const dDirectM = Math.hypot(acnPos[0] - valleyTerminalPos[0], acnPos[1] - valleyTerminalPos[1], acnPos[2] - valleyTerminalPos[2]);
  const directLink = linkEngine.evaluateLink(
    'soldier',
    dDirectM,
    directObs.diffractionLossDb,
    rf,
    env,
    directObs.obstacleBlocked,
    23.0
  );
  assert.equal(directLink.isOutage, true, 'Direct link must be in radio outage due to ridge occlusion');
  assert.equal(directLink.bitrateBps, 0.0, 'Direct link bitrate must be 0 bps');

  // 2. Hop 1: Valley Terminal to Ridgeline Relay (Clear line of sight looking up ridge)
  const hop1Obs = terrain.evaluateTerrainObstruction(valleyTerminalPos, ridgelineRelayPos, rf, env);
  assert.equal(hop1Obs.isLos, true, 'Hop 1 from valley terminal to ridge crest mast must have optical LoS');

  const dHop1M = Math.hypot(ridgelineRelayPos[0] - valleyTerminalPos[0], ridgelineRelayPos[1] - valleyTerminalPos[1], ridgelineRelayPos[2] - valleyTerminalPos[2]);
  const hop1Link = linkEngine.evaluateLink(
    'soldier',
    dHop1M,
    hop1Obs.diffractionLossDb,
    rf,
    env,
    hop1Obs.obstacleBlocked,
    23.0,
    undefined,
    valleyTerminalPos[2],
    ridgelineRelayPos[2],
    hop1Obs.crestRadiusM,
    hop1Obs.curvatureLossDb,
    undefined,
    0,
    0,
    0,
    env.relayAntennaGainDbi
  );
  assert.equal(hop1Link.isOutage, false, 'Hop 1 link must have active radio connection');
  assert.ok(hop1Link.bitrateMbps > 0.0, 'Hop 1 bitrate must be positive');

  // 3. Hop 2: Ridgeline Relay to ACN (Clear line of sight above valley)
  const hop2Obs = terrain.evaluateTerrainObstruction(ridgelineRelayPos, acnPos, rf, env);
  assert.equal(hop2Obs.isLos, true, 'Hop 2 from ridge crest mast to ACN must have optical LoS');

  const dHop2M = Math.hypot(acnPos[0] - ridgelineRelayPos[0], acnPos[1] - ridgelineRelayPos[1], acnPos[2] - ridgelineRelayPos[2]);
  const hop2Link = linkEngine.evaluateLink(
    'mcp',
    dHop2M,
    hop2Obs.diffractionLossDb,
    rf,
    env,
    hop2Obs.obstacleBlocked,
    30.0,
    undefined,
    ridgelineRelayPos[2],
    acnPos[2]
  );
  assert.equal(hop2Link.isOutage, false, 'Hop 2 backhaul link must have active radio connection');
  assert.ok(hop2Link.bitrateMbps > 0.0, 'Hop 2 backhaul bitrate must be positive');

  // 4. End-to-End Decode-and-Forward Rescue
  const rescuedLink = LinkBudgetEngine.computeDecodeAndForwardRelayLink(
    directLink,
    hop1Link,
    hop2Link,
    dHop1M,
    dHop2M,
    rf.speedOfLight
  );

  assert.equal(rescuedLink.isOutage, false, 'Valley terminal must transition out of radio outage');
  assert.equal(rescuedLink.isRelayed, true, 'Rescued terminal must be flagged as isRelayed: true');
  assert.ok(rescuedLink.bitrateMbps > 0.0, `Rescued terminal bitrate must be > 0 (got ${rescuedLink.bitrateMbps.toFixed(2)} Mbps)`);
  console.log(`  ✓ Valley terminal successfully rescued: Direct Outage -> Relayed ${rescuedLink.bitrateMbps.toFixed(2)} Mbps (${rescuedLink.modcodName})`);
}

// =================================================================================================
// [ATR-T3] End-to-End Worker Packet Drop Reduction with Active Relay
// =================================================================================================
console.log('\n[ATR-T3] Verifying End-to-End Worker Packet Drop Reduction with Active Relay...');
{
  const framesToSimulate = 100;
  const seedOffset = 100_000;
  const kargilValleyPos: Position3D = [5200, 200, 4475.7];

  // Run 1: Baseline without active relay (Node 4 in shadowed valley)
  const simBaseline = new SimulationWorkerManager(seedOffset);
  simBaseline.isPaused = true;
  simBaseline.handleMessage({ type: 'SET_TERRAIN_MODE', mode: 'synthetic' });
  simBaseline.handleMessage({
    type: 'SET_SCIENTIFIC_PARAMS',
    trafficLoadMultiplier: 3.5,
    activeRelayEnabled: false,
  });
  simBaseline.nodesTac[4].position = [...kargilValleyPos];
  simBaseline.nodesStatic[4].position = [...kargilValleyPos];
  simBaseline.clearRelayHop1Cache();

  // Run 2: Active Two-Hop Relay Enabled (Node 4 in shadowed valley)
  const simActiveRelay = new SimulationWorkerManager(seedOffset);
  simActiveRelay.isPaused = true;
  simActiveRelay.handleMessage({ type: 'SET_TERRAIN_MODE', mode: 'synthetic' });
  simActiveRelay.handleMessage({
    type: 'SET_SCIENTIFIC_PARAMS',
    trafficLoadMultiplier: 3.5,
    activeRelayEnabled: true,
  });
  simActiveRelay.nodesTac[4].position = [...kargilValleyPos];
  simActiveRelay.nodesStatic[4].position = [...kargilValleyPos];
  simActiveRelay.clearRelayHop1Cache();

  let maxRelayedCount = 0;

  for (let f = 0; f < framesToSimulate; f++) {
    simBaseline.tickSimulation();
    simActiveRelay.tickSimulation();
    if (simActiveRelay.relayedNodeCount > maxRelayedCount) {
      maxRelayedCount = simActiveRelay.relayedNodeCount;
    }
  }

  const baselineDrops = simBaseline.metrics.tacDelayDropsThisRun;
  const baselineGoodput = simBaseline.metrics.tacGoodputBits;
  const baselineRelayed = simBaseline.relayedNodeCount;
  assert.equal(baselineRelayed, 0, 'Relayed node count must be 0 when active relay is disabled');

  const activeDrops = simActiveRelay.metrics.tacDelayDropsThisRun;
  const activeGoodput = simActiveRelay.metrics.tacGoodputBits;

  console.log(`  ✓ Baseline (Relay OFF):  Drops = ${baselineDrops} pkts, Delivered Goodput = ${(baselineGoodput / 1e6).toFixed(2)} Mb, Relayed = ${baselineRelayed}`);
  console.log(`  ✓ Active Mesh (Relay ON): Drops = ${activeDrops} pkts, Delivered Goodput = ${(activeGoodput / 1e6).toFixed(2)} Mb, Max Relayed Nodes = ${maxRelayedCount}`);

  assert.ok(maxRelayedCount > 0, `Active relay must rescue occluded valley nodes (maxRelayedCount: ${maxRelayedCount})`);
  assert.ok(
    activeDrops <= baselineDrops,
    `Active relay must reduce or match packet delay drops (active: ${activeDrops}, baseline: ${baselineDrops})`
  );
  assert.ok(
    activeGoodput >= baselineGoodput,
    `Active relay must increase or match total delivered goodput (active: ${activeGoodput}, baseline: ${baselineGoodput})`
  );

  // Check telemetry frame serialization
  const frame = simActiveRelay.lastTelemetryFrame;
  assert.ok(frame !== null, 'Telemetry frame must exist');
  assert.equal(frame?.active_relay_enabled, true, 'Telemetry frame must serialize active_relay_enabled: true');
  assert.ok(frame?.relayed_node_count !== undefined, 'Telemetry frame must serialize relayed_node_count');
  assert.ok(frame?.relay_advisor !== undefined, 'Telemetry frame must serialize relay_advisor');
  console.log(`  ✓ Telemetry frame active_relay_enabled: ${frame?.active_relay_enabled}, relayed_node_count: ${frame?.relayed_node_count}`);
}

// =================================================================================================
// [ATR-T4] DOM & Specification Persistence Check
// =================================================================================================
console.log('\n[ATR-T4] Verifying DOM Controls & Specification Persistence...');
{
  const rootDir = resolve(import.meta.dirname, '../..');
  const specPath = resolve(rootDir, 'docs/specs/SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH.md');
  const htmlPath = resolve(rootDir, 'index.html');
  const readmePath = resolve(rootDir, 'README.md');

  assert.ok(existsSync(specPath), 'SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH.md must exist on disk under docs/specs/');
  const specContent = readFileSync(specPath, 'utf8');
  assert.ok(specContent.includes('SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH'), 'Spec must contain title header');
  assert.ok(specContent.includes('R_{1, i}'), 'Spec must contain Decode-and-Forward harmonic formulation');

  const htmlContent = readFileSync(htmlPath, 'utf8');
  assert.ok(htmlContent.includes('id="btn-toggle-active-relay"'), 'index.html must contain #btn-toggle-active-relay');
  assert.ok(htmlContent.includes('aria-label="Deploy Active Two-Hop MCP Ridge Relay"'), 'Toggle button must have explicit aria-label');
  assert.ok(htmlContent.includes('id="relay-active-stats"'), 'index.html must contain #relay-active-stats fact readout');
  assert.ok(htmlContent.includes('id="sci-relay-select"'), 'index.html must contain #sci-relay-select in scheduler tab');

  const readmeContent = readFileSync(readmePath, 'utf8');
  assert.ok(readmeContent.includes('SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH.md'), 'README.md must link to the new specification in Section 7');

  console.log('  ✓ SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH.md verified on disk');
  console.log('  ✓ #btn-toggle-active-relay and #sci-relay-select verified in index.html');
  console.log('  ✓ Specification linked in README.md Section 7');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL ACTIVE TWO-HOP RELAY MESH VERIFICATION TESTS PASSED (4/4 SUITES)');
console.log('='.repeat(96));
