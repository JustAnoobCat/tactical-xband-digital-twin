/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Network Traffic Inventory & Communication Flow Verification Suite
 */

import assert from 'node:assert/strict';
import {
  NetworkTrafficTracker,
  NetworkTrafficFrame,
  TrafficNodeTelemetry,
  formatTrafficBytes,
  formatTrafficRate,
  formatTrafficSimTime,
  formatTrafficSnr,
  getTrafficStatusBadge,
} from '../ui/networkTrafficInventory';

function runNetworkTrafficInventoryVerification(): void {
  console.log('================================================================================');
  console.log('  NETWORK TRAFFIC INVENTORY & COMMUNICATION FLOW VERIFICATION SUITE');
  console.log('================================================================================\n');

  const tracker = new NetworkTrafficTracker();

  // [1/8] Verifying zero-node state (ACN-Only standby)
  console.log('[1/8] Verifying zero-node state (ACN-Only standby)...');
  {
    const acnOnlyFrame: NetworkTrafficFrame = {
      frameIndex: 0,
      simulationTimeS: 0.0,
      nodes: [],
      downlinkTelemetry: { broadcast_active: true, dl_duration_ms: 3.0 },
      schedulerMode: 'tac_tad',
    };

    tracker.ingest(acnOnlyFrame);
    const flows = tracker.getFlowRecords(acnOnlyFrame);
    assert.equal(flows.length, 0, 'Zero ground nodes must produce zero flow records');

    const summary = tracker.getCombinedNetworkSummary(flows);
    assert.equal(summary.totalPayloadTransmittedBytes, 0);
    assert.equal(summary.totalPayloadReceivedBytes, 0);
    assert.equal(summary.totalUplinkThroughputMbps, 0);
    assert.equal(summary.activeCommunicationLinksCount, 0);
    assert.equal(summary.averageSnrDb, null);

    const nodeSum = tracker.getPerNodeSummary(4, acnOnlyFrame);
    assert.equal(nodeSum, null, 'Querying non-existent node in ACN-only state must return null');
    console.log('  -> PASS: Zero-node ACN-only state cleanly handled with zero phantom records.');
  }

  // [2/8] Verifying Uplink traffic flow attribution (Terminal -> ACN)
  console.log('\n[2/8] Verifying Uplink traffic flow attribution (Terminal -> ACN)...');
  {
    const frame1: NetworkTrafficFrame = {
      frameIndex: 10,
      simulationTimeS: 0.20,
      nodes: [
        {
          node_id: 4,
          name: 'S4',
          node_type: 'soldier',
          snr_db: 18.5,
          bitrate_mbps: 12.0,
          link_outage: false,
          terrain_is_los: true,
          obstacle_blocked: false,
          is_transmitting: true,
          transfer_state: {
            status: 'TRANSMITTING',
            active_type: 'PHOTO',
            total_bytes: 2000000,
            delivered_bytes: 500000,
            dropped_bytes: 0,
            dropped_packets: 0,
            current_rate_bps: 5000000,
            current_rate_mbps: 5.0,
            start_time_s: 0.10,
          },
        },
        {
          node_id: 15,
          name: 'MCP',
          node_type: 'mcp',
          snr_db: 24.2,
          bitrate_mbps: 20.0,
          link_outage: false,
          terrain_is_los: true,
          obstacle_blocked: false,
          is_transmitting: false,
          transfer_state: null,
        },
      ],
      downlinkTelemetry: { broadcast_active: true, dl_duration_ms: 3.0 },
      schedulerMode: 'tac_tad',
    };

    tracker.ingest(frame1);
    const flows = tracker.getFlowRecords(frame1);

    // Should have 2 uplink flows + 1 downlink broadcast flow
    assert.equal(flows.length, 3, '2 ground nodes must yield 2 uplink records + 1 downlink broadcast');

    const ulNode4 = flows.find(f => f.fromId === 4);
    assert.ok(ulNode4 !== undefined, 'Node 4 uplink flow must exist');
    assert.equal(ulNode4?.fromName, 'Node 4 (S4)');
    assert.equal(ulNode4?.toId, 'ACN');
    assert.equal(ulNode4?.toName, 'ACN Relay (FL500)');
    assert.equal(ulNode4?.direction, 'Uplink');
    assert.equal(ulNode4?.dataSentBytes, 500000);
    assert.equal(ulNode4?.dataReceivedBytes, 500000);
    assert.equal(ulNode4?.dataRateMbps, 5.0);
    assert.equal(ulNode4?.snrDb, 18.5);
    assert.equal(ulNode4?.linkStatus, 'CONNECTED');
    assert.equal(ulNode4?.isTransmitting, true);

    const ulMcp = flows.find(f => f.fromId === 15);
    assert.ok(ulMcp !== undefined, 'Node 15 (MCP) uplink flow must exist');
    assert.equal(ulMcp?.fromName, 'Node 15 (MCP)');
    assert.equal(ulMcp?.dataRateMbps, 0);
    assert.equal(ulMcp?.snrDb, 24.2);
    assert.equal(ulMcp?.isTransmitting, false);
    console.log('  -> PASS: Uplink flow strictly designated Ground Terminal -> ACN Relay.');
  }

  // [3/8] Verifying Downlink broadcast attribution (ACN -> Terminals)
  console.log('\n[3/8] Verifying Downlink broadcast attribution (ACN -> Terminals)...');
  {
    const frame = {
      frameIndex: 10,
      simulationTimeS: 0.20,
      nodes: [
        { node_id: 4, snr_db: 18.5, link_outage: false, terrain_is_los: true, obstacle_blocked: false },
        { node_id: 15, snr_db: 24.2, link_outage: false, terrain_is_los: true, obstacle_blocked: false },
      ],
      downlinkTelemetry: { broadcast_active: true, dl_duration_ms: 3.0 },
    };

    const flows = tracker.getFlowRecords(frame as any);
    const dlFlow = flows.find(f => f.direction === 'Downlink');
    assert.ok(dlFlow !== undefined, 'Downlink broadcast flow must exist');
    assert.equal(dlFlow?.fromId, 'ACN');
    assert.equal(dlFlow?.fromName, 'ACN Relay (FL500)');
    assert.equal(dlFlow?.toId, 'BROADCAST');
    assert.ok(dlFlow?.toName.includes('Ground Terminals'));
    assert.equal(dlFlow?.linkStatus, 'CONNECTED');
    console.log('  -> PASS: Downlink flow strictly designated ACN Relay -> Ground Terminals broadcast.');
  }

  // [4/8] Verifying non-double-counting and cumulative positive deltas
  console.log('\n[4/8] Verifying non-double-counting and cumulative positive deltas...');
  {
    // Progress node 4 transfer from 500,000 bytes to 1,200,000 bytes
    const frame2: NetworkTrafficFrame = {
      frameIndex: 20,
      simulationTimeS: 0.40,
      nodes: [
        {
          node_id: 4,
          name: 'S4',
          snr_db: 18.0,
          link_outage: false,
          terrain_is_los: true,
          obstacle_blocked: false,
          transfer_state: {
            status: 'TRANSMITTING',
            total_bytes: 2000000,
            delivered_bytes: 1200000,
            dropped_bytes: 0,
            dropped_packets: 0,
            current_rate_mbps: 4.5,
          },
        },
      ],
      downlinkTelemetry: { broadcast_active: true, dl_duration_ms: 3.0 },
    };

    tracker.ingest(frame2);
    const flows2 = tracker.getFlowRecords(frame2);
    const ulNode4 = flows2.find(f => f.fromId === 4);
    assert.equal(ulNode4?.dataReceivedBytes, 1200000, 'Cumulative delivered bytes must be 1,200,000 without double counting');

    // Simulate transfer completion to 2,000,000 bytes and ACK
    const frame3: NetworkTrafficFrame = {
      frameIndex: 30,
      simulationTimeS: 0.60,
      nodes: [
        {
          node_id: 4,
          name: 'S4',
          snr_db: 18.0,
          link_outage: false,
          terrain_is_los: true,
          obstacle_blocked: false,
          transfer_state: {
            status: 'ACKNOWLEDGED',
            total_bytes: 2000000,
            delivered_bytes: 2000000,
            dropped_bytes: 0,
            dropped_packets: 0,
            current_rate_mbps: 0,
            ack_time_s: 0.58,
          },
        },
      ],
      downlinkTelemetry: { broadcast_active: true, dl_duration_ms: 3.0 },
    };

    tracker.ingest(frame3);
    const perNode4 = tracker.getPerNodeSummary(4, frame3);
    assert.equal(perNode4?.totalDataTransmittedBytes, 2000000);
    assert.equal(perNode4?.totalSuccessfulTransfers, 1, 'Completed transfer must increment successful transfers count');
    console.log('  -> PASS: Payload delivery correctly accumulated without double counting.');
  }

  // [5/8] Verifying packet loss and mountain shadow occlusion handling
  console.log('\n[5/8] Verifying packet loss and mountain shadow occlusion handling...');
  {
    // Start second transfer on Node 4, which experiences occlusion drops
    const frameOccluded: NetworkTrafficFrame = {
      frameIndex: 40,
      simulationTimeS: 0.80,
      nodes: [
        {
          node_id: 4,
          name: 'S4',
          snr_db: -99.0,
          link_outage: true,
          terrain_is_los: false,
          obstacle_blocked: false,
          transfer_state: {
            status: 'BLOCKED_NLOS',
            total_bytes: 500000,
            delivered_bytes: 100000,
            dropped_bytes: 2400,
            dropped_packets: 2,
            current_rate_mbps: 0,
          },
        },
      ],
      downlinkTelemetry: { broadcast_active: true, dl_duration_ms: 3.0 },
    };

    tracker.ingest(frameOccluded);
    const flows = tracker.getFlowRecords(frameOccluded);
    const ulNode4 = flows.find(f => f.fromId === 4);

    assert.equal(ulNode4?.linkStatus, 'BLOCKED_TERRAIN', 'Severed optical LOS must resolve to BLOCKED_TERRAIN');
    assert.equal(ulNode4?.packetsLost, 2, 'Dropped packets must be captured in packet loss counter');
    assert.equal(ulNode4?.snrDb, null, 'Outage SNR must not report fabricated high SNR');
    console.log('  -> PASS: Ridge occlusion and authentic packet loss faithfully reflected.');
  }

  // [6/8] Verifying mathematical consistency between aggregate and individual records
  console.log('\n[6/8] Verifying mathematical consistency between aggregate and individual records...');
  {
    const multiNodeFrame: NetworkTrafficFrame = {
      frameIndex: 50,
      simulationTimeS: 1.0,
      nodes: [
        {
          node_id: 1,
          name: 'S1',
          snr_db: 20.0,
          link_outage: false,
          terrain_is_los: true,
          obstacle_blocked: false,
          transfer_state: { status: 'TRANSMITTING', delivered_bytes: 300000, total_bytes: 500000, current_rate_mbps: 3.0, dropped_packets: 1 },
        },
        {
          node_id: 2,
          name: 'S2',
          snr_db: 16.0,
          link_outage: false,
          terrain_is_los: true,
          obstacle_blocked: false,
          transfer_state: { status: 'TRANSMITTING', delivered_bytes: 400000, total_bytes: 600000, current_rate_mbps: 4.0, dropped_packets: 0 },
        },
      ],
      downlinkTelemetry: { broadcast_active: true, dl_duration_ms: 3.0 },
    };

    const tracker2 = new NetworkTrafficTracker();
    tracker2.ingest(multiNodeFrame);
    const flows = tracker2.getFlowRecords(multiNodeFrame);
    const summary = tracker2.getCombinedNetworkSummary(flows);

    // Sum of individual flows
    const sumSent = flows.reduce((acc, f) => acc + f.dataSentBytes, 0);
    const sumRecv = flows.reduce((acc, f) => acc + f.dataReceivedBytes, 0);
    const sumUlRate = flows.filter(f => f.direction === 'Uplink').reduce((acc, f) => acc + f.dataRateMbps, 0);
    const sumLost = flows.reduce((acc, f) => acc + f.packetsLost, 0);

    assert.equal(summary.totalPayloadTransmittedBytes, sumSent, 'Aggregate sent must match sum of individual flows');
    assert.equal(summary.totalPayloadReceivedBytes, sumRecv, 'Aggregate received must match sum of individual flows');
    assert.equal(summary.totalUplinkThroughputMbps, Number(sumUlRate.toFixed(2)), 'Aggregate UL throughput must match sum of individual UL flows');
    assert.equal(summary.totalPacketsLost, sumLost, 'Aggregate packets lost must match sum of individual flow drops');
    assert.equal(summary.activeCommunicationLinksCount, 2);
    assert.equal(summary.averageSnrDb, 18.0, '(20.0 + 16.0) / 2 = 18.0 dB');
    assert.equal(summary.minimumSnrDb, 16.0, 'min(20, 16) = 16.0 dB');
    console.log('  -> PASS: Combined network summary strictly matches individual flow records.');
  }

  // [7/8] Verifying node deletion and pruning
  console.log('\n[7/8] Verifying node deletion and pruning...');
  {
    const tracker3 = new NetworkTrafficTracker();
    const frameWith3: NetworkTrafficFrame = {
      frameIndex: 1,
      simulationTimeS: 0.1,
      nodes: [
        { node_id: 1, snr_db: 20 },
        { node_id: 2, snr_db: 15 },
        { node_id: 3, snr_db: 18 },
      ],
    };
    tracker3.ingest(frameWith3);
    assert.equal(tracker3.getFlowRecords(frameWith3).filter(f => f.direction === 'Uplink').length, 3);

    // Node 2 deleted in next frame
    const frameWith2: NetworkTrafficFrame = {
      frameIndex: 2,
      simulationTimeS: 0.2,
      nodes: [
        { node_id: 1, snr_db: 20 },
        { node_id: 3, snr_db: 18 },
      ],
    };
    tracker3.ingest(frameWith2);
    const flowsAfterDelete = tracker3.getFlowRecords(frameWith2).filter(f => f.direction === 'Uplink');
    assert.equal(flowsAfterDelete.length, 2, 'Deleted node 2 must no longer appear in active flow records');
    assert.ok(flowsAfterDelete.every(f => f.fromId !== 2));
    console.log('  -> PASS: Pruned deleted nodes cleanly without ghost rows.');
  }

  // [8/8] Verifying formatting utilities
  console.log('\n[8/8] Verifying formatting utilities...');
  {
    assert.equal(formatTrafficBytes(0), '0.00 KB');
    assert.equal(formatTrafficBytes(512), '512 B');
    assert.equal(formatTrafficBytes(2048), '2.00 KB');
    assert.equal(formatTrafficBytes(2097152), '2.00 MB');
    assert.equal(formatTrafficBytes(1073741824 * 3.5), '3.50 GB');

    assert.equal(formatTrafficRate(0), '0.00 Mbps');
    assert.equal(formatTrafficRate(4.856), '4.86 Mbps');

    assert.equal(formatTrafficSimTime(null), '—');
    assert.equal(formatTrafficSimTime(-1), '—');
    assert.equal(formatTrafficSimTime(12.345), 'T+12.35s');

    assert.equal(formatTrafficSnr(null), '—');
    assert.equal(formatTrafficSnr(18.5), '+18.5 dB');
    assert.equal(formatTrafficSnr(-0.5), '-0.5 dB');

    assert.equal(getTrafficStatusBadge('CONNECTED').label, 'CONNECTED');
    assert.equal(getTrafficStatusBadge('BLOCKED_TERRAIN').label, 'TERRAIN BLOCKED');
    console.log('  -> PASS: Formatters and status badges strictly compliant.');
  }

  console.log('\n================================================================================');
  console.log('  ALL 8 NETWORK TRAFFIC INVENTORY VERIFICATION SUITES PASSED CLEANLY!');
  console.log('================================================================================');
}

runNetworkTrafficInventoryVerification();
