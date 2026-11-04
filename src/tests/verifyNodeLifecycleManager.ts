/**
 * src/tests/verifyNodeLifecycleManager.ts
 *
 * Authoritative verification suite for Phase 2D: Ground Node Lifecycle Manager Extraction.
 *
 * Verifies all 12 Phase 2D requirements with strict ownership boundaries:
 * 1. Twin-node creation and matching IDs (createNodePair).
 * 2. Initial node initialization (initNodes).
 * 3. Add and duplicate operations (addNode, duplicateNode).
 * 4. Delete operation (deleteNode).
 * 5. Node update and registry synchronization (updateNode).
 * 6. Registration lifecycle event ordering.
 * 7. Worker TransferManager registration and eviction coordination.
 * 8. Worker scheduler eviction coordination.
 * 9. Worker selected-node fallback integration.
 * 10. Terrain resampling and AGL preservation.
 * 11. Deleted ID non-reuse.
 * 12. Validation atomicity: rejected operations must not partially mutate state.
 */

import assert from 'node:assert';
import {
  NodeLifecycleManager,
} from '../worker/nodeLifecycleManager';
import {
  NodeRegistry,
  createDefault16NodeRegistry,
} from '../core/nodeRegistry';
import { TerrainEngine } from '../core/terrain';
import { RegistrationLifecycle } from '../core/registration';
import { ActiveTransferManager } from '../core/transferManager';
import {
  LegacyStaticScheduler,
  TerrainAwareDynamicScheduler,
} from '../core/scheduler';
import { THEATER_HALF_M } from '../shared/constants';
import { SimulationWorkerManager } from '../worker/simWorker';

