import assert from 'node:assert/strict';
import { buildLinkProfile } from '../core/linkProfile';
import { SimulationWorkerManager } from '../worker/simWorker';
import { TerrainEngine } from '../core/terrain';

const profileObstruction = {
  minClearanceM: 12,
  fresnelRadiusM: 8,
  diffractionLossDb: 0,
  isLos: true,
  obstacleBlocked: true,
  obstacleIntersections: [{ obstacleId: 'stable-wall-7', entryFraction: 0.25, exitFraction: 0.75, penetrationM: 3 }],
};
const profile = buildLinkProfile({
  selectedGroundNodeId: 4,
  nodeName: 'S4',
  frameIndex: 19,
  simulationTimeS: 0.38,
  groundNodePositionMslM: [0, 0, 10],
  acnPositionMslM: [300, 400, 110],
  wavelengthM: 0.1,
  effectiveEarthRadiusM: 6_371_000,
  fresnelFraction: 0.6,
  sampleCount: 3,
  obstruction: profileObstruction,
  getTerrainElevationMslM: () => 2,
  computeEarthBulgeM: TerrainEngine.computeEarthBulge,
});
const expectedSlantM = Math.hypot(500, 100);
const midFresnelM = Math.sqrt(0.1 * (expectedSlantM / 2) ** 2 / expectedSlantM);
assert.equal(profile.valid, true);
assert.equal(profile.selectedGroundNodeId, 4);
assert.equal(profile.frameIndex, 19);
assert.equal(profile.simulationTimeS, 0.38);
assert.equal(profile.horizontalGroundDistanceM, 500, 'display coordinate is horizontal ground distance');
assert.equal(profile.slantDistanceM, expectedSlantM, 'propagation geometry retains 3D slant distance');
assert.equal(profile.samples[2].horizontalGroundDistanceM, 500, 'sample ordering starts at ground node and ends at ACN');
assert.equal(profile.samples[0].slantDistanceM, 0);
assert.equal(profile.samples[2].slantDistanceM, expectedSlantM);
assert.equal(profile.samples[1].terrainElevationMslM, 2, 'bare DEM elevation is separate');
assert.ok(profile.samples[1].effectiveTerrainElevationMslM > 2, 'effective terrain includes curvature');
assert.equal(profile.samples[1].losElevationMslM, 60);
assert.ok(Math.abs(profile.samples[1].fresnelRadiusM - midFresnelM) < 1e-12);
assert.ok(Math.abs(profile.samples[1].lowerFresnelElevationMslM - (60 - 0.6 * midFresnelM)) < 1e-12);
assert.ok(Math.abs(profile.samples[1].upperFresnelElevationMslM - (60 + 0.6 * midFresnelM)) < 1e-12);
assert.equal(profile.terrainIsLos, true);
assert.equal(profile.obstacleBlocked, true, 'obstacle-only blockage remains separate from terrain LOS');
assert.equal(profile.obstacleIntervals[0].obstacleId, 'stable-wall-7');
assert.equal(profile.obstacleIntervals[0].entryHorizontalDistanceM, 125);
assert.equal(profile.obstacleIntervals[0].exitHorizontalDistanceM, 375);
assert.equal(profile.obstacleIntervals[0].entrySlantDistanceM, expectedSlantM * 0.25);

