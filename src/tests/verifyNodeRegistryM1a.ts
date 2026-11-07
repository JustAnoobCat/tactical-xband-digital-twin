/**
 * src/tests/verifyNodeRegistryM1a.ts
 *
 * Authoritative Verification Suite for Milestone M1a:
 * Stable Entity Identity and Registry Compatibility.
 *
 * Verifies:
 * 1. Preservation of original node IDs 0–15 and canonical tactical layout.
 * 2. Preservation of creationSequence values 0–15.
 * 3. Seed mapping formula: 1000 + nodeId + seedOffset across arbitrary offsets.
 * 4. Stable entity identity and RFC 4122 UUID v4 formatting.
 * 5. GroundNodeTrafficSubsystem integration and standalone backwards compatibility.
 * 6. Worker authoritative telemetry emission carrying entity_id and creation_sequence.
 * 7. Spatial and AGL mutation synchronization between active subsystems and registry.
 * 8. Boundary conditions, invalid lookups, and duplicate registration protection.
 */

import { strict as assert } from 'node:assert';
import {
  NodeRegistry,
  createDefault16NodeRegistry,
  computeNodeSeed,
  formatDeterministicNodeUuid,
  MCP_ID,
  DEFAULT_ANTENNA_AGL_M,
  CANONICAL_16_NODE_POSITIONS,
  NodeIdentity,
  GroundNodeEntity,
} from '../core/nodeRegistry';
import { GROUND_NODE_IDS } from '../core/config';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { SimulationWorkerManager } from '../worker/simWorker';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

console.log('='.repeat(92));
console.log('   DRDO X-BAND DIGITAL TWIN // M1a: STABLE ENTITY IDENTITY & REGISTRY VERIFICATION');
console.log('='.repeat(92));

// -----------------------------------------------------------------------------
// Test 1: Canonical 16-node Population & IDs Preservation (0–15)
// -----------------------------------------------------------------------------
console.log('\n[1/8] Verifying canonical 16-node population and ID preservation (0–15)...');
const registry = createDefault16NodeRegistry(0);

assert.equal(registry.size, 16, 'Registry must contain exactly 16 ground nodes');
assert.deepEqual(registry.getNodeIds(), Array.from({ length: 16 }, (_, i) => i), 'Node IDs must strictly be 0..15');

for (const id of GROUND_NODE_IDS) {
  const entity = registry.getByNodeId(id);
  assert.ok(entity, `Entity for node ${id} must exist in registry`);
  assert.equal(entity.identity.nodeId, id, `nodeId must match ${id}`);
  assert.equal(entity.aglM, DEFAULT_ANTENNA_AGL_M, `Default AGL must be ${DEFAULT_ANTENNA_AGL_M} m`);

  // Check expected tactical coordinates
  const expectedPos = CANONICAL_16_NODE_POSITIONS[id];
  assert.deepEqual(entity.position, expectedPos, `Initial position for node ${id} must match canonical layout`);

  // Node 15 is MCP; nodes 0..14 are soldiers
  if (id === MCP_ID) {
    assert.equal(entity.identity.role, 'mcp', 'Node 15 must be MCP');
    assert.equal(entity.identity.callsign, 'MCP', 'Node 15 callsign must be MCP');
  } else {
    assert.equal(entity.identity.role, 'soldier', `Node ${id} must be soldier`);
    assert.equal(entity.identity.callsign, `S${id}`, `Node ${id} callsign must be S${id}`);
  }
}
console.log('  -> PASS: All 16 ground nodes preserved with exact coordinates, roles, and IDs 0–15.');

// -----------------------------------------------------------------------------
// Test 2: Creation Sequence Invariance (0–15)
// -----------------------------------------------------------------------------
console.log('\n[2/8] Verifying creationSequence invariance (0–15)...');
for (let seq = 0; seq < 16; seq++) {
  const entity = registry.getByCreationSequence(seq);
  assert.ok(entity, `Entity with creationSequence ${seq} must exist`);
  assert.equal(entity.identity.creationSequence, seq, `creationSequence must equal ${seq}`);
  assert.equal(entity.identity.nodeId, seq, `creationSequence ${seq} must map to nodeId ${seq}`);
}