async function runAllVerifications(): Promise<void> {
  console.log('================================================================================');
  console.log('  PHASE 2D: GROUND NODE LIFECYCLE MANAGER VERIFICATION SUITE');
  console.log('================================================================================');

  const terrainEngine = new TerrainEngine({ theaterExtentM: THEATER_HALF_M, terrainMode: 'synthetic' });

  // --------------------------------------------------------------------------
  // Test 1: Twin-node creation and matching IDs (createNodePair)
  // --------------------------------------------------------------------------
  console.log('\n[1/12] Verifying twin-node creation and matching IDs (createNodePair)...');
  {
    const registry = new NodeRegistry(42);
    const entity = registry.createDynamicNode({
      callsign: 'TEST-SOLDIER',
      role: 'soldier',
      position: [1000.0, 2000.0],
      aglM: 3.5,
      txPowerDbm: 38.0,
      batteryCapacityMah: 8000,
      batteryLevelPct: 85.0,
      tacticalPriority: 2.5,
    });

    const [staticNode, tacNode] = NodeLifecycleManager.createNodePair(entity, terrainEngine);

    assert.strictEqual(staticNode.nodeId, entity.identity.nodeId, 'staticNode nodeId must match entity');
    assert.strictEqual(tacNode.nodeId, entity.identity.nodeId, 'tacNode nodeId must match entity');
    assert.strictEqual(staticNode.nodeId, tacNode.nodeId, 'Twin nodeIds must be identical');

    assert.strictEqual(staticNode.aglM, 3.5, 'staticNode aglM must match');
    assert.strictEqual(tacNode.aglM, 3.5, 'tacNode aglM must match');
    assert.strictEqual(staticNode.txPowerDbm, 38.0, 'staticNode txPowerDbm must match');
    assert.strictEqual(tacNode.txPowerDbm, 38.0, 'tacNode txPowerDbm must match');
    assert.strictEqual(staticNode.batteryCapacityMah, 8000, 'staticNode batteryCapacityMah must match');
    assert.strictEqual(tacNode.batteryCapacityMah, 8000, 'tacNode batteryCapacityMah must match');
    assert.strictEqual(staticNode.batteryLevelPct, 85.0, 'staticNode batteryLevelPct must match');
    assert.strictEqual(tacNode.batteryLevelPct, 85.0, 'tacNode batteryLevelPct must match');
    assert.strictEqual(staticNode.tacticalPriority, 2.5, 'staticNode tacticalPriority must match');
    assert.strictEqual(tacNode.tacticalPriority, 2.5, 'tacNode tacticalPriority must match');
    assert.strictEqual(staticNode.isDepleted, false, 'isDepleted must be false');
    assert.strictEqual(tacNode.isDepleted, false, 'isDepleted must be false');

    const expectedZ = terrainEngine.getElevation(1000.0, 2000.0) + 3.5;
    assert.strictEqual(staticNode.position[0], 1000.0);
    assert.strictEqual(staticNode.position[1], 2000.0);
    assert.strictEqual(staticNode.position[2], expectedZ, 'Z must equal terrain elevation + aglM');
    assert.strictEqual(tacNode.position[2], expectedZ, 'Tac Z must equal terrain elevation + aglM');

    console.log('  -> PASS: createNodePair constructs perfectly synchronized twin nodes.');
  }

  // --------------------------------------------------------------------------
  // Test 2: Initial node initialization (initNodes)
  // --------------------------------------------------------------------------
  console.log('\n[2/12] Verifying initial node initialization (initNodes)...');
  {
    const registry = createDefault16NodeRegistry(0);
    const { nodesStatic, nodesTac } = NodeLifecycleManager.initNodes(registry, terrainEngine);

    assert.strictEqual(nodesStatic.length, 16, 'nodesStatic count must be 16');
    assert.strictEqual(nodesTac.length, 16, 'nodesTac count must be 16');

    for (let i = 0; i < 16; i++) {
      assert.strictEqual(nodesStatic[i].nodeId, i, `nodesStatic[${i}] must have nodeId ${i}`);
      assert.strictEqual(nodesTac[i].nodeId, i, `nodesTac[${i}] must have nodeId ${i}`);
      assert.strictEqual(nodesStatic[i].nodeId, nodesTac[i].nodeId, 'Index-wise nodeIds must match exactly');
    }

    console.log('  -> PASS: initNodes constructs canonical 16-node dual-array layout.');
  }

  // --------------------------------------------------------------------------
  // Test 3: Add and duplicate operations
  // --------------------------------------------------------------------------
  console.log('\n[3/12] Verifying add and duplicate operations (addNode, duplicateNode)...');
  {
    const registry = createDefault16NodeRegistry(0);
    const regLifecycle = new RegistrationLifecycle();

    // Add node
    const addOutcome = NodeLifecycleManager.addNode({
      msg: {
        type: 'NODE_ADD',
        x_m: 5000.0,
        y_m: -6000.0,
        agl_m: 4.0,
        callsign: 'DYNAMIC-16',
        role: 'soldier',
        request_id: 'add-1',
      },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      terrainEngine,
      simTimeS: 1.5,
      spatialLocked: false,
    });

    assert.strictEqual(addOutcome.accepted, true);
    assert.ok(addOutcome.entity);
    assert.strictEqual(addOutcome.entity!.identity.nodeId, 16);
    assert.ok(addOutcome.nodePair);
    assert.strictEqual(addOutcome.nodePair![0].nodeId, 16);
    assert.strictEqual(addOutcome.nodePair![1].nodeId, 16);

    // Duplicate node 16
    const dupOutcome = NodeLifecycleManager.duplicateNode({
      msg: {
        type: 'NODE_DUPLICATE',
        source_node_id: 16,
        offset_x_m: 200.0,
        offset_y_m: 300.0,
        callsign: 'DYNAMIC-17',
        request_id: 'dup-1',
      },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      terrainEngine,
      simTimeS: 2.0,
      spatialLocked: false,
    });

    assert.strictEqual(dupOutcome.accepted, true);
    assert.ok(dupOutcome.entity);
    assert.strictEqual(dupOutcome.entity!.identity.nodeId, 17);
    assert.strictEqual(dupOutcome.sourceNodeId, 16);
    assert.ok(dupOutcome.nodePair);
    assert.strictEqual(dupOutcome.nodePair![0].position[0], 5200.0);
    assert.strictEqual(dupOutcome.nodePair![0].position[1], -5700.0);

    console.log('  -> PASS: addNode and duplicateNode create fully configured twin entities.');
  }

  // --------------------------------------------------------------------------
  // Test 4: Delete operation
  // --------------------------------------------------------------------------
  console.log('\n[4/12] Verifying delete operation (deleteNode)...');
  {
    const registry = createDefault16NodeRegistry(0);
    const regLifecycle = new RegistrationLifecycle();
    for (const id of registry.getNodeIds()) regLifecycle.add(id, 0.0);

    const delOutcome = NodeLifecycleManager.deleteNode({
      msg: { type: 'NODE_DELETE', node_id: 4, request_id: 'del-1' },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      simTimeS: 3.5,
      spatialLocked: false,
    });

    assert.strictEqual(delOutcome.accepted, true);
    assert.strictEqual(delOutcome.deletedNodeId, 4);
    assert.strictEqual(registry.hasNodeId(4), false, 'nodeRegistry must not have node 4');
    assert.strictEqual(registry.isNodeIdDeleted(4), true, 'nodeRegistry must record node 4 in deletedNodeIds tombstone');

    console.log('  -> PASS: deleteNode cleanly unregisters entity and removes registration state.');
  }

  // --------------------------------------------------------------------------
  // Test 5: Node update and registry synchronization
  // --------------------------------------------------------------------------
  console.log('\n[5/12] Verifying node update and registry synchronization (updateNode)...');
  {
    const registry = createDefault16NodeRegistry(0);
    const { nodesStatic, nodesTac } = NodeLifecycleManager.initNodes(registry, terrainEngine);

    const updateOutcome = NodeLifecycleManager.updateNode({
      msg: {
        type: 'NODE_UPDATE',
        node_id: 2,
        x_m: 11000.0,
        y_m: 22000.0,
        agl_m: 10.0,
        callsign: 'UPDATED-CALLSIGN',
        tx_power_dbm: 42.0,
        battery_level_pct: 60.0,
        tactical_priority: 3.0,
      },
      nodesStatic,
      nodesTac,
      nodeRegistry: registry,
      terrainEngine,
      spatialLocked: false,
    });

    assert.strictEqual(updateOutcome.accepted, true);
    assert.strictEqual(updateOutcome.nodeId, 2);
    assert.strictEqual(updateOutcome.spatialChanged, true);

    const sNode = nodesStatic.find(n => n.nodeId === 2)!;
    const tNode = nodesTac.find(n => n.nodeId === 2)!;
    const entity = registry.getByNodeId(2)!;

    assert.strictEqual(sNode.position[0], 11000.0);
    assert.strictEqual(tNode.position[0], 11000.0);
    assert.strictEqual(entity.position[0], 11000.0);
    assert.strictEqual(sNode.aglM, 10.0);
    assert.strictEqual(tNode.aglM, 10.0);
    assert.strictEqual(entity.aglM, 10.0);
    assert.strictEqual(sNode.txPowerDbm, 42.0);
    assert.strictEqual(tNode.txPowerDbm, 42.0);
    assert.strictEqual(entity.txPowerDbm, 42.0);
    assert.strictEqual(entity.identity.callsign, 'UPDATED-CALLSIGN');

    console.log('  -> PASS: updateNode synchronizes spatial and property mutations across twin nodes and registry.');
  }

  // --------------------------------------------------------------------------
  // Test 6: Registration lifecycle event ordering
  // --------------------------------------------------------------------------
  console.log('\n[6/12] Verifying registration lifecycle event ordering...');
  {
    const registry = new NodeRegistry();
    const regLifecycle = new RegistrationLifecycle();

    NodeLifecycleManager.addNode({
      msg: { type: 'NODE_ADD', callsign: 'EVENT-TEST', request_id: 'ev-1' },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      terrainEngine,
      simTimeS: 5.25,
      spatialLocked: false,
    });

    const events = regLifecycle.events();
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].state, 'CREATED');
    assert.strictEqual(events[0].sim_time_s, 5.25);
    assert.strictEqual(events[1].state, 'REQUESTING');
    assert.strictEqual(events[1].sim_time_s, 5.25);
    assert.strictEqual(events[2].state, 'REGISTERED');
    assert.strictEqual(events[2].sim_time_s, 5.25);

    // Delete
    NodeLifecycleManager.deleteNode({
      msg: { type: 'NODE_DELETE', node_id: 16 },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      simTimeS: 8.5,
      spatialLocked: false,
    });

    const allEvents = regLifecycle.events();
    assert.strictEqual(allEvents.length, 4);
    assert.strictEqual(allEvents[3].state, 'REMOVED');
    assert.strictEqual(allEvents[3].sim_time_s, 8.5);

    console.log('  -> PASS: Registration lifecycle events strictly preserve CREATED -> REQUESTING -> REGISTERED -> REMOVED.');
  }

  // --------------------------------------------------------------------------
  // Test 7: Worker TransferManager registration and eviction coordination
  // --------------------------------------------------------------------------
  console.log('\n[7/12] Verifying worker TransferManager registration and eviction coordination...');
  {
    const worker = new SimulationWorkerManager(0);
    assert.strictEqual(worker.nodeRegistry.size, 16);

    // 1. Worker addNode -> registers transfer slot
    const addRes = worker.handleMessage({
      type: 'NODE_ADD',
      callsign: 'XFER-DYNAMIC',
      request_id: 'xfer-add',
    });
    assert.strictEqual(addRes.accepted, true);
    const addedId = addRes.node_id!;
    assert.strictEqual(worker.transferManager.states.has(addedId), true, 'Worker must register transfer slot for new node');

    // 2. Worker duplicateNode -> registers transfer slot
    const dupRes = worker.handleMessage({
      type: 'NODE_DUPLICATE',
      source_node_id: addedId,
      request_id: 'xfer-dup',
    });
    assert.strictEqual(dupRes.accepted, true);
    const dupId = dupRes.node_id!;
    assert.strictEqual(worker.transferManager.states.has(dupId), true, 'Worker must register transfer slot for duplicated node');

    // 3. Worker deleteNode -> evicts transfer slot
    const delRes = worker.handleMessage({
      type: 'NODE_DELETE',
      node_id: addedId,
      request_id: 'xfer-del',
    });
    assert.strictEqual(delRes.accepted, true);
    assert.strictEqual(worker.transferManager.states.has(addedId), false, 'Worker must evict transfer slot on delete');
    assert.strictEqual(worker.transferManager.states.has(dupId), true, 'Worker must preserve other active transfer slots');

    console.log('  -> PASS: Worker correctly synchronizes ActiveTransferManager slots during node lifecycle operations.');
  }

  // --------------------------------------------------------------------------
  // Test 8: Worker scheduler eviction coordination
  // --------------------------------------------------------------------------
  console.log('\n[8/12] Verifying worker scheduler eviction coordination...');
  {
    const worker = new SimulationWorkerManager(0);

    // Node 4 has active scheduler traffic
    const delRes = worker.handleMessage({
      type: 'NODE_DELETE',
      node_id: 4,
      request_id: 'sched-del',
    });
    assert.strictEqual(delRes.accepted, true);

    // Schedulers run without errors and do not include evicted node 4
    const reportStatic = worker.staticScheduler.scheduleFrame(
      worker.frameIndex,
      worker.simTimeS,
      worker.nodesStatic,
      worker.linkStatuses,
      worker.predStates
    );
    const reportTac = worker.tacScheduler.scheduleFrame(
      worker.frameIndex,
      worker.simTimeS,
      worker.nodesTac,
      worker.linkStatuses,
      worker.predStates
    );

    assert.ok(reportStatic);
    assert.ok(reportTac);
    assert.strictEqual(reportStatic.allocations.some(a => a.nodeId === 4), false, 'Static scheduler must not allocate for evicted node 4');
    assert.strictEqual(reportTac.allocations.some(a => a.nodeId === 4), false, 'Tac scheduler must not allocate for evicted node 4');

    console.log('  -> PASS: Worker correctly evicts node from both schedulers upon deletion.');
  }

  // --------------------------------------------------------------------------
  // Test 9: Worker selected-node fallback integration
  // --------------------------------------------------------------------------
  console.log('\n[9/12] Verifying worker selected-node fallback integration...');
  {
    // Start with ACN_ONLY (0 nodes)
    const worker = new SimulationWorkerManager(0, 'ACN_ONLY');
    assert.strictEqual(worker.selectedNodeId, -1);

    // 1. Add first node to empty simulation -> auto-select new node
    const add1 = worker.handleMessage({
      type: 'NODE_ADD',
      callsign: 'SOLO-16',
      request_id: 'sel-1',
    });
    assert.strictEqual(add1.accepted, true);
    assert.strictEqual(worker.selectedNodeId, 16, 'Worker auto-selects first added node from empty state');

    // 2. Add second node -> does NOT overwrite current selection
    const add2 = worker.handleMessage({
      type: 'NODE_ADD',
      callsign: 'SOLO-17',
      request_id: 'sel-2',
    });
    assert.strictEqual(add2.accepted, true);
    assert.strictEqual(worker.selectedNodeId, 16, 'Worker preserves selection when another node is added');

    // 3. Delete unselected node 17 -> selection unchanged
    worker.handleMessage({ type: 'NODE_DELETE', node_id: 17, request_id: 'sel-3' });
    assert.strictEqual(worker.selectedNodeId, 16, 'Selection remains 16 when node 17 is deleted');

    // 4. Delete selected node 16 -> falls back to -1 when no nodes remain
    worker.handleMessage({ type: 'NODE_DELETE', node_id: 16, request_id: 'sel-4' });
    assert.strictEqual(worker.selectedNodeId, -1, 'Worker selection falls back to -1 when all nodes are deleted');

    console.log('  -> PASS: Worker selection fallback behavior functions correctly across add, delete, and zero-node states.');
  }

  // --------------------------------------------------------------------------
  // Test 10: Terrain resampling and AGL preservation
  // --------------------------------------------------------------------------
  console.log('\n[10/12] Verifying terrain resampling and AGL preservation (resampleGroundNodeAltitudes)...');
  {
    const registry = createDefault16NodeRegistry(0);
    const { nodesStatic, nodesTac } = NodeLifecycleManager.initNodes(registry, terrainEngine);

    // Artificially alter node 0 position elevation
    nodesStatic[0].position = [nodesStatic[0].position[0], nodesStatic[0].position[1], 9999.0];
    nodesTac[0].position = [nodesTac[0].position[0], nodesTac[0].position[1], 9999.0];

    NodeLifecycleManager.resampleGroundNodeAltitudes(nodesStatic, nodesTac, registry, terrainEngine);

    const expectedZ = terrainEngine.getElevation(nodesStatic[0].position[0], nodesStatic[0].position[1]) + nodesStatic[0].aglM;
    assert.strictEqual(nodesStatic[0].position[2], expectedZ, 'Static node elevation must be re-derived from terrain');
    assert.strictEqual(nodesTac[0].position[2], expectedZ, 'Tac node elevation must be re-derived from terrain');
    assert.strictEqual(registry.getByNodeId(0)!.aglM, nodesStatic[0].aglM, 'Registry AGL must match node AGL');

    console.log('  -> PASS: resampleGroundNodeAltitudes correctly updates Z coordinates from terrain while preserving AGL.');
  }

  // --------------------------------------------------------------------------
  // Test 11: Deleted ID non-reuse
  // --------------------------------------------------------------------------
  console.log('\n[11/12] Verifying deleted ID non-reuse...');
  {
    const registry = new NodeRegistry();
    const regLifecycle = new RegistrationLifecycle();

    const add1 = NodeLifecycleManager.addNode({
      msg: { type: 'NODE_ADD', callsign: 'NODE-16' },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      terrainEngine,
      simTimeS: 1.0,
      spatialLocked: false,
    });
    assert.strictEqual(add1.entity!.identity.nodeId, 16);

    // Delete node 16
    NodeLifecycleManager.deleteNode({
      msg: { type: 'NODE_DELETE', node_id: 16 },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      simTimeS: 2.0,
      spatialLocked: false,
    });

    // Add next node -> must NOT reuse 16! Must be 17
    const add2 = NodeLifecycleManager.addNode({
      msg: { type: 'NODE_ADD', callsign: 'NODE-17' },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      terrainEngine,
      simTimeS: 3.0,
      spatialLocked: false,
    });
    assert.strictEqual(add2.entity!.identity.nodeId, 17, 'Deleted node ID 16 must not be reused');

    console.log('  -> PASS: Monotonic allocation strictly prevents reuse of deleted node IDs.');
  }

  // --------------------------------------------------------------------------
  // Test 12: Validation atomicity: rejected operations must not partially mutate state
  // --------------------------------------------------------------------------
  console.log('\n[12/12] Verifying validation atomicity: rejected operations do not partially mutate state...');
  {
    const registry = createDefault16NodeRegistry(0);
    const initialSize = registry.size;
    const regLifecycle = new RegistrationLifecycle();

    // 1. Spatial locked rejects add without mutating registry
    const lockedRes = NodeLifecycleManager.addNode({
      msg: { type: 'NODE_ADD', callsign: 'LOCKED-NODE' },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      terrainEngine,
      simTimeS: 1.0,
      spatialLocked: true,
    });
    assert.strictEqual(lockedRes.accepted, false);
    assert.strictEqual(registry.size, initialSize, 'Registry size must not change on rejected add');

    // 2. Out-of-bounds coordinates reject add
    const oobRes = NodeLifecycleManager.addNode({
      msg: { type: 'NODE_ADD', x_m: 99999999.0 },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      terrainEngine,
      simTimeS: 1.0,
      spatialLocked: false,
    });
    assert.strictEqual(oobRes.accepted, false);
    assert.strictEqual(registry.size, initialSize);

    // 3. Invalid AGL rejects add
    const aglRes = NodeLifecycleManager.addNode({
      msg: { type: 'NODE_ADD', agl_m: -5.0 },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      terrainEngine,
      simTimeS: 1.0,
      spatialLocked: false,
    });
    assert.strictEqual(aglRes.accepted, false);
    assert.strictEqual(registry.size, initialSize);

    // 4. Invalid delete on non-existent node
    const badDel = NodeLifecycleManager.deleteNode({
      msg: { type: 'NODE_DELETE', node_id: 9999 },
      nodeRegistry: registry,
      registrationLifecycle: regLifecycle,
      simTimeS: 1.0,
      spatialLocked: false,
    });
    assert.strictEqual(badDel.accepted, false);
    assert.strictEqual(registry.size, initialSize);

    console.log('  -> PASS: All validation rejections maintain pristine atomicity.');
  }

  console.log('================================================================================');
  console.log('  ALL 12 NODE LIFECYCLE MANAGER VERIFICATION TESTS PASSED CLEANLY!');
  console.log('================================================================================');
}

runAllVerifications().catch(err => {
  console.error('VERIFICATION SUITE FAILED:', err);
  process.exit(1);
});