const coincidentProfile = buildLinkProfile({
  selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 0, simulationTimeS: 0,
  groundNodePositionMslM: [1, 2, 3], acnPositionMslM: [1, 2, 3],
  wavelengthM: 0.1, effectiveEarthRadiusM: 6_371_000, sampleCount: 3,
  obstruction: { ...profileObstruction, obstacleBlocked: false, obstacleIntersections: [] },
  getTerrainElevationMslM: () => 3, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
});
assert.equal(coincidentProfile.valid, true, 'zero-length profile remains finite and safe');
assert.equal(coincidentProfile.slantDistanceM, 0);
assert.ok(coincidentProfile.samples.every(sample => Object.values(sample).every(Number.isFinite)));
const invalidProfile = buildLinkProfile({
  selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 0, simulationTimeS: 0,
  groundNodePositionMslM: [0, 0, 0], acnPositionMslM: [1, 0, 0],
  wavelengthM: Number.NaN, effectiveEarthRadiusM: 6_371_000, sampleCount: 3,
  obstruction: profileObstruction, getTerrainElevationMslM: () => 0, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
});
assert.equal(invalidProfile.valid, false);
assert.equal(invalidProfile.samples.length, 0, 'invalid numeric inputs do not emit misleading geometry');
const invalidEndpointProfile = buildLinkProfile({
  selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 0, simulationTimeS: 0,
  groundNodePositionMslM: [Number.NaN, 0, 0], acnPositionMslM: [1, 0, 0],
  wavelengthM: 0.1, effectiveEarthRadiusM: 6_371_000, sampleCount: 3,
  obstruction: profileObstruction, getTerrainElevationMslM: () => 0, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
});
assert.equal(invalidEndpointProfile.valid, false);
assert.deepEqual(invalidEndpointProfile.groundNodePositionMslM, [0, 0, 0], 'invalid coordinates are not propagated as NaN in the response');
assert.equal(invalidEndpointProfile.samples.length, 0);
const invalidTerrainProfile = buildLinkProfile({
  selectedGroundNodeId: 4, nodeName: 'S4', frameIndex: 0, simulationTimeS: 0,
  groundNodePositionMslM: [0, 0, 0], acnPositionMslM: [1, 0, 0],
  wavelengthM: 0.1, effectiveEarthRadiusM: 6_371_000, sampleCount: 3,
  obstruction: profileObstruction, getTerrainElevationMslM: () => Number.NaN, computeEarthBulgeM: TerrainEngine.computeEarthBulge,
});
assert.equal(invalidTerrainProfile.valid, false);
assert.equal(invalidTerrainProfile.samples.length, 0, 'invalid terrain samples do not leak partial profile data');