const allEntities = registry.getAll();
assert.equal(allEntities.length, 16);
allEntities.forEach((entity, index) => {
  assert.equal(entity.identity.creationSequence, index, `Index ${index} must have creationSequence ${index}`);
});
console.log('  -> PASS: All 16 nodes possess unbroken, contiguous creationSequence values 0–15.');

// -----------------------------------------------------------------------------
// Test 3: Stable Entity Identity & RFC 4122 Compliance
// -----------------------------------------------------------------------------
console.log('\n[3/8] Verifying stable entity identity and RFC 4122 UUID v4 formatting...');
for (const entity of allEntities) {
  const { entityId, nodeId } = entity.identity;
  assert.ok(UUID_V4_REGEX.test(entityId), `entityId '${entityId}' must conform to RFC 4122 UUID v4`);

  // Lookup by UUID
  const foundByUuid = registry.getByEntityId(entityId);
  assert.ok(foundByUuid, `Lookup by entityId '${entityId}' must succeed`);
  assert.equal(foundByUuid.identity.nodeId, nodeId);

  // Flexible lookup by alias 'node-${nodeId}'
  const foundByAlias = registry.getByEntityId(`node-${nodeId}`);
  assert.ok(foundByAlias, `Lookup by alias 'node-${nodeId}' must succeed`);
  assert.equal(foundByAlias.identity.entityId, entityId);
}

// Reproducibility across independent instances
const registry2 = createDefault16NodeRegistry(0);
for (let i = 0; i < 16; i++) {
  assert.equal(
    registry.getByNodeId(i)!.identity.entityId,
    registry2.getByNodeId(i)!.identity.entityId,
    `Entity IDs must be 100% deterministic between instances for node ${i}`
  );
}
console.log('  -> PASS: Entity IDs conform to RFC 4122 UUID v4 and are bit-for-bit deterministic across instances.');

// -----------------------------------------------------------------------------
// Test 4: Seed Mapping Invariance (1000 + nodeId + seedOffset)
// -----------------------------------------------------------------------------
console.log('\n[4/8] Verifying seed mapping formula: 1000 + nodeId + seedOffset...');
const testOffsets = [0, 42, 100_000, 999_999];

for (const offset of testOffsets) {
  const reg = createDefault16NodeRegistry(offset);
  for (let i = 0; i < 16; i++) {
    const expectedSeed = 1000 + i + offset;
    assert.equal(computeNodeSeed(i, offset), expectedSeed, `computeNodeSeed(${i}, ${offset}) mismatch`);
    assert.equal(reg.getByNodeId(i)!.seed, expectedSeed, `Registered seed mismatch for node ${i} at offset ${offset}`);
  }
}

// Verify traffic PRNG reproducibility with mapped seeds
const nodeA = new GroundNodeTrafficSubsystem(4, 'soldier', [0, 0, 0], computeNodeSeed(4, 5000));
const nodeB = new GroundNodeTrafficSubsystem(4, 'soldier', [0, 0, 0], computeNodeSeed(4, 5000));
const nodeC = new GroundNodeTrafficSubsystem(4, 'soldier', [0, 0, 0], computeNodeSeed(4, 6000));

// Compare first 20 pseudo-random numbers
for (let k = 0; k < 20; k++) {
  const rA = (nodeA as any).nextRandom();
  const rB = (nodeB as any).nextRandom();
  const rC = (nodeC as any).nextRandom();
  assert.equal(rA, rB, `PRNG stream must be identical for identical mapped seed at step ${k}`);
  if (k === 0) {
    assert.notEqual(rA, rC, 'PRNG stream must differ for different seed offset');
  }
}
console.log('  -> PASS: Seed mapping formula strictly adheres to 1000 + nodeId + seedOffset.');

// -----------------------------------------------------------------------------
// Test 5: GroundNodeTrafficSubsystem Integration & Backwards Compatibility
// -----------------------------------------------------------------------------
console.log('\n[5/8] Verifying GroundNodeTrafficSubsystem integration and standalone compatibility...');
// Case A: Instantiated via explicit NodeIdentity
const customIdentity: NodeIdentity = {
  entityId: formatDeterministicNodeUuid(7),
  nodeId: 7,
  creationSequence: 7,
  callsign: 'S7',
  role: 'soldier',
  colorHex: '#38bdf8',
};
const subsystemExplicit = new GroundNodeTrafficSubsystem(7, 'soldier', [100, 200, 10], 1007, undefined, customIdentity);
assert.equal(subsystemExplicit.nodeId, 7);
assert.equal(subsystemExplicit.creationSequence, 7);
assert.equal(subsystemExplicit.entityId, customIdentity.entityId);
assert.deepEqual(subsystemExplicit.identity, customIdentity);

