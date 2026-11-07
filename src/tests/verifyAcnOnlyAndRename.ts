/**
 * src/tests/verifyAcnOnlyAndRename.ts
 *
 * Verification suite for:
 * 1. Node renaming propagation (Task 1): Authoritative propagation from NodeRegistry to
 *    telemetry, visual profiles, and traffic subsystems while preserving UUID and numeric IDs.
 * 2. ACN-only startup and dynamic management (Task 2): Starting with 0 ground nodes,
 *    unimpaired ACN flight operations, defensive zero-node telemetry and scheduler reports,
 *    dynamic node addition, preset switching, and reset scenario mode retention.
 */

import { strict as assert } from 'node:assert';
import { SimulationWorkerManager } from '../worker/simWorker';
import { NodeRegistry } from '../core/nodeRegistry';

console.log('================================================================================');
console.log('  ACN-ONLY STARTUP & NODE RENAMING PROPAGATION VERIFICATION SUITE');
console.log('================================================================================\n');

async function runTests(): Promise<void> {
  // ---------------------------------------------------------------------------
  // TEST 1: ACN-Only Startup State
  // ---------------------------------------------------------------------------
  console.log('[1/7] Verifying ACN-only worker startup...');
  const acnWorker = new SimulationWorkerManager(0, 'ACN_ONLY');

  assert.strictEqual(acnWorker.nodeRegistry.size, 0, 'Registry must start with 0 nodes');
  assert.strictEqual(acnWorker.nodesStatic.length, 0, 'nodesStatic must be empty');
  assert.strictEqual(acnWorker.nodesTac.length, 0, 'nodesTac must be empty');
  assert.strictEqual(acnWorker.selectedNodeId, -1, 'selectedNodeId must be -1');
  assert.strictEqual(acnWorker.currentScenarioPreset, 'ACN_ONLY', 'currentScenarioPreset must be ACN_ONLY');

  // Verify ACN is operational and flying
  const acnPos = acnWorker.trajectoryEngine.getAcnPosition(acnWorker.simTimeS);
  assert.ok(Array.isArray(acnPos) && acnPos.length === 3, 'ACN position must be a valid 3D vector');
  assert.ok(acnPos[2] > 0, 'ACN altitude must be above ground');

  console.log('  -> PASS: Worker initialized in ACN-only standby with zero ground nodes.\n');

  // ---------------------------------------------------------------------------
  // TEST 2: Zero-Node Telemetry Frame and Schedulers
  // ---------------------------------------------------------------------------
  console.log('[2/7] Verifying zero-node telemetry generation and simulation tick...');
  // Capture emitted host messages
  const emitted: any[] = [];
  (acnWorker as any).emitHostMessage = (msg: any) => emitted.push(msg);

  // Advance simulation by 5 frames (100 ms)
  for (let f = 0; f < 5; f++) {
    acnWorker.tickSimulation();
  }

  assert.ok(emitted.length >= 5, 'Must emit telemetry frames on each tick');
  const latestFrameMsg = emitted.filter(m => m.type === 'TELEMETRY_FRAME').at(-1);
  assert.ok(latestFrameMsg && latestFrameMsg.frame, 'Must emit valid TELEMETRY_FRAME');
  const frame = latestFrameMsg.frame;

  assert.strictEqual(frame.selected_node_id, -1, 'Selected node ID must be -1');
  assert.deepStrictEqual(frame.nodes_telemetry, [], 'nodes_telemetry must be empty array');
  assert.ok(frame.acn_telemetry, 'acn_telemetry must be present and valid');
  assert.ok(frame.acn_telemetry.pos_z > 0, 'ACN flight altitude must be valid');
  assert.strictEqual(frame.comparative_kpi_dashboard.ul_utilization_pct, 0, 'UL utilization must be 0%');
  assert.strictEqual(frame.active_gantt_allocations.length, 0, 'Allocations must be empty');
  assert.ok(frame.plain_english_narrative.includes('ACN RELAY STANDBY'), 'Narrative must indicate ACN standby mode');

  // Check profile frame
  acnWorker.emitProfileFrame();
  const profileMsg = emitted.filter(m => m.type === 'PROFILE_FRAME').at(-1);
  assert.ok(profileMsg, 'Must emit PROFILE_FRAME');
  assert.strictEqual(profileMsg.selectedNodeId, -1);
  assert.strictEqual(profileMsg.fresnel.status, 'NO_NODES_REGISTERED');
  assert.strictEqual(profileMsg.fresnel.profile.valid, false);

  console.log('  -> PASS: Zero-node telemetry and scheduler ticks execute cleanly without errors.\n');

  // ---------------------------------------------------------------------------
  // TEST 3: Dynamic Node Addition from ACN-Only State
  // ---------------------------------------------------------------------------
  console.log('[3/7] Verifying dynamic ground-node addition from ACN-only standby...');
  const addRes = acnWorker.handleMessage({
    type: 'NODE_ADD',
    x_m: 5000.0,
    y_m: 3000.0,
    agl_m: 4.5,
    role: 'soldier',
    callsign: 'OUTPOST-1',
  });

  assert.strictEqual(addRes.accepted, true, 'NODE_ADD must be accepted');
  assert.strictEqual(typeof addRes.node_id, 'number', 'node_id must be assigned');
  const newNid = addRes.node_id!;
  assert.strictEqual(acnWorker.nodeRegistry.size, 1, 'Registry size must now be 1');
  assert.strictEqual(acnWorker.nodesTac.length, 1, 'nodesTac length must be 1');
  assert.strictEqual(acnWorker.selectedNodeId, newNid, 'selectedNodeId must automatically update to new node');

  // Verify node telemetry contains the newly added terminal
  const nodesTel = acnWorker.buildNodesTelemetry();
  assert.strictEqual(nodesTel.length, 1, 'Telemetry must contain 1 node');
  assert.strictEqual(nodesTel[0].node_id, newNid);
  assert.strictEqual(nodesTel[0].name, 'OUTPOST-1');
  assert.strictEqual(nodesTel[0].agl_m, 4.5);

  console.log('  -> PASS: Dynamic ground node addition seamlessly activates from ACN-only standby.\n');

  // ---------------------------------------------------------------------------
  // TEST 4: Node Renaming Propagation (Task 1 Bugfix)
  // ---------------------------------------------------------------------------
  console.log('[4/7] Verifying node renaming propagation...');
  const initialEntity = acnWorker.nodeRegistry.getByNodeId(newNid)!;
  const initialEntityId = initialEntity.identity.entityId;

  // Rename node via NODE_UPDATE
  const updateRes = acnWorker.handleMessage({
    type: 'NODE_UPDATE',
    node_id: newNid,
    callsign: 'COMMAND-HQ',
  });

  assert.strictEqual(updateRes.accepted, true, 'NODE_UPDATE must be accepted');

  // 1. Authoritative check in NodeRegistry
  const updatedEntity = acnWorker.nodeRegistry.getByNodeId(newNid)!;
  assert.strictEqual(updatedEntity.identity.callsign, 'COMMAND-HQ', 'Registry callsign must be COMMAND-HQ');
  assert.strictEqual(updatedEntity.identity.entityId, initialEntityId, 'UUID must remain stable');
  assert.strictEqual(updatedEntity.identity.nodeId, newNid, 'Numeric nodeId must remain stable');

  // 2. Traffic subsystem identity check
  assert.strictEqual(acnWorker.nodesTac[0].identity.callsign, 'COMMAND-HQ', 'Tac traffic subsystem must reflect updated callsign');
  assert.strictEqual(acnWorker.nodesStatic[0].identity.callsign, 'COMMAND-HQ', 'Static traffic subsystem must reflect updated callsign');

  // 3. Telemetry generation check
  const refreshedNodesTel = acnWorker.buildNodesTelemetry();
  assert.strictEqual(refreshedNodesTel[0].name, 'COMMAND-HQ', 'buildNodesTelemetry() name must be COMMAND-HQ');

  // 4. Emitted profile check
  emitted.length = 0;
  acnWorker.emitProfileFrame();
  const latestProfile = emitted.find(m => m.type === 'PROFILE_FRAME');
  assert.ok(latestProfile, 'Must emit PROFILE_FRAME on request');
  assert.strictEqual(latestProfile.fresnel.node_name, 'COMMAND-HQ', 'Fresnel slice must carry updated node_name');
  assert.strictEqual(latestProfile.fresnel.profile.nodeName, 'COMMAND-HQ', 'LinkProfile must carry updated nodeName');

  // 5. Verify empty or whitespace-only callsigns are rejected
  const emptyRes = acnWorker.handleMessage({
    type: 'NODE_UPDATE',
    node_id: newNid,
    callsign: '   ',
  });
  assert.strictEqual(emptyRes.accepted, false, 'Whitespace-only callsign must be rejected');

  console.log('  -> PASS: Node rename propagates immediately to registry, telemetry, and profiles while preserving UUID.\n');

  // ---------------------------------------------------------------------------
  // TEST 5: Reset Scenario Retention
  // ---------------------------------------------------------------------------
  console.log('[5/7] Verifying simulation reset preserves scenario preset...');
  // Delete the node so we are back to 0 nodes in ACN_ONLY preset
  acnWorker.handleMessage({ type: 'NODE_DELETE', node_id: newNid });
  assert.strictEqual(acnWorker.nodeRegistry.size, 0);

  // Trigger reset
  acnWorker.resetSimulationState();
  assert.strictEqual(acnWorker.nodeRegistry.size, 0, 'Reset in ACN_ONLY mode must keep 0 nodes (not recreate 16)');
  assert.strictEqual(acnWorker.selectedNodeId, -1, 'Selected node ID must remain -1');
  assert.strictEqual(acnWorker.nodesTac.length, 0, 'nodesTac must remain empty');

  console.log('  -> PASS: Reset preserves ACN-only standby without recreating ground nodes.\n');

  // ---------------------------------------------------------------------------
  // TEST 6: Preset Switching (ACN_ONLY <-> 16_NODES)
  // ---------------------------------------------------------------------------
  console.log('[6/7] Verifying preset switching between ACN_ONLY and 16_NODES...');
  // Load 16_NODES preset
  const p16Res = acnWorker.handleMessage({ type: 'LOAD_PRESET', preset_id: 'PRESET_16_NODES' });
  assert.strictEqual(p16Res.accepted, true, 'PRESET_16_NODES must be accepted');
  assert.strictEqual(acnWorker.nodeRegistry.size, 16, 'Registry must have 16 nodes');
  assert.strictEqual(acnWorker.nodesTac.length, 16, 'nodesTac must have 16 nodes');
  assert.strictEqual(acnWorker.selectedNodeId, 4, 'selectedNodeId must default to 4');
  assert.strictEqual(acnWorker.currentScenarioPreset, '16_NODES');

  // Reset in 16_NODES mode must preserve 16 nodes
  acnWorker.resetSimulationState();
  assert.strictEqual(acnWorker.nodeRegistry.size, 16, 'Reset in 16_NODES mode must preserve 16 nodes');
  assert.strictEqual(acnWorker.selectedNodeId, 4);

  // Switch back to ACN_ONLY
  const pAcnRes = acnWorker.handleMessage({ type: 'LOAD_PRESET', preset_id: 'PRESET_ACN_ONLY' });
  assert.strictEqual(pAcnRes.accepted, true, 'PRESET_ACN_ONLY must be accepted');
  assert.strictEqual(acnWorker.nodeRegistry.size, 0, 'Registry must have 0 nodes');
  assert.strictEqual(acnWorker.nodesTac.length, 0, 'nodesTac must be empty');
  assert.strictEqual(acnWorker.selectedNodeId, -1);
  assert.strictEqual(acnWorker.currentScenarioPreset, 'ACN_ONLY');

  console.log('  -> PASS: Preset switching dynamically transitions between ACN-only and 16-node layouts.\n');

  // ---------------------------------------------------------------------------
  // TEST 7: Kargil Occlusion Preset from ACN-Only State
  // ---------------------------------------------------------------------------
  console.log('[7/7] Verifying scenario presets safely restore terminals if triggered from ACN-only state...');
  assert.strictEqual(acnWorker.nodeRegistry.size, 0, 'Worker is currently in ACN-only');

  const occRes = acnWorker.handleMessage({ type: 'LOAD_PRESET', preset_id: 'PRESET_OCCLUSION' });
  assert.strictEqual(occRes.accepted, true, 'PRESET_OCCLUSION must succeed even from 0 nodes');
  assert.strictEqual(acnWorker.nodeRegistry.size, 16, 'Registry must populate 16 nodes for Kargil scenario');
  assert.strictEqual(acnWorker.selectedNodeId, 4, 'Target node 4 must be selected');
  assert.ok(acnWorker.nodeTransfers.get(4)?.activeType === 'PHOTO', 'Node 4 must have photo transfer queued');

  console.log('  -> PASS: Kargil occlusion preset seamlessly initializes scenario terminals from ACN-only state.\n');

  console.log('================================================================================');
  console.log('  ALL ACN-ONLY & NODE RENAMING PROPAGATION TESTS PASSED CLEANLY!');
  console.log('================================================================================');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});