async function runWorkerStateVerification(): Promise<void> {
  const sim = new SimulationWorkerManager();
  const nodeId = 4;
  const initial = sim.nodesTac[nodeId];
  const initialTerrain = sim.terrainEngine.getElevation(initial.position[0], initial.position[1]);
  assert.equal(initial.aglM, 2, 'existing ground nodes retain 2 m AGL');
  assert.equal(initial.position[2], initialTerrain + 2, 'initial absolute altitude is terrain MSL plus AGL');
  assert.equal(sim.nodesStatic[nodeId].position[2], initial.position[2]);

  assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 12.5 } }).accepted, true);
  assert.equal(sim.nodesTac[nodeId].aglM, 12.5);
  assert.equal(sim.nodesTac[nodeId].position[2], initialTerrain + 12.5);
  assert.equal(sim.nodesStatic[nodeId].position[2], initialTerrain + 12.5);

  const movedTo: [number, number] = [32000, 21000];
  const movedTerrain = sim.terrainEngine.getElevation(...movedTo);
  assert.equal(sim.handleMessage({ type: 'NODE_MOVE', node_id: nodeId, x_m: movedTo[0], y_m: movedTo[1] }).accepted, true);
  assert.deepEqual(sim.nodesTac[nodeId].position, [movedTo[0], movedTo[1], movedTerrain + 12.5]);
  assert.equal(sim.nodesTac[nodeId].aglM, 12.5, 'horizontal movement preserves configured AGL');

  assert.equal(sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true }).accepted, true);
  const lockedPosition = sim.nodesTac[nodeId].position;
  const lockedConfig = sim.flightConfig;
  assert.equal(sim.handleMessage({ type: 'NODE_MOVE', node_id: nodeId, x_m: 100, y_m: 200 }).accepted, false);
  assert.deepEqual(sim.nodesTac[nodeId].position, lockedPosition, 'direct worker move is rejected atomically');
  assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { acn_altitude_m: 6000 } }).accepted, false);
  assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 10 } }).accepted, false);
  assert.equal(sim.handleMessage({ type: 'SET_TERRAIN_MODE', mode: 'synthetic' }).accepted, false);
  assert.equal(sim.flightConfig, lockedConfig, 'trajectory edit is rejected while locked');
  assert.equal(sim.handleMessage({ type: 'LOAD_PRESET', preset_id: 'PRESET_OCCLUSION' }).accepted, false);
  assert.equal(sim.handleMessage({ type: 'SIM_CONTROL', action: 'reset' }).accepted, false);
  assert.equal(sim.handleMessage({ type: 'SELECT_NODE', node_id: 2 }).accepted, true);
  assert.equal(sim.selectedNodeId, 2, 'read-only selection stays available while locked');
  assert.equal(sim.handleMessage({ type: 'SET_SCHEDULER', mode: 'static' }).accepted, true);
  assert.equal(sim.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: false }).accepted, true);

  const previousFrequency = sim.rfConfig.carrierFrequencyHz;
  const previousAgl = sim.nodesTac[nodeId].aglM;
  const invalidCases = [
    { type: 'NODE_MOVE', node_id: nodeId, x_m: Number.NaN, y_m: 2 },
    { type: 'NODE_MOVE', node_id: nodeId, x_m: Number.POSITIVE_INFINITY, y_m: 2 },
    { type: 'NODE_MOVE', node_id: nodeId, x_m: '10', y_m: 2 },
    { type: 'CONFIG_UPDATE', params: { carrier_freq_ghz: 9, acn_altitude_m: Number.NaN } },
    { type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: Number.POSITIVE_INFINITY } },
    { type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: -1 } },
    { type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 1001 } },
    [],
  ];
  for (const message of invalidCases) assert.equal(sim.handleMessage(message as any).accepted, false);
  assert.equal(sim.rfConfig.carrierFrequencyHz, previousFrequency, 'invalid multi-field update has no partial effect');
  assert.equal(sim.nodesTac[nodeId].aglM, previousAgl);
  assert.deepEqual(sim.nodesTac[nodeId].position, lockedPosition);

  assert.equal(sim.handleMessage({ type: 'CONFIG_UPDATE', params: { node_id: nodeId, agl_m: 7 } }).accepted, true);
  assert.equal(sim.nodesTac[nodeId].position[2], movedTerrain + 7);
  assert.equal(sim.handleMessage({ type: 'NODE_MOVE', node_id: -1, x_m: 1000, y_m: -2000 }).accepted, true);
  assert.equal(sim.flightConfig.centerXm, 1000);
  assert.equal(sim.flightConfig.centerYm, -2000);

  await verifyDemActivationAndFallback();
  console.log('PASS Worker command validation, DEM activation/fallback, telemetry, and ground-node AGL consistency');
}