// Case B: Legacy standalone instantiation (no identity passed)
const subsystemLegacy = new GroundNodeTrafficSubsystem(3, 'soldier', [0, 0, 0], 1003);
assert.equal(subsystemLegacy.nodeId, 3, 'nodeId must be 3');
assert.equal(subsystemLegacy.creationSequence, 3, 'creationSequence must default to nodeId');
assert.ok(UUID_V4_REGEX.test(subsystemLegacy.entityId), 'entityId must default to valid UUID v4');
assert.equal(subsystemLegacy.identity.callsign, 'S3');
assert.equal(subsystemLegacy.identity.role, 'soldier');

// Case C: MCP legacy instantiation
const subsystemMcp = new GroundNodeTrafficSubsystem(15, 'mcp', [0, 0, 0], 1015);
assert.equal(subsystemMcp.nodeId, 15);
assert.equal(subsystemMcp.creationSequence, 15);
assert.equal(subsystemMcp.identity.callsign, 'MCP');
assert.equal(subsystemMcp.identity.role, 'mcp');
console.log('  -> PASS: GroundNodeTrafficSubsystem seamlessly defaults or adopts NodeIdentity with 100% backwards compatibility.');

// -----------------------------------------------------------------------------
// Test 6: Worker Simulation & Authoritative Telemetry Emission
// -----------------------------------------------------------------------------
console.log('\n[6/8] Verifying Worker Simulation & Authoritative Telemetry Emission...');
const sim = new SimulationWorkerManager(100_000);

assert.ok(sim.nodeRegistry, 'sim.nodeRegistry must be initialized on worker manager');
assert.equal(sim.nodeRegistry.size, 16, 'Worker registry must have 16 nodes');
assert.equal(sim.nodesTac.length, 16, 'sim.nodesTac must contain 16 subsystems');
assert.equal(sim.nodesStatic.length, 16, 'sim.nodesStatic must contain 16 subsystems');

// Check entity lookup helper
const entity4 = sim.getNodeEntity(4);
assert.ok(entity4);
assert.equal(entity4.identity.nodeId, 4);
assert.equal(entity4.identity.creationSequence, 4);

const entity4ByUuid = sim.getNodeEntity(entity4.identity.entityId);
assert.ok(entity4ByUuid);
assert.equal(entity4ByUuid.identity.nodeId, 4);

// Verify telemetry frame carries entity_id and creation_sequence
const frame = (sim as any).buildTelemetryFrame(sim.trajectoryEngine.getAcnPosition(sim.simTimeS));
assert.ok(Array.isArray(frame.nodes_telemetry), 'nodes_telemetry must be an array');
assert.equal(frame.nodes_telemetry.length, 16, 'nodes_telemetry must contain 16 items');

for (let i = 0; i < 16; i++) {
  const item = frame.nodes_telemetry[i];
  assert.equal(item.node_id, i, `Telemetry item ${i} node_id must be ${i}`);
  assert.equal(item.creation_sequence, i, `Telemetry item ${i} creation_sequence must be ${i}`);
  assert.ok(UUID_V4_REGEX.test(item.entity_id), `Telemetry item ${i} entity_id must be valid UUID v4`);
  assert.equal(item.entity_id, sim.nodesTac[i].entityId, `Telemetry entity_id must match subsystem entityId`);
  assert.equal(item.name, i === 15 ? 'MCP' : `S${i}`);
}

// Verify obstruction state snapshot also carries entity_id and creation_sequence
const obsSnapshot = (sim as any).getObstructionStateSnapshot();
assert.equal(obsSnapshot.length, 16);
for (let i = 0; i < 16; i++) {
  assert.equal(obsSnapshot[i].node_id, i);
  assert.equal(obsSnapshot[i].creation_sequence, i);
  assert.equal(obsSnapshot[i].entity_id, sim.nodesTac[i].entityId);
}
console.log('  -> PASS: Worker telemetry frames faithfully carry entity_id and creation_sequence.');

