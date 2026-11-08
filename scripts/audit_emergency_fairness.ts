/**
 * scripts/audit_emergency_fairness.ts
 *
 * Stress-tests emergency queue fairness and verifies absence of permanent starvation
 * under continuous adversarial emergency arrivals on low-index nodes.
 */

import assert from 'node:assert/strict';
import { SimulationWorkerManager } from '../src/worker/simWorker';

const sim = new SimulationWorkerManager(101, '16_NODES');

// Track service history per node
const nodeServiceCount = new Map<number, number>();
const nodeMaxWaitFrames = new Map<number, number>();
const nodeLastServedFrame = new Map<number, number>();

for (let i = 0; i < 16; i++) {
  nodeServiceCount.set(i, 0);
  nodeMaxWaitFrames.set(i, 0);
  nodeLastServedFrame.set(i, 0);
}

// Hook evaluatePredictiveState to observe exactly which nodes are evaluated on each frame
const origEval = sim.lookaheadEngine.evaluatePredictiveState.bind(sim.lookaheadEngine);
sim.lookaheadEngine.evaluatePredictiveState = (pos, t, obs) => {
  // Find which node has this position
  const node = sim.nodesTac.find(n =>
    Math.hypot(n.position[0] - pos[0], n.position[1] - pos[1], n.position[2] - pos[2]) < 1e-3
  );
  if (node) {
    const nid = node.nodeId;
    nodeServiceCount.set(nid, (nodeServiceCount.get(nid) ?? 0) + 1);
    const last = nodeLastServedFrame.get(nid) ?? 0;
    const wait = sim.frameIndex - last;
    if (wait > (nodeMaxWaitFrames.get(nid) ?? 0)) {
      nodeMaxWaitFrames.set(nid, wait);
    }
    nodeLastServedFrame.set(nid, sim.frameIndex);
  }
  return origEval(pos, t, obs);
};

// Run 50 frames with CONTINUOUS ADVERSARIAL INVALIDATION of nodes 0, 1, 2, 3
console.log('Running 50 frames under continuous adversarial cache invalidation of nodes 0..3...');
for (let f = 1; f <= 50; f++) {
  // Adversarial: constantly invalidate low-index nodes 0, 1, 2, 3 before every tick
  sim.lookaheadEngine.invalidateNode(0);
  sim.lookaheadEngine.invalidateNode(1);
  sim.lookaheadEngine.invalidateNode(2);
  sim.lookaheadEngine.invalidateNode(3);

  // Invalidate high-index nodes 12, 13, 14, 15 periodically (every 5 frames) to test their queue latency
  if (f % 5 === 1) {
    sim.lookaheadEngine.invalidateNode(12);
    sim.lookaheadEngine.invalidateNode(13);
    sim.lookaheadEngine.invalidateNode(14);
    sim.lookaheadEngine.invalidateNode(15);
  }

  sim.tickSimulation(false);
}

console.log('\n--- Service Counts and Maximum Wait Durations across 50 Frames ---');
let hasStarvation = false;
for (let i = 0; i < 16; i++) {
  const count = nodeServiceCount.get(i) ?? 0;
  const maxWait = nodeMaxWaitFrames.get(i) ?? 0;
  const lastServed = nodeLastServedFrame.get(i) ?? 0;
  const finalStarved = (50 - lastServed) > 10;
  if (count === 0 || finalStarved) hasStarvation = true;

  console.log(`Node ${i.toString().padStart(2, ' ')}: Served ${count.toString().padStart(2, ' ')} times | Max Wait: ${maxWait.toString().padStart(2, ' ')} frames (${(maxWait * 20).toString().padStart(3, ' ')}ms) | Last Served: Frame ${lastServed}`);
}

console.log(`\nStarvation detected: ${hasStarvation ? 'YES (UNACCEPTABLE)' : 'NO (SERVICE GUARANTEED)'}`);
assert.equal(hasStarvation, false, 'No node should starve even under continuous adversarial emergency arrivals');
console.log('[✓] Emergency Queue Fairness & Anti-Starvation Invariant Verified!');
