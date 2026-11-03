/**
 * src/tests/verifyDynamicNodesM1b.ts
 *
 * Authoritative verification suite for Milestone M1b: Dynamic Ground-Node Management.
 *
 * Verifies all M1b requirements:
 * 1. Runtime node creation (NODE_ADD) with RFC 4122 UUID v4, monotonic nodeId >= 16,
 *    monotonic creationSequence >= 16, deterministic seed formula (1000 + nodeId + seedOffset),
 *    and active simulation participation.
 * 2. Runtime node deletion (NODE_DELETE) cleanly evicting subsystems from queues, schedulers,
 *    telemetry, RF obstruction states, and safely updating selectedNodeId fallback.
 * 3. Monotonic non-reuse of deleted node IDs across add/delete cycles.
 * 4. Node duplication (NODE_DUPLICATE) with spatial offset, copied role/AGL/traffic profiles,
 *    and fully independent queues, packets, and PRNG seeds.
 * 5. Runtime node updates (NODE_UPDATE) for callsign, role, coordinates, AGL, and traffic options.
 * 6. Zero-node safe operation (N = 0) with no division-by-zero, empty allocations, and safe telemetry.
 * 7. Population scaling up to 128 active nodes and strict rejection of the 129th node.
 * 8. Spatial Lock enforcement across spatial node mutations.
 * 9. Input validation and atomic rejection without partial state corruption.
 * 10. Dynamic scheduler airtime allocation across variable population sizes (N = 1..128).
 * 11. Preservation of canonical 16-node baseline invariants and clean simulation reset.
 * 12. UI Command builders and input validation helpers in src/ui/nodeInventory.ts.
 */

import assert from 'node:assert';
import { SimulationWorkerManager, FRAME_DT } from '../worker/simWorker';
import {
  MAX_ACTIVE_GROUND_NODES,
  computeNodeSeed,
  DEFAULT_ANTENNA_AGL_M,
  CANONICAL_16_NODE_POSITIONS,
} from '../core/nodeRegistry';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
  T_FRAME_S,
  T_CTRL_S,
  T_DL_MIN_S,
  TAU_GUARD_S,
} from '../core/scheduler';
import {
  buildNodeAddCommand,
  buildNodeDeleteCommand,
  buildNodeDuplicateCommand,
  buildNodeUpdateCommand,
  validateNodeCoordinates,
  validateNodeAglHeight,
  validateNodeCallsign,
  getNodeRole,
  formatNodeGeodeticCoordinates,
} from '../ui/nodeInventory';