// -----------------------------------------------------------------------------
// Test 7: Spatial & AGL Mutation Synchronization
// -----------------------------------------------------------------------------
console.log('\n[7/8] Verifying Spatial and AGL mutation synchronization...');
const targetNodeId = 2;
const initialPos = [...sim.nodesTac[targetNodeId].position];
const newX = 25000.0;
const newY = -15000.0;

// Move node via NODE_MOVE
const moveRes = sim.handleMessage({
  type: 'NODE_MOVE',
  node_id: targetNodeId,
  x_m: newX,
  y_m: newY,
});
assert.equal(moveRes.accepted, true, 'NODE_MOVE must be accepted');

// Verify active subsystems updated
assert.equal(sim.nodesTac[targetNodeId].position[0], newX);
assert.equal(sim.nodesTac[targetNodeId].position[1], newY);
assert.equal(sim.nodesStatic[targetNodeId].position[0], newX);
assert.equal(sim.nodesStatic[targetNodeId].position[1], newY);

// Verify registry record updated in lockstep
const regNode = sim.nodeRegistry.getByNodeId(targetNodeId);
assert.ok(regNode);
assert.deepEqual(regNode.position, [newX, newY], 'Registry position must stay synchronized with NODE_MOVE');

// Update AGL via CONFIG_UPDATE
const newAgl = 18.5;
const aglRes = sim.handleMessage({
  type: 'CONFIG_UPDATE',
  params: {
    node_id: targetNodeId,
    agl_m: newAgl,
  },
});
assert.equal(aglRes.accepted, true, 'CONFIG_UPDATE with agl_m must be accepted');
assert.equal(sim.nodesTac[targetNodeId].aglM, newAgl);
assert.equal(sim.nodesStatic[targetNodeId].aglM, newAgl);
assert.equal(regNode.aglM, newAgl, 'Registry aglM must stay synchronized with CONFIG_UPDATE');
console.log('  -> PASS: Spatial coordinates and antenna AGL remain strictly synchronized between subsystems and registry.');

// -----------------------------------------------------------------------------
// Test 8: Boundary Conditions, Invalid Lookups & Duplicate Protection
// -----------------------------------------------------------------------------
console.log('\n[8/8] Verifying boundary conditions, negative lookups, and duplicate protection...');
// Out of bounds / invalid node IDs
assert.equal(registry.getByNodeId(-1), undefined);
assert.equal(registry.getByNodeId(16), undefined);
assert.equal(registry.getByNodeId(999), undefined);
assert.equal(registry.hasNodeId(-1), false);
assert.equal(registry.hasNodeId(16), false);

// Out of bounds entity IDs
assert.equal(registry.getByEntityId('non-existent-uuid'), undefined);
assert.equal(registry.getByEntityId(''), undefined);
assert.equal(registry.hasEntityId('unknown'), false);

// Duplicate registration rejection
assert.throws(() => {
  registry.register({
    identity: {
      entityId: formatDeterministicNodeUuid(0), // duplicate UUID
      nodeId: 99,
      creationSequence: 99,
      callsign: 'DUP',
      role: 'soldier',
    },
    position: [0, 0],
    aglM: 2.0,
    trafficOptions: {},
    seed: 1099,
  });
}, /duplicate entityId/, 'Must reject duplicate entityId');

assert.throws(() => {
  registry.register({
    identity: {
      entityId: '00000000-0000-4000-8000-000000000099',
      nodeId: 0, // duplicate nodeId
      creationSequence: 99,
      callsign: 'DUP',
      role: 'soldier',
    },
    position: [0, 0],
    aglM: 2.0,
    trafficOptions: {},
    seed: 1099,
  });
}, /duplicate nodeId/, 'Must reject duplicate nodeId');

// Immutability of returned array
const entities1 = registry.getAll();
const initialLen = entities1.length;
(entities1 as any).push({} as any);
assert.equal(registry.getAll().length, initialLen, 'getAll() must return a shallow copy protecting internal collection');
console.log('  -> PASS: Boundary conditions, negative lookups, and duplicate protections behave as specified.');

console.log('\n' + '='.repeat(92));
console.log('  ALL 8 M1a STABLE IDENTITY & REGISTRY TESTS PASSED WITH 100% SUCCESS!');
console.log('='.repeat(92));
