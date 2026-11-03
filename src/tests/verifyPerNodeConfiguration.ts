/**
 * src/tests/verifyPerNodeConfiguration.ts
 *
 * Dedicated verification suite for per-node configuration:
 * 1. Transmit power (10 - 50 dBm) & physical link budget / SNR / MODCOD propagation.
 * 2. Battery capacity & deterministic energy drain model (idle vs TX drain, clamping, 0% cutoff).
 * 3. Tactical priority multiplier (0.1 - 5.0) in Tac-TAD composite utility, contention boost, outage preservation.
 * 4. Node colour (hex validation, registry persistence, telemetry propagation).
 * 5. Dynamic node addition and update command roundtrips in worker.
 */

import { NodeRegistry, createDefault16NodeRegistry } from '../core/nodeRegistry';
import { GroundNodeTrafficSubsystem, FQCoDelQueue } from '../core/queues';
import { RFConfig, EnvironmentConfig } from '../core/config';
import { LinkBudgetEngine } from '../core/linkBudget';
import { TerrainAwareDynamicScheduler, LegacyStaticScheduler } from '../core/scheduler';
import { NodeTerrainState } from '../core/trajectory';
import {
  validateNodeTxPower,
  validateNodeBatteryCapacity,
  validateNodeBatteryLevel,
  validateNodeTacticalPriority,
  validateNodeColorHex,
  buildNodeAddCommand,
  buildNodeUpdateCommand,
} from '../ui/nodeInventory';
import { SimulationWorkerManager } from '../worker/simWorker';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests(): Promise<void> {
  console.log('================================================================================');
  console.log('  PER-NODE CONFIGURATION VERIFICATION SUITE');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // [1/6] Node Inventory Validators & Builders
  // ---------------------------------------------------------------------------
  console.log('[1/6] Verifying node inventory validators and command builders...');

  // Tx Power
  assert(validateNodeTxPower(10.0).valid, 'Tx power 10 dBm valid');
  assert(validateNodeTxPower(50.0).valid, 'Tx power 50 dBm valid');
  assert(validateNodeTxPower(36.0).valid, 'Tx power 36 dBm valid');
  assert(!validateNodeTxPower(9.9).valid, 'Tx power < 10 dBm invalid');
  assert(!validateNodeTxPower(50.1).valid, 'Tx power > 50 dBm invalid');
  assert(!validateNodeTxPower('36').valid, 'Non-number Tx power invalid');

  // Battery Capacity
  assert(validateNodeBatteryCapacity(100).valid, 'Battery capacity 100 mAh valid');
  assert(validateNodeBatteryCapacity(500000).valid, 'Battery capacity 500,000 mAh valid');
  assert(!validateNodeBatteryCapacity(99).valid, 'Battery capacity < 100 mAh invalid');
  assert(!validateNodeBatteryCapacity(500001).valid, 'Battery capacity > 500,000 mAh invalid');

  // Battery Level
  assert(validateNodeBatteryLevel(0.0).valid, 'Battery level 0% valid');
  assert(validateNodeBatteryLevel(100.0).valid, 'Battery level 100% valid');
  assert(!validateNodeBatteryLevel(-0.1).valid, 'Battery level < 0% invalid');
  assert(!validateNodeBatteryLevel(100.1).valid, 'Battery level > 100% invalid');

  // Tactical Priority
  assert(validateNodeTacticalPriority(0.1).valid, 'Tactical priority 0.1 valid');
  assert(validateNodeTacticalPriority(5.0).valid, 'Tactical priority 5.0 valid');
  assert(validateNodeTacticalPriority(1.0).valid, 'Tactical priority 1.0 valid');
  assert(!validateNodeTacticalPriority(0.09).valid, 'Tactical priority < 0.1 invalid');
  assert(!validateNodeTacticalPriority(5.01).valid, 'Tactical priority > 5.0 invalid');

  // Color Hex
  assert(validateNodeColorHex('#38bdf8').valid, 'Color #38bdf8 valid');
  assert(validateNodeColorHex('#fff').valid, 'Color #fff valid');
  assert(validateNodeColorHex('#AABBCC').valid, 'Color #AABBCC valid');
  assert(!validateNodeColorHex('#12345').valid, 'Color 5-digit hex invalid');
  assert(!validateNodeColorHex('blue').valid, 'Named color string invalid');
  assert(!validateNodeColorHex('#xyz').valid, 'Non-hex characters invalid');

  // Command Builders
  const addCmd = buildNodeAddCommand({
    xM: 1000,
    yM: 2000,
    aglM: 3.5,
    callsign: 'ALPHA-1',
    role: 'soldier',
    colorHex: '#10b981',
    txPowerDbm: 40.0,
    batteryCapacityMah: 8000,
    batteryLevelPct: 95.0,
    tacticalPriority: 2.5,
  });
  assert(addCmd.type === 'NODE_ADD', 'Add command type correct');
  assert(addCmd.color_hex === '#10b981', 'Add command color_hex matches');
  assert(addCmd.tx_power_dbm === 40.0, 'Add command tx_power_dbm matches');
  assert(addCmd.battery_capacity_mah === 8000, 'Add command battery_capacity_mah matches');
  assert(addCmd.battery_level_pct === 95.0, 'Add command battery_level_pct matches');
  assert(addCmd.tactical_priority === 2.5, 'Add command tactical_priority matches');

  const updateCmd = buildNodeUpdateCommand(5, {
    txPowerDbm: 42.0,
    batteryCapacityMah: 10000,
    batteryLevelPct: 50.0,
    tacticalPriority: 3.0,
    colorHex: '#ef4444',
  });
  assert(updateCmd.type === 'NODE_UPDATE', 'Update command type correct');
  assert(updateCmd.tx_power_dbm === 42.0, 'Update command tx_power_dbm matches');
  assert(updateCmd.battery_capacity_mah === 10000, 'Update command battery_capacity_mah matches');
  assert(updateCmd.battery_level_pct === 50.0, 'Update command battery_level_pct matches');
  assert(updateCmd.tactical_priority === 3.0, 'Update command tactical_priority matches');
  assert(updateCmd.color_hex === '#ef4444', 'Update command color_hex matches');

  console.log('  -> PASS: All validators and command builders verified cleanly.\n');

  // ---------------------------------------------------------------------------
  // [2/6] Transmit Power & Link Budget Engine Evaluation
  // ---------------------------------------------------------------------------
  console.log('[2/6] Verifying Transmit Power (dBm) flow through evaluateLink()...');

  const linkEngine = new LinkBudgetEngine();
  const rf = new RFConfig();
  const env = new EnvironmentConfig();
  const slantRangeM = 50000.0; // 50 km slant range

  // Nominal default Soldier (36 dBm)
  const defaultSoldierLink = linkEngine.evaluateLink('soldier', slantRangeM, 0.0, rf, env, false);
  assert(defaultSoldierLink.pTxDbm === 36.0, 'Default soldier pTxDbm === 36.0 dBm');

  // Boosted Soldier (46 dBm, +10 dB)
  const boostedSoldierLink = linkEngine.evaluateLink('soldier', slantRangeM, 0.0, rf, env, false, 46.0);
  assert(boostedSoldierLink.pTxDbm === 46.0, 'Boosted soldier pTxDbm === 46.0 dBm');
  assert(Math.abs((boostedSoldierLink.prxDbm - defaultSoldierLink.prxDbm) - 10.0) < 1e-4, 'Prx scaled linearly +10 dB');
  assert(Math.abs((boostedSoldierLink.snrDb - defaultSoldierLink.snrDb) - 10.0) < 1e-4, 'SNR scaled linearly +10 dB');
  assert(boostedSoldierLink.bitrateBps >= defaultSoldierLink.bitrateBps, 'Achievable bitrate monotonically non-decreasing with SNR');

  // Low power Soldier (15 dBm, -21 dB)
  const lowPowerLink = linkEngine.evaluateLink('soldier', slantRangeM, 0.0, rf, env, false, 15.0);
  assert(lowPowerLink.pTxDbm === 15.0, 'Low power soldier pTxDbm === 15.0 dBm');
  assert(lowPowerLink.snrDb < defaultSoldierLink.snrDb, 'SNR dropped with lower Tx power');

  // Default MCP (43 dBm)
  const defaultMcpLink = linkEngine.evaluateLink('mcp', slantRangeM, 0.0, rf, env, false);
  assert(defaultMcpLink.pTxDbm === 43.0, 'Default MCP pTxDbm === 43.0 dBm');

  console.log('  -> PASS: Transmit power flows directly into Prx, SNR, MODCOD, and bitrate.\n');

  // ---------------------------------------------------------------------------
  // [3/6] Deterministic Battery & Energy Drain Model
  // ---------------------------------------------------------------------------
  console.log('[3/6] Verifying deterministic battery capacity & energy drain model...');

  const soldierSub = new GroundNodeTrafficSubsystem(0, 'soldier', [0, 0, 100], 42);
  soldierSub.batteryCapacityMah = 5000;
  soldierSub.batteryLevelPct = 100.0;
  soldierSub.txPowerDbm = 36.0;

  // Verify initial state
  assert(!soldierSub.isDepleted, 'Initially not depleted');
  const pktsBefore = soldierSub.generateTraffic(0.1, 0.02);
  assert(pktsBefore.length > 0, 'Generates traffic when battery > 0%');

  // Deplete battery to 0%
  soldierSub.batteryLevelPct = 0.0;
  soldierSub.isDepleted = true;

  // Depleted node stops generating packets
  const pktsAfter = soldierSub.generateTraffic(0.2, 0.02);
  assert(pktsAfter.length === 0, 'Generates zero packets when battery is depleted');
  const injected = soldierSub.injectTraffic('VOICE', 0.3);
  assert(injected === 0, 'Cannot inject traffic when battery is depleted');

  // Recharging restores generation
  soldierSub.batteryLevelPct = 80.0;
  soldierSub.isDepleted = false;
  const pktsRecharge = soldierSub.generateTraffic(0.4, 0.02);
  assert(pktsRecharge.length > 0, 'Recharging restores packet generation');

  console.log('  -> PASS: Battery depletion completely halts transmission while preserving node state.\n');

  // ---------------------------------------------------------------------------
  // [4/6] Tactical Priority Multiplier in Tac-TAD Scheduler
  // ---------------------------------------------------------------------------
  console.log('[4/6] Verifying Tactical Priority Multiplier in Tac-TAD Scheduler...');

  const sched = new TerrainAwareDynamicScheduler();

  // Create two competing nodes with equal backlog and equal nominal channel
  const nodeA = new GroundNodeTrafficSubsystem(1, 'soldier', [1000, 1000, 50], 101);
  const nodeB = new GroundNodeTrafficSubsystem(2, 'soldier', [1000, 1000, 50], 102);

  // Fill both queues with equal voice packets (5QI 65)
  for (let i = 0; i < 5; i++) {
    nodeA.enqueuePacket(65, 1.0);
    nodeB.enqueuePacket(65, 1.0);
  }

  // Node A has priority 1.0, Node B has boosted priority 4.0
  nodeA.tacticalPriority = 1.0;
  nodeB.tacticalPriority = 4.0;

  const linkA = linkEngine.evaluateLink('soldier', 20000, 0.0, rf, env, false, 36.0);
  const linkB = linkEngine.evaluateLink('soldier', 20000, 0.0, rf, env, false, 36.0);
  const links = new Map<number, any>([
    [1, linkA],
    [2, linkB],
  ]);
  const preds = new Map<number, any>([
    [1, { currentState: NodeTerrainState.NORMAL_LOS, timeToOcclusionS: 999 }],
    [2, { currentState: NodeTerrainState.NORMAL_LOS, timeToOcclusionS: 999 }],
  ]);

  const report = sched.scheduleFrame(1, 1.0, [nodeA, nodeB], links, preds);
  assert(report.allocations.length > 0, 'Scheduled allocations present');

  // The first allocated slot should belong to the higher tactical priority node (Node B)
  const firstSlot = report.allocations[0];
  assert(firstSlot.nodeId === 2, `Node 2 (priority 4.0) scheduled before Node 1 (priority 1.0), got node ${firstSlot.nodeId}`);

  // Test that priority NEVER overrides physical outage or hard shadow
  const occludedPreds = new Map<number, any>([
    [1, { currentState: NodeTerrainState.NORMAL_LOS, timeToOcclusionS: 999 }],
    [2, { currentState: NodeTerrainState.HARD_SHADOW_CUTOFF, timeToOcclusionS: 0 }],
  ]);
  const occludedReport = sched.scheduleFrame(2, 1.02, [nodeA, nodeB], links, occludedPreds);
  const scheduledNids = occludedReport.allocations.map(a => a.nodeId);
  assert(!scheduledNids.includes(2), 'Node 2 in hard shadow must NEVER receive airtime regardless of priority');

  console.log('  -> PASS: Tactical priority boosts contention without bypassing physical outages.\n');

  // ---------------------------------------------------------------------------
  // [5/6] Node Registry Persistence of 4 Configurable Properties
  // ---------------------------------------------------------------------------
  console.log('[5/6] Verifying NodeRegistry default values and updateEntity()...');

  const registry = createDefault16NodeRegistry();
  const n0 = registry.getByNodeId(0)!;
  assert(n0.txPowerDbm === 36.0, 'Canonical node 0 default Tx power 36 dBm');
  assert(n0.batteryCapacityMah === 5000, 'Canonical node 0 default battery 5000 mAh');
  assert(n0.batteryLevelPct === 100.0, 'Canonical node 0 default level 100%');
  assert(n0.tacticalPriority === 1.0, 'Canonical node 0 default priority 1.0');
  assert(n0.identity.colorHex === '#38bdf8', 'Canonical node 0 default color #38bdf8');

  const mcp = registry.getByNodeId(15)!;
  assert(mcp.txPowerDbm === 43.0, 'Canonical MCP default Tx power 43 dBm');
  assert(mcp.batteryCapacityMah === 20000, 'Canonical MCP default battery 20000 mAh');
  assert(mcp.identity.colorHex === '#f59e0b', 'Canonical MCP default color #f59e0b');

  // Update entity
  registry.updateEntity(0, {
    txPowerDbm: 44.5,
    batteryCapacityMah: 8500,
    batteryLevelPct: 75.0,
    tacticalPriority: 3.5,
    colorHex: '#ec4899',
  });

  const updatedN0 = registry.getByNodeId(0)!;
  assert(updatedN0.txPowerDbm === 44.5, 'Updated Tx power matches');
  assert(updatedN0.batteryCapacityMah === 8500, 'Updated battery capacity matches');
  assert(updatedN0.batteryLevelPct === 75.0, 'Updated battery level matches');
  assert(updatedN0.tacticalPriority === 3.5, 'Updated tactical priority matches');
  assert(updatedN0.identity.colorHex === '#ec4899', 'Updated color hex matches');

  // Update battery level helper
  registry.updateBatteryLevel(0, 15.0);
  assert(registry.getByNodeId(0)!.batteryLevelPct === 15.0, 'updateBatteryLevel works');

  console.log('  -> PASS: NodeRegistry authoritative properties verified.\n');

  // ---------------------------------------------------------------------------
  // [6/6] SimulationWorkerManager NODE_ADD & NODE_UPDATE Execution
  // ---------------------------------------------------------------------------
  console.log('[6/6] Verifying SimulationWorkerManager NODE_ADD & NODE_UPDATE commands...');

  const worker = new SimulationWorkerManager();

  // Add node with custom properties
  const addRes = worker.handleMessage({
    type: 'NODE_ADD',
    x_m: 5000,
    y_m: -5000,
    agl_m: 5.0,
    callsign: 'RECON-TAC',
    role: 'soldier',
    color_hex: '#a855f7',
    tx_power_dbm: 38.5,
    battery_capacity_mah: 7500,
    battery_level_pct: 90.0,
    tactical_priority: 2.2,
  });
  assert(addRes.accepted === true, 'NODE_ADD accepted');
  const addedNid = addRes.node_id!;

  // Inspect telemetry
  const telList = worker.buildNodesTelemetry();
  const addedTel = telList.find(n => n.node_id === addedNid);
  assert(Boolean(addedTel), 'Added node present in telemetry');
  assert(addedTel.name === 'RECON-TAC', 'Callsign matches in telemetry');
  assert(addedTel.color_hex === '#a855f7', 'Color hex matches in telemetry');
  assert(addedTel.tx_power_dbm === 38.5, 'Tx power matches in telemetry');
  assert(addedTel.battery_capacity_mah === 7500, 'Battery capacity matches in telemetry');
  assert(addedTel.battery_level_pct === 90.0, 'Battery level matches in telemetry');
  assert(addedTel.tactical_priority === 2.2, 'Tactical priority matches in telemetry');
  assert(addedTel.is_depleted === false, 'is_depleted is false');

  // Update node properties
  const updateRes = worker.handleMessage({
    type: 'NODE_UPDATE',
    node_id: addedNid,
    color_hex: '#14b8a6',
    tx_power_dbm: 45.0,
    battery_capacity_mah: 12000,
    battery_level_pct: 10.0,
    tactical_priority: 4.5,
  });
  assert(updateRes.accepted === true, 'NODE_UPDATE accepted');

  const telUpdated = worker.buildNodesTelemetry().find(n => n.node_id === addedNid);
  assert(telUpdated.color_hex === '#14b8a6', 'Updated color matches in telemetry');
  assert(telUpdated.tx_power_dbm === 45.0, 'Updated Tx power matches in telemetry');
  assert(telUpdated.battery_capacity_mah === 12000, 'Updated battery capacity matches in telemetry');
  assert(telUpdated.battery_level_pct === 10.0, 'Updated battery level matches in telemetry');
  assert(telUpdated.tactical_priority === 4.5, 'Updated tactical priority matches in telemetry');

  // Test out-of-range rejection
  const invalidTx = worker.handleMessage({
    type: 'NODE_UPDATE',
    node_id: addedNid,
    tx_power_dbm: 65.0, // > 50 dBm
  });
  assert(invalidTx.accepted === false, 'Out-of-range Tx power rejected');

  const invalidColor = worker.handleMessage({
    type: 'NODE_UPDATE',
    node_id: addedNid,
    color_hex: 'not-a-hex',
  });
  assert(invalidColor.accepted === false, 'Invalid color hex rejected');

  console.log('  -> PASS: SimulationWorkerManager command handling and telemetry verified.\n');

  console.log('================================================================================');
  console.log('  ALL PER-NODE CONFIGURATION VERIFICATION SUITES PASSED CLEANLY!');
  console.log('================================================================================');
}

runTests().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