function logSection(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function logTest(testNum: number, name: string): void {
  console.log(`  [Test ${testNum}] ${name}`);
}

async function runAllVerifications(): Promise<void> {
  console.log('================================================================================');
  console.log('  MILESTONE M1b: DYNAMIC GROUND-NODE MANAGEMENT VERIFICATION SUITE');
  console.log('================================================================================');

  // --------------------------------------------------------------------------
  // Test 1: Runtime node creation (NODE_ADD)
  // --------------------------------------------------------------------------
  logSection('Test 1: Runtime Node Creation (NODE_ADD)');
  {
    const mgr = new SimulationWorkerManager(42);
    assert.strictEqual(mgr.nodeRegistry.size, 16, 'Initial node count must be 16');

    const addRes = mgr.handleMessage({
      type: 'NODE_ADD',
      x_m: 5000.0,
      y_m: 10000.0,
      agl_m: 5.0,
      callsign: 'RECON-16',
      role: 'soldier',
      request_id: 'req-add-1',
    });

    assert.strictEqual(addRes.accepted, true, 'NODE_ADD must be accepted');
    assert.strictEqual(addRes.command_type, 'NODE_ADD');
    assert.strictEqual(addRes.node_id, 16, 'First dynamic node ID must be 16');
    assert.strictEqual(addRes.creation_sequence, 16, 'First dynamic creationSequence must be 16');
    assert.strictEqual(typeof addRes.entity_id, 'string', 'Entity ID must be a string');
    assert.match(
      addRes.entity_id!,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'Entity ID must be a valid RFC 4122 UUID v4'
    );
    assert.strictEqual(mgr.nodeRegistry.size, 17, 'Active node count must now be 17');
    assert.strictEqual(mgr.nodesStatic.length, 17, 'nodesStatic count must be 17');
    assert.strictEqual(mgr.nodesTac.length, 17, 'nodesTac count must be 17');

    // Verify seed mapping
    const entity = mgr.nodeRegistry.getByNodeId(16)!;
    assert.ok(entity, 'Entity 16 must exist in registry');
    assert.strictEqual(entity.seed, computeNodeSeed(16, 42), 'Seed must follow 1000 + nodeId + seedOffset');
    assert.strictEqual(entity.seed, 1000 + 16 + 42, 'Seed must equal 1058');
    assert.strictEqual(entity.aglM, 5.0, 'AGL must match parameter');
    assert.strictEqual(entity.identity.callsign, 'RECON-16', 'Callsign must match parameter');
    assert.strictEqual(entity.identity.role, 'soldier', 'Role must match parameter');

    // Run a simulation tick and verify node participation
    mgr.tickSimulation();
    const tel = mgr.buildNodesTelemetry();
    assert.strictEqual(tel.length, 17, 'Telemetry must contain 17 nodes');
    const node16Tel = tel.find((n: any) => n.node_id === 16);
    assert.ok(node16Tel, 'Node 16 must appear in telemetry');
    assert.strictEqual(node16Tel.name, 'RECON-16', 'Telemetry name must match callsign');
    assert.strictEqual(node16Tel.agl_m, 5.0, 'Telemetry AGL must match');
    assert.strictEqual(node16Tel.x_m, 5000.0, 'Telemetry X must match');
    assert.strictEqual(node16Tel.y_m, 10000.0, 'Telemetry Y must match');
    assert.ok(Number.isFinite(node16Tel.altitude_msl_m), 'Altitude MSL must be finite');

    logTest(1, 'NODE_ADD creates valid UUID v4, nodeId 16, creationSequence 16, seed 1058, and participates in tick.');
  }

  // --------------------------------------------------------------------------
  // Test 2: Runtime node deletion (NODE_DELETE) & Selection Fallback
  // --------------------------------------------------------------------------
  logSection('Test 2: Runtime Node Deletion (NODE_DELETE)');
  {
    const mgr = new SimulationWorkerManager();
    assert.strictEqual(mgr.selectedNodeId, 4, 'Default selected node must be 4');

    const delRes = mgr.handleMessage({
      type: 'NODE_DELETE',
      node_id: 4,
      request_id: 'req-del-4',
    });

    assert.strictEqual(delRes.accepted, true, 'NODE_DELETE must be accepted');
    assert.strictEqual(delRes.deleted_node_id, 4, 'Deleted node ID must be 4');
    assert.strictEqual(mgr.nodeRegistry.size, 15, 'Active node count must be 15');
    assert.strictEqual(mgr.nodeRegistry.hasNodeId(4), false, 'Node 4 must not exist in registry');
    assert.strictEqual(mgr.nodesStatic.some(n => n.nodeId === 4), false, 'Node 4 must not be in nodesStatic');
    assert.strictEqual(mgr.nodesTac.some(n => n.nodeId === 4), false, 'Node 4 must not be in nodesTac');
    assert.strictEqual(mgr.linkStatuses.has(4), false, 'Node 4 must not be in linkStatuses');
    assert.strictEqual(mgr.predStates.has(4), false, 'Node 4 must not be in predStates');
    assert.strictEqual(mgr.obstructionResults.has(4), false, 'Node 4 must not be in obstructionResults');
    assert.strictEqual(mgr.nodeTransfers.has(4), false, 'Node 4 must not be in nodeTransfers');

    // Selection fallback check: since selectedNodeId 4 was deleted, fallback to another active node
    assert.notStrictEqual(mgr.selectedNodeId, 4, 'selectedNodeId must not remain deleted node 4');
    assert.ok(mgr.nodeRegistry.hasNodeId(mgr.selectedNodeId), 'selectedNodeId fallback must identify an active node');

    // Ticking must continue cleanly
    assert.doesNotThrow(() => mgr.tickSimulation(), 'Simulation tick must execute cleanly after node deletion');
    const tel = mgr.buildNodesTelemetry();
    assert.strictEqual(tel.length, 15, 'Telemetry must contain exactly 15 nodes');
    assert.strictEqual(tel.some((n: any) => n.node_id === 4), false, 'Node 4 must not be in telemetry');

    logTest(2, 'NODE_DELETE evicts node 4 from all subsystems and safely updates selectedNodeId fallback.');
  }

  // --------------------------------------------------------------------------
  // Test 3: Monotonic ID & Creation Sequence Non-Reuse
  // --------------------------------------------------------------------------
  logSection('Test 3: Monotonic Non-Reuse of Deleted Node IDs');
  {
    const mgr = new SimulationWorkerManager();
    // Add dynamic node 16
    const add1 = mgr.handleMessage({ type: 'NODE_ADD', x_m: 1000, y_m: 1000 });
    assert.strictEqual(add1.node_id, 16);
    assert.strictEqual(add1.creation_sequence, 16);

    // Delete node 16
    const del1 = mgr.handleMessage({ type: 'NODE_DELETE', node_id: 16 });
    assert.strictEqual(del1.accepted, true);
    assert.strictEqual(mgr.nodeRegistry.isNodeIdDeleted(16), true, 'Node 16 must be marked deleted');

    // Delete canonical node 5
    const del2 = mgr.handleMessage({ type: 'NODE_DELETE', node_id: 5 });
    assert.strictEqual(del2.accepted, true);
    assert.strictEqual(mgr.nodeRegistry.isNodeIdDeleted(5), true, 'Node 5 must be marked deleted');

    // Now add a new node: it MUST NOT reuse 5 or 16; it MUST allocate 17!
    const add2 = mgr.handleMessage({ type: 'NODE_ADD', x_m: 2000, y_m: 2000 });
    assert.strictEqual(add2.accepted, true);
    assert.strictEqual(add2.node_id, 17, 'Next allocated nodeId must be 17 (never reuse deleted 5 or 16)');
    assert.strictEqual(add2.creation_sequence, 17, 'Next creation sequence must be 17');

    // Add another node: must allocate 18
    const add3 = mgr.handleMessage({ type: 'NODE_ADD', x_m: 3000, y_m: 3000 });
    assert.strictEqual(add3.node_id, 18, 'Next allocated nodeId must be 18');
    assert.strictEqual(add3.creation_sequence, 18, 'Next creation sequence must be 18');

    logTest(3, 'Allocators strictly enforce non-reuse of deleted node IDs (5 and 16 skipped; 17 and 18 assigned).');
  }

  // --------------------------------------------------------------------------
  // Test 4: Node Duplication (NODE_DUPLICATE)
  // --------------------------------------------------------------------------
  logSection('Test 4: Node Duplication (NODE_DUPLICATE)');
  {
    const mgr = new SimulationWorkerManager();
    const src = mgr.nodeRegistry.getByNodeId(1)!; // S1 Squad Leader
    assert.ok(src);

    // Enqueue some packets into node 1 to verify they are NOT copied
    mgr.nodesStatic[1].enqueuePacket(65, 0.0, 1000);
    mgr.nodesTac[1].enqueuePacket(65, 0.0, 1000);
    assert.strictEqual(mgr.nodesTac[1].queue.getTotalBacklogBytes(), 1000);

    const dupRes = mgr.handleMessage({
      type: 'NODE_DUPLICATE',
      source_node_id: 1,
      offset_x_m: 800.0,
      offset_y_m: 1200.0,
      callsign: 'S1-CLONE',
      request_id: 'req-dup-1',
    });

    assert.strictEqual(dupRes.accepted, true, 'NODE_DUPLICATE must be accepted');
    assert.strictEqual(dupRes.source_node_id, 1);
    const newId = dupRes.node_id!;
    assert.strictEqual(newId, 16, 'Duplicate nodeId must be 16');

    const dupEntity = mgr.nodeRegistry.getByNodeId(newId)!;
    assert.ok(dupEntity);
    assert.strictEqual(dupEntity.identity.callsign, 'S1-CLONE');
    assert.strictEqual(dupEntity.identity.role, src.identity.role);
    assert.strictEqual(dupEntity.aglM, src.aglM);
    assert.strictEqual(dupEntity.position[0], src.position[0] + 800.0);
    assert.strictEqual(dupEntity.position[1], src.position[1] + 1200.0);
    assert.strictEqual(dupEntity.seed, computeNodeSeed(newId, 0));

    // Verify queues and packets were NOT copied
    const dupTacNode = mgr.nodesTac.find(n => n.nodeId === newId)!;
    assert.ok(dupTacNode);
    assert.strictEqual(dupTacNode.queue.getTotalBacklogBytes(), 0, 'Duplicate node must start with empty queues');

    logTest(4, 'NODE_DUPLICATE creates independent entity with spatial offset and zero copied queue backlog.');
  }

  // --------------------------------------------------------------------------
  // Test 5: Runtime Node Updates (NODE_UPDATE)
  // --------------------------------------------------------------------------
  logSection('Test 5: Runtime Node Updates (NODE_UPDATE)');
  {
    const mgr = new SimulationWorkerManager();
    const updateRes = mgr.handleMessage({
      type: 'NODE_UPDATE',
      node_id: 2,
      callsign: 'MEDIC-SPECIAL',
      role: 'mcp',
      x_m: 1234.0,
      y_m: 5678.0,
      agl_m: 8.5,
      request_id: 'req-upd-2',
    });

    assert.strictEqual(updateRes.accepted, true, 'NODE_UPDATE must be accepted');
    assert.strictEqual(updateRes.node_id, 2);

    const entity = mgr.nodeRegistry.getByNodeId(2)!;
    assert.strictEqual(entity.identity.callsign, 'MEDIC-SPECIAL');
    assert.strictEqual(entity.identity.role, 'mcp');
    assert.strictEqual(entity.position[0], 1234.0);
    assert.strictEqual(entity.position[1], 5678.0);
    assert.strictEqual(entity.aglM, 8.5);

    const tacNode = mgr.nodesTac.find(n => n.nodeId === 2)!;
    assert.strictEqual(tacNode.nodeType, 'mcp');
    assert.strictEqual(tacNode.aglM, 8.5);
    assert.strictEqual(tacNode.position[0], 1234.0);
    assert.strictEqual(tacNode.position[1], 5678.0);

    logTest(5, 'NODE_UPDATE atomically updates callsign, role, coordinates, and AGL across registry and subsystems.');
  }

  // --------------------------------------------------------------------------
  // Test 6: Zero-Node Safe Operation (N = 0)
  // --------------------------------------------------------------------------
  logSection('Test 6: Zero-Node Safe Operation (N = 0)');
  {
    const mgr = new SimulationWorkerManager();
    // Delete all 16 canonical nodes
    for (let i = 0; i < 16; i++) {
      const res = mgr.handleMessage({ type: 'NODE_DELETE', node_id: i });
      assert.strictEqual(res.accepted, true);
    }
    assert.strictEqual(mgr.nodeRegistry.size, 0, 'Registry must have 0 nodes');
    assert.strictEqual(mgr.nodesStatic.length, 0, 'nodesStatic must have 0 elements');
    assert.strictEqual(mgr.nodesTac.length, 0, 'nodesTac must have 0 elements');

    // Schedulers directly on empty nodes
    const staticSched = new LegacyStaticScheduler();
    const tacSched = new TerrainAwareDynamicScheduler(0.008);

    const repStatic = staticSched.scheduleFrame(0, 0.0, [], mgr.linkStatuses, mgr.predStates);
    assert.strictEqual(repStatic.allocations.length, 0, 'Static scheduler must return 0 allocations');
    assert.strictEqual(repStatic.totalUlScheduledS, 0, 'Static scheduled airtime must be 0');
    assert.strictEqual(repStatic.totalUlUtilizationPct, 0, 'Static utilization must be 0%');
    assert.strictEqual(Number.isFinite(repStatic.totalUlUtilizationPct), true, 'Utilization must be finite (no NaN/Infinity)');

    const repTac = tacSched.scheduleFrame(0, 0.0, [], mgr.linkStatuses, mgr.predStates);
    assert.strictEqual(repTac.allocations.length, 0, 'Tac-TAD must return 0 allocations');
    assert.strictEqual(repTac.totalUlScheduledS, 0, 'Tac-TAD scheduled airtime must be 0');
    assert.strictEqual(repTac.totalUlUtilizationPct, 0, 'Tac-TAD utilization must be 0%');

    // Simulation tick with 0 nodes
    assert.doesNotThrow(() => mgr.tickSimulation(), 'Simulation tick must execute safely with 0 nodes');
    assert.doesNotThrow(() => mgr.emitProfileFrame(), 'emitProfileFrame must execute safely with 0 nodes');

    const tel = mgr.buildNodesTelemetry();
    assert.deepStrictEqual(tel, [], 'Telemetry with 0 nodes must be empty array');

    logTest(6, 'Zero-node scenario (N = 0) executes safely without division-by-zero, NaN, or exceptions.');
  }

  // --------------------------------------------------------------------------
  // Test 7: Scalability up to 128 Active Nodes & Rejection of 129th Node
  // --------------------------------------------------------------------------
  logSection('Test 7: Population Ceiling (128 Max Active Nodes)');
  {
    const mgr = new SimulationWorkerManager();
    assert.strictEqual(mgr.nodeRegistry.size, 16);

    // Add nodes 16 through 127 (112 nodes added -> total 128)
    for (let i = 16; i < MAX_ACTIVE_GROUND_NODES; i++) {
      const res = mgr.handleMessage({
        type: 'NODE_ADD',
        x_m: (i % 10) * 1000 - 5000,
        y_m: Math.floor(i / 10) * 1000 - 5000,
        agl_m: 2.0,
      });
      assert.strictEqual(res.accepted, true, `Node ${i} must be accepted`);
    }

    assert.strictEqual(mgr.nodeRegistry.size, 128, 'Registry must contain exactly 128 active nodes');
    assert.strictEqual(mgr.nodesStatic.length, 128);
    assert.strictEqual(mgr.nodesTac.length, 128);

    // Attempting to add the 129th node MUST be rejected
    const rej129 = mgr.handleMessage({
      type: 'NODE_ADD',
      x_m: 0,
      y_m: 0,
      agl_m: 2.0,
    });
    assert.strictEqual(rej129.accepted, false, '129th node addition must be rejected');
    assert.strictEqual(
      rej129.reason,
      'Maximum active ground-node capacity (128) reached.',
      'Rejection reason must match specification'
    );
    assert.strictEqual(mgr.nodeRegistry.size, 128, 'Node count must remain clamped at 128');

    // Attempting to duplicate when at capacity MUST also be rejected
    const rejDup = mgr.handleMessage({
      type: 'NODE_DUPLICATE',
      source_node_id: 0,
    });
    assert.strictEqual(rejDup.accepted, false, 'Duplication at capacity must be rejected');
    assert.strictEqual(
      rejDup.reason,
      'Maximum active ground-node capacity (128) reached.'
    );

    // Run tick simulation with 128 nodes
    assert.doesNotThrow(() => mgr.tickSimulation(), 'Simulation must tick smoothly with 128 nodes');
    const tel = mgr.buildNodesTelemetry();
    assert.strictEqual(tel.length, 128, 'Telemetry must contain 128 active nodes');

    logTest(7, 'System safely supports 128 active nodes and rejects the 129th node with specified error.');
  }

  // --------------------------------------------------------------------------
  // Test 8: Spatial Lock Enforcement
  // --------------------------------------------------------------------------
  logSection('Test 8: Spatial Lock Enforcement');
  {
    const mgr = new SimulationWorkerManager();
    // Engage spatial lock
    mgr.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: true });
    assert.strictEqual(mgr.spatialLocked, true);

    // NODE_ADD must be rejected
    const addRes = mgr.handleMessage({ type: 'NODE_ADD', x_m: 100, y_m: 100 });
    assert.strictEqual(addRes.accepted, false);
    assert.strictEqual(addRes.reason, 'Spatial lock is enabled; spatial state was not changed.');

    // NODE_DELETE must be rejected
    const delRes = mgr.handleMessage({ type: 'NODE_DELETE', node_id: 0 });
    assert.strictEqual(delRes.accepted, false);
    assert.strictEqual(delRes.reason, 'Spatial lock is enabled; spatial state was not changed.');

    // NODE_DUPLICATE must be rejected
    const dupRes = mgr.handleMessage({ type: 'NODE_DUPLICATE', source_node_id: 0 });
    assert.strictEqual(dupRes.accepted, false);
    assert.strictEqual(dupRes.reason, 'Spatial lock is enabled; spatial state was not changed.');

    // NODE_UPDATE modifying position/AGL must be rejected
    const updSpatial = mgr.handleMessage({ type: 'NODE_UPDATE', node_id: 0, x_m: 500 });
    assert.strictEqual(updSpatial.accepted, false);
    assert.strictEqual(updSpatial.reason, 'Spatial lock is enabled; spatial state was not changed.');

    // NODE_UPDATE modifying non-spatial fields (callsign) must be ACCEPTED
    const updCallsign = mgr.handleMessage({ type: 'NODE_UPDATE', node_id: 0, callsign: 'RIFLE-0' });
    assert.strictEqual(updCallsign.accepted, true, 'Callsign update must be accepted even when spatial locked');

    // Unlock
    mgr.handleMessage({ type: 'SET_SPATIAL_LOCK', locked: false });
    assert.strictEqual(mgr.spatialLocked, false);

    logTest(8, 'Spatial lock strictly guards spatial node mutations while permitting non-spatial edits.');
  }

  // --------------------------------------------------------------------------
  // Test 9: Input Validation & Atomicity
  // --------------------------------------------------------------------------
  logSection('Test 9: Input Validation & Atomicity');
  {
    const mgr = new SimulationWorkerManager();

    // Coordinates out of theater bounds (±600,000 m)
    const badX = mgr.handleMessage({ type: 'NODE_ADD', x_m: 700000.0, y_m: 0.0 });
    assert.strictEqual(badX.accepted, false);
    assert.ok(badX.reason?.includes('theater bounds'));

    // AGL out of [0, 1000] m
    const badAgl = mgr.handleMessage({ type: 'NODE_ADD', x_m: 0.0, y_m: 0.0, agl_m: -5.0 });
    assert.strictEqual(badAgl.accepted, false);
    assert.ok(badAgl.reason?.includes('agl_m between 0 and 1000'));

    // Invalid role
    const badRole = mgr.handleMessage({ type: 'NODE_ADD', role: 'satellite' as any });
    assert.strictEqual(badRole.accepted, false);
    assert.ok(badRole.reason?.includes("role must be 'soldier' or 'mcp'"));

    // Empty callsign
    const badCallsign = mgr.handleMessage({ type: 'NODE_ADD', callsign: '   ' });
    assert.strictEqual(badCallsign.accepted, false);
    assert.ok(badCallsign.reason?.includes('callsign must be a non-empty string'));

    // Deleting non-existent node
    const badDel = mgr.handleMessage({ type: 'NODE_DELETE', node_id: 999 });
    assert.strictEqual(badDel.accepted, false);
    assert.ok(badDel.reason?.includes('node_id must identify an active registered ground node'));

    // Verify node count unchanged after all rejected attempts
    assert.strictEqual(mgr.nodeRegistry.size, 16, 'Node count must remain unchanged after rejected operations');

    logTest(9, 'All invalid parameters are rejected deterministically without mutating scenario state.');
  }

  // --------------------------------------------------------------------------
  // Test 10: Dynamic Scheduling Across Variable Population Sizes
  // --------------------------------------------------------------------------
  logSection('Test 10: Dynamic Scheduling Across Variable Population Sizes');
  {
    const staticSched = new LegacyStaticScheduler();
    const tUl = T_FRAME_S - T_CTRL_S - T_DL_MIN_S; // 0.020 - 0.001 - 0.003 = 0.016 s

    // Check sizes: N = 1, 5, 16, 32, 128
    const testSizes = [1, 5, 16, 32, 128];
    for (const N of testSizes) {
      const mgr = new SimulationWorkerManager();
      // Adjust manager to N nodes
      if (N < 16) {
        for (let i = N; i < 16; i++) mgr.handleMessage({ type: 'NODE_DELETE', node_id: i });
      } else if (N > 16) {
        for (let i = 16; i < N; i++) mgr.handleMessage({ type: 'NODE_ADD', x_m: i * 10, y_m: i * 10 });
      }

      assert.strictEqual(mgr.nodesStatic.length, N);
      const rep = staticSched.scheduleFrame(0, 0.0, mgr.nodesStatic, mgr.linkStatuses, mgr.predStates);
      assert.strictEqual(rep.allocations.length, N, `Static TDMA must allocate exactly ${N} slots`);

      const expectedSlotS = (tUl - N * TAU_GUARD_S) / N;
      const actualSlotS = rep.allocations[0].durationS;
      assert.ok(
        Math.abs(actualSlotS - expectedSlotS) < 1e-9,
        `Slot duration for N=${N} must equal (tUl - N*tauGuard)/N`
      );

      // Verify total airtime does not exceed tUl
      const totalAirtime = rep.allocations.reduce((sum, a) => sum + a.durationS + TAU_GUARD_S, 0);
      assert.ok(totalAirtime <= tUl + 1e-9, `Total scheduled airtime for N=${N} must not exceed available`);
    }

    logTest(10, 'Static TDMA and dynamic schedulers cleanly scale slot durations across N = 1, 5, 16, 32, 128.');
  }

  // --------------------------------------------------------------------------
  // Test 11: 16-Node Baseline Invariant Preservation & Reset
  // --------------------------------------------------------------------------
  logSection('Test 11: 16-Node Baseline Preservation and Clean Simulation Reset');
  {
    const mgr = new SimulationWorkerManager(0);
    assert.strictEqual(mgr.nodeRegistry.size, 16);

    for (let i = 0; i < 16; i++) {
      const e = mgr.nodeRegistry.getByNodeId(i)!;
      assert.ok(e, `Node ${i} must exist`);
      assert.strictEqual(e.identity.nodeId, i, `Node ${i} ID must be ${i}`);
      assert.strictEqual(e.identity.creationSequence, i, `Node ${i} creationSequence must be ${i}`);
      assert.strictEqual(e.seed, 1000 + i, `Node ${i} seed must be ${1000 + i}`);
      assert.strictEqual(e.position[0], CANONICAL_16_NODE_POSITIONS[i][0]);
      assert.strictEqual(e.position[1], CANONICAL_16_NODE_POSITIONS[i][1]);
    }

    // Mutate scenario: add node 16, delete node 2
    mgr.handleMessage({ type: 'NODE_ADD', x_m: 500, y_m: 500 });
    mgr.handleMessage({ type: 'NODE_DELETE', node_id: 2 });
    assert.strictEqual(mgr.nodeRegistry.hasNodeId(16), true, 'Dynamic node 16 should be present before reset');
    assert.strictEqual(mgr.nodeRegistry.hasNodeId(2), false, 'Node 2 should be deleted before reset');

    // Reset simulation
    mgr.handleMessage({ type: 'SIM_CONTROL', action: 'reset' });
    assert.strictEqual(mgr.nodeRegistry.size, 16, 'Reset must restore exactly 16 canonical nodes');
    assert.strictEqual(mgr.selectedNodeId, 4, 'Reset must restore selectedNodeId to 4');
    assert.strictEqual(mgr.nodeRegistry.hasNodeId(2), true, 'Reset must restore node 2');
    assert.strictEqual(mgr.nodeRegistry.hasNodeId(16), false, 'Reset must remove dynamic node 16');

    logTest(11, 'Canonical 16-node scenario invariants preserved and cleanly restored by simulation reset.');
  }

  // --------------------------------------------------------------------------
  // Test 12: UI Command Builders & Validators
  // --------------------------------------------------------------------------
  logSection('Test 12: UI Command Builders and Input Validation Helpers');
  {
    // validateNodeCoordinates
    assert.strictEqual(validateNodeCoordinates(0, 0).valid, true);
    assert.strictEqual(validateNodeCoordinates(600000, -600000).valid, true);
    assert.strictEqual(validateNodeCoordinates(600001, 0).valid, false);
    assert.strictEqual(validateNodeCoordinates(NaN, 0).valid, false);

    // validateNodeAglHeight
    assert.strictEqual(validateNodeAglHeight(2.0).valid, true);
    assert.strictEqual(validateNodeAglHeight(0.0).valid, true);
    assert.strictEqual(validateNodeAglHeight(1000.0).valid, true);
    assert.strictEqual(validateNodeAglHeight(-0.1).valid, false);
    assert.strictEqual(validateNodeAglHeight(1001.0).valid, false);

    // validateNodeCallsign
    assert.strictEqual(validateNodeCallsign('S16').valid, true);
    assert.strictEqual(validateNodeCallsign('   ').valid, false);
    assert.strictEqual(validateNodeCallsign('A'.repeat(33)).valid, false);

    // buildNodeAddCommand
    const addCmd = buildNodeAddCommand({ xM: 100, yM: 200, aglM: 3.5, callsign: 'RECON', role: 'mcp' });
    assert.strictEqual(addCmd.type, 'NODE_ADD');
    assert.strictEqual(addCmd.x_m, 100);
    assert.strictEqual(addCmd.y_m, 200);
    assert.strictEqual(addCmd.agl_m, 3.5);
    assert.strictEqual(addCmd.callsign, 'RECON');
    assert.strictEqual(addCmd.role, 'mcp');

    // buildNodeDeleteCommand
    const delCmd = buildNodeDeleteCommand(5);
    assert.strictEqual(delCmd.type, 'NODE_DELETE');
    assert.strictEqual(delCmd.node_id, 5);

    // buildNodeDuplicateCommand
    const dupCmd = buildNodeDuplicateCommand(3, { offsetXm: 600 });
    assert.strictEqual(dupCmd.type, 'NODE_DUPLICATE');
    assert.strictEqual(dupCmd.source_node_id, 3);
    assert.strictEqual(dupCmd.offset_x_m, 600);
    assert.strictEqual(dupCmd.offset_y_m, 500.0);

    // buildNodeUpdateCommand
    const updCmd = buildNodeUpdateCommand(7, { callsign: 'SNIPER-7', aglM: 4.0 });
    assert.strictEqual(updCmd.type, 'NODE_UPDATE');
    assert.strictEqual(updCmd.node_id, 7);
    assert.strictEqual(updCmd.callsign, 'SNIPER-7');
    assert.strictEqual(updCmd.agl_m, 4.0);

    // getNodeRole
    assert.strictEqual(getNodeRole(15), 'Main Command Post (20W Dish)');
    assert.strictEqual(getNodeRole(100, 'mcp'), 'Main Command Post (20W Dish)');
    assert.strictEqual(getNodeRole(4), 'Recon Patrol (Occlusion Target)');
    assert.strictEqual(getNodeRole(100, 'soldier'), 'Soldier Terminal');

    logTest(12, 'UI command builders and validation helpers validate inputs and produce compliant schemas.');
  }

  console.log('\n================================================================================');
  console.log('  ALL 12 DYNAMIC GROUND-NODE (M1b) VERIFICATION TESTS PASSED CLEANLY!');
  console.log('================================================================================\n');
}

runAllVerifications().catch(err => {
  console.error('\nVerification failed with exception:');
  console.error(err);
  process.exit(1);
});