async function verifyDemActivationAndFallback(): Promise<void> {
  const sim = new SimulationWorkerManager();
  sim.terrainEngine.setTerrainMode('synthetic');
  const before = sim.nodesTac.map(node => ({ x: node.position[0], y: node.position[1], z: node.position[2], agl: node.aglM }));
  const dem = new Float32Array(512 * 512);
  for (let row = 0; row < 512; row++) {
    dem.fill(3200 + row * 2, row * 512, (row + 1) * 512);
  }
  sim.terrainEngine.loadRealSatelliteDem = async () => sim.terrainEngine.loadCustomDem(dem);
  sim.initHillshade = () => {};
  let timerStarted = false;
  (sim as any).restartTimer = () => {
    timerStarted = true;
    for (const node of sim.nodesTac) {
      assert.equal(node.position[2], sim.terrainEngine.getElevation(node.position[0], node.position[1]) + node.aglM,
        'all nodes are resampled before the ticker starts');
    }
  };

  await sim.start();
  assert.equal(sim.terrainEngine.hasRealDem, true);
  assert.equal(timerStarted, true);
  assert.ok(sim.nodesTac.some((node, i) => node.position[2] !== before[i].z), 'real DEM elevations differ from constructor fallback');
  sim.nodesTac.forEach((node, i) => {
    assert.equal(node.position[0], before[i].x, `node ${i} x coordinate is preserved`);
    assert.equal(node.position[1], before[i].y, `node ${i} y coordinate is preserved`);
    assert.equal(node.aglM, before[i].agl, `node ${i} AGL is preserved`);
    assert.equal(node.position[2], sim.terrainEngine.getElevation(before[i].x, before[i].y) + before[i].agl,
      `node ${i} altitude uses active DEM plus AGL`);
  });
  sim.nodesStatic.forEach((node, i) => {
    assert.equal(node.position[0], before[i].x);
    assert.equal(node.position[1], before[i].y);
    assert.equal(node.aglM, before[i].agl);
    assert.equal(node.position[2], sim.terrainEngine.getElevation(before[i].x, before[i].y) + before[i].agl);
  });

  const node = sim.nodesTac[0];
  sim.tickSimulation();
  const acn = sim.trajectoryEngine.getAcnPosition(sim.simTimeS);
  const slantRangeM = Math.hypot(acn[0] - node.position[0], acn[1] - node.position[1], acn[2] - node.position[2]);
  const link = sim.linkStatuses.get(node.nodeId);
  assert.ok(link, 'worker frame evaluates the ground node link');
  assert.equal(link.slantRangeM, slantRangeM, 'worker link calculation uses the updated ground altitude');
  const telemetry = (sim as any).buildTelemetryFrame(acn);
  const linkProfile = telemetry.selected_node_fresnel.profile;
  assert.equal(linkProfile.selectedGroundNodeId, sim.selectedNodeId);
  assert.equal(linkProfile.frameIndex, telemetry.frame_index);
  assert.equal(linkProfile.simulationTimeS, telemetry.sim_time_s);
  assert.equal(linkProfile.terrainIsLos, sim.obstructionResults.get(sim.selectedNodeId)?.isLos);
  assert.equal(linkProfile.obstacleBlocked, sim.linkStatuses.get(sim.selectedNodeId)?.obstacleBlocked);
  assert.equal(linkProfile.samples[0].losElevationMslM, sim.nodesTac[sim.selectedNodeId].position[2]);
  assert.equal(linkProfile.samples.at(-1)?.losElevationMslM, acn[2]);
  assert.equal(telemetry.selected_node_fresnel.profile_points[0][0], 0);
  assert.equal(telemetry.selected_node_fresnel.profile_points.at(-1)?.[0], linkProfile.horizontalGroundDistanceM / 1000,
    'legacy Canvas tuples remain available and now use horizontal km');
  const nodeTelemetry = telemetry.nodes_telemetry.find((item: any) => item.node_id === node.nodeId);
  assert.equal(nodeTelemetry.altitude_msl_m, node.position[2]);
  assert.equal(nodeTelemetry.terrain_elevation_msl_m + nodeTelemetry.agl_m, nodeTelemetry.altitude_msl_m);
  assert.equal(nodeTelemetry.slant_range_km, slantRangeM / 1000);
  const profileNode = sim.nodesTac[sim.selectedNodeId];
  assert.equal(telemetry.selected_node_fresnel.profile_points[0][2], profileNode.position[2],
    'profile endpoint uses the resampled ground altitude');
  const altitudeAfterActivation = sim.nodesTac.map(node => node.position[2]);
  await sim.start();
  assert.deepEqual(sim.nodesTac.map(node => node.position[2]), altitudeAfterActivation,
    'activating the already loaded terrain again is idempotent, not an additive adjustment');

  const fallback = new SimulationWorkerManager();
  fallback.terrainEngine.setTerrainMode('synthetic');
  const fallbackBefore = fallback.nodesTac.map(node => [...node.position] as [number, number, number]);
  fallback.terrainEngine.loadRealSatelliteDem = async () => false;
  fallback.initHillshade = () => {};
  (fallback as any).restartTimer = () => {};
  await fallback.start();
  assert.equal(fallback.terrainEngine.hasRealDem, false);
  assert.equal(fallback.terrainEngine.terrainMode, 'synthetic');
  fallback.nodesTac.forEach((node, i) => {
    assert.deepEqual(node.position.slice(0, 2), fallbackBefore[i].slice(0, 2));
    assert.equal(node.position[2], fallbackBefore[i][2], 'failed DEM load leaves fallback altitude unchanged');
    assert.equal(node.position[2], fallback.terrainEngine.getElevation(node.position[0], node.position[1]) + node.aglM);
  });
}

await runWorkerStateVerification();
