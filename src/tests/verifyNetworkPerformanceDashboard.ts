import { aggregateNetworkSample, NetworkPerformanceHistory } from '../ui/networkPerformanceDashboard';

const history = new NetworkPerformanceHistory(2, 1);
history.ingest({
  frameIndex: 1,
  simulationTimeS: 1,
  nodes: [
    { node_id: 1, snr_db: 10, link_outage: false, transfer_state: { current_rate_bps: 1e6, delivered_bytes: 100 } },
    { node_id: 2, snr_db: -5, link_outage: true, transfer_state: { current_rate_bps: 0, delivered_bytes: 50 } },
  ],
});
const sample = history.ingest({
  frameIndex: 2,
  simulationTimeS: 2,
  nodes: [
    { node_id: 1, snr_db: 11, link_outage: false, transfer_state: { current_rate_bps: 2e6, delivered_bytes: 300 } },
    { node_id: 2, snr_db: -4, link_outage: true, transfer_state: { current_rate_bps: 5e5, delivered_bytes: 20 } },
  ],
});

if (!sample) throw new Error('Expected a dashboard sample.');
if (Math.abs(sample.nodes[0].transferredMb - 0.0024) > 1e-12) throw new Error('Node delivered bytes were double-counted or misconverted to Mb.');
const aggregate = aggregateNetworkSample(sample);
if (aggregate.totalRateMbps !== 2.5) throw new Error('Aggregate rate did not sum achieved rates.');
if (Math.abs(aggregate.totalTransferredMb - 0.00296) > 1e-12) throw new Error('Aggregate transferred data is incorrect.');
if (aggregate.averageSnrDb !== 11 || aggregate.minimumSnrDb !== 11) throw new Error('Invalid link polluted SNR aggregate.');
if (history.getSamples().length !== 2 || history.getSamples().length > history.capacity) throw new Error('History bound failed.');
console.log('Network performance dashboard verification passed.');
