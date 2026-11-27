/**
 * src/core/qosSlaEngine.ts
 *
 * 3GPP TS 23.501 5QI Bearer SLA Compliance & Raj Jain's Fairness Index Engine.
 *
 * Provides:
 * 1. Exact mathematical Raj Jain Fairness Index J in [1/N, 1.0] with scale invariance.
 * 2. Canonical 3GPP TS 23.501 tactical bearers (5QI 69, 65, 67, 70) with authoritative PDBs.
 * 3. Per-bearer Head-of-Line sojourn delay tracking, PDB headroom clamping, and SLA verdicts.
 * 4. Comprehensive network SLA compliance and backlog aggregation.
 */

import { CANONICAL_5QI_PDB_MS, QOS_PROFILES } from './queues';
import { nodeMatchesTeam, parseTeamSelection } from './nodeRegistry';

export type SlaVerdict = 'SLA_COMPLIANT' | 'SLA_AT_RISK' | 'SLA_BREACHED';

export interface BearerSlaDefinition {
  readonly qos5qi: number;
  readonly name: string;
  readonly shortName: string;
  readonly pdbMs: number;
  readonly priorityRank: number;
  readonly defaultBytes: number;
}

export const CANONICAL_5QI_BEARERS: readonly BearerSlaDefinition[] = [
  {
    qos5qi: 69,
    name: 'C2 / Emergency SOS',
    shortName: '5QI-69 C2',
    pdbMs: CANONICAL_5QI_PDB_MS[69],
    priorityRank: QOS_PROFILES[69].priority,
    defaultBytes: QOS_PROFILES[69].defaultBytes,
  },
  {
    qos5qi: 65,
    name: 'MC-PTT Tactical Voice',
    shortName: '5QI-65 Voice',
    pdbMs: CANONICAL_5QI_PDB_MS[65],
    priorityRank: QOS_PROFILES[65].priority,
    defaultBytes: QOS_PROFILES[65].defaultBytes,
  },
  {
    qos5qi: 67,
    name: 'MC Tactical Video',
    shortName: '5QI-67 Video',
    pdbMs: CANONICAL_5QI_PDB_MS[67],
    priorityRank: QOS_PROFILES[67].priority,
    defaultBytes: QOS_PROFILES[67].defaultBytes,
  },
  {
    qos5qi: 70,
    name: 'ISR High-Res Imagery',
    shortName: '5QI-70 Photo',
    pdbMs: CANONICAL_5QI_PDB_MS[70],
    priorityRank: QOS_PROFILES[70].priority,
    defaultBytes: QOS_PROFILES[70].defaultBytes,
  },
];

export interface BearerSlaMetric {
  readonly qos5qi: number;
  readonly name: string;
  readonly shortName: string;
  readonly pdbMs: number;
  readonly priorityRank: number;
  readonly backlogBits: number;
  readonly backlogKbits: number;
  readonly estimatedMaxSojournMs: number;
  readonly pdbHeadroomPct: number;
  readonly compliantNodeCount: number;
  readonly totalNodes: number;
  readonly slaCompliancePct: number;
  readonly slaVerdict: SlaVerdict;
}

export interface QosNetworkSlaReport {
  readonly timestampMs: number;
  readonly jainsFairnessIndex: number;
  readonly overallSlaCompliancePct: number;
  readonly totalNetworkBacklogKbits: number;
  readonly totalNetworkBacklogBits: number;
  readonly bearers: readonly BearerSlaMetric[];
}

/**
 * Computes the exact Raj Jain Fairness Index J for non-negative allocations:
 *
 *           ( \sum_{i=1}^N x_i )^2
 *   J  =  -------------------------   \in [ 1/N, 1.0 ]
 *           N * \sum_{i=1}^N (x_i)^2
 *
 * Properties:
 * - When all allocations are equal (x_i = c > 0), J = 1.000000.
 * - When 1 user monopolizes all capacity and N-1 users receive 0, J = 1/N.
 * - Scale invariant: J(c * x) === J(x) for any c > 0.
 * - Returns 1.0 when N = 0 or sum(x_i) <= 0.
 */
export function computeJainsFairnessIndex(values: readonly number[]): number {
  if (!values || values.length === 0) {
    return 1.0;
  }

  // Filter to finite, non-negative entries
  const active = values.filter(v => Number.isFinite(v) && v >= 0);
  const n = active.length;
  if (n === 0) {
    return 1.0;
  }

  let sum = 0.0;
  let sumSq = 0.0;
  for (let i = 0; i < n; i++) {
    const val = active[i];
    sum += val;
    sumSq += val * val;
  }

  if (sum <= 0.0 || sumSq <= 0.0) {
    return 1.0;
  }

  const rawJain = (sum * sum) / (n * sumSq);
  // Guard against IEEE 754 precision overshoot above 1.0 or below 1/N
  const lowerBound = 1.0 / n;
  return Math.min(1.0, Math.max(lowerBound, rawJain));
}

/**
 * Helper extracting bearer backlog in bits from various node telemetry schemas.
 */
function extractBearerBacklogBits(node: any, qos5qi: number, defaultBytes: number): number {
  if (!node) return 0;

  // Direct bearer check if the record is per-bearer
  if (node.qos5qi === qos5qi || node.qos === qos5qi || node.bearer === qos5qi) {
    if (typeof node.backlogBits === 'number' && Number.isFinite(node.backlogBits)) return node.backlogBits;
    if (typeof node.backlog_bits === 'number' && Number.isFinite(node.backlog_bits)) return node.backlog_bits;
    if (typeof node.backlogBytes === 'number' && Number.isFinite(node.backlogBytes)) return node.backlogBytes * 8;
    if (typeof node.backlog_bytes === 'number' && Number.isFinite(node.backlog_bytes)) return node.backlog_bytes * 8;
    if (typeof node.backlogPackets === 'number' && Number.isFinite(node.backlogPackets)) return node.backlogPackets * defaultBytes * 8;
  }

  // Check domain queue object
  if (node.queue && typeof node.queue.getClassBacklogBits === 'function') {
    const bits = node.queue.getClassBacklogBits(qos5qi);
    if (Number.isFinite(bits)) return bits;
  }

  // Check telemetry fields by 5QI class
  switch (qos5qi) {
    case 69: {
      if (typeof node.c2_bytes === 'number' && Number.isFinite(node.c2_bytes)) return node.c2_bytes * 8;
      if (typeof node.q_c2_bits === 'number' && Number.isFinite(node.q_c2_bits)) return node.q_c2_bits;
      if (typeof node.q_c2 === 'number' && Number.isFinite(node.q_c2)) {
        return node.q_c2_unit === 'bits' ? node.q_c2 : node.q_c2 * 8;
      }
      if (typeof node.c2_backlog === 'number' && Number.isFinite(node.c2_backlog)) return node.c2_backlog * defaultBytes * 8;
      break;
    }
    case 65: {
      if (typeof node.voice_bytes === 'number' && Number.isFinite(node.voice_bytes)) return node.voice_bytes * 8;
      if (typeof node.q_voice_bits === 'number' && Number.isFinite(node.q_voice_bits)) return node.q_voice_bits;
      if (typeof node.q_voice === 'number' && Number.isFinite(node.q_voice)) {
        return node.q_voice_unit === 'bits' ? node.q_voice : node.q_voice * 8;
      }
      if (typeof node.voice_backlog === 'number' && Number.isFinite(node.voice_backlog)) return node.voice_backlog * defaultBytes * 8;
      break;
    }
    case 67: {
      if (typeof node.video_bytes === 'number' && Number.isFinite(node.video_bytes)) return node.video_bytes * 8;
      if (typeof node.q_video_bits === 'number' && Number.isFinite(node.q_video_bits)) return node.q_video_bits;
      if (typeof node.q_video === 'number' && Number.isFinite(node.q_video)) {
        return node.q_video_unit === 'bits' ? node.q_video : node.q_video * 8;
      }
      if (typeof node.video_backlog === 'number' && Number.isFinite(node.video_backlog)) return node.video_backlog * defaultBytes * 8;
      break;
    }
    case 70: {
      if (typeof node.photo_bytes === 'number' && Number.isFinite(node.photo_bytes)) return node.photo_bytes * 8;
      if (typeof node.q_photo_bits === 'number' && Number.isFinite(node.q_photo_bits)) return node.q_photo_bits;
      if (typeof node.q_photo === 'number' && Number.isFinite(node.q_photo)) {
        return node.q_photo_unit === 'bits' ? node.q_photo : node.q_photo * 8;
      }
      if (typeof node.photo_backlog === 'number' && Number.isFinite(node.photo_backlog)) return node.photo_backlog * defaultBytes * 8;
      break;
    }
  }

  // Fallback to generic 5qi keyed properties
  const keyMap = [`qos_${qos5qi}_bits`, `q_${qos5qi}_bits`, `backlog_${qos5qi}_bits`];
  for (const k of keyMap) {
    if (typeof node[k] === 'number' && Number.isFinite(node[k])) return node[k];
  }

  return 0;
}

/**
 * Helper extracting or estimating node sojourn / HoL delay in milliseconds for a bearer.
 */
function extractNodeBearerSojournMs(node: any, qos5qi: number, pdbMs: number, simTimeS?: number): number {
  if (!node) return 0.0;

  // 0. Live NodeTelemetryItem per-bearer HoL sojourn delay map
  if (node.bearer_hol_delay_ms && typeof node.bearer_hol_delay_ms === 'object') {
    let val: unknown;
    switch (qos5qi) {
      case 69: val = node.bearer_hol_delay_ms.c2_ms; break;
      case 65: val = node.bearer_hol_delay_ms.voice_ms; break;
      case 67: val = node.bearer_hol_delay_ms.video_ms; break;
      case 70: val = node.bearer_hol_delay_ms.photo_ms; break;
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      return Math.max(0.0, val);
    }
  }

  // 1. Direct bearer match if node is a bearer test object
  if (node.qos5qi === qos5qi || node.qos === qos5qi || node.bearer === qos5qi) {
    if (typeof node.sojournMs === 'number' && Number.isFinite(node.sojournMs)) return Math.max(0.0, node.sojournMs);
    if (typeof node.sojourn_ms === 'number' && Number.isFinite(node.sojourn_ms)) return Math.max(0.0, node.sojourn_ms);
    if (typeof node.holDelayMs === 'number' && Number.isFinite(node.holDelayMs)) return Math.max(0.0, node.holDelayMs);
    if (typeof node.hol_delay_ms === 'number' && Number.isFinite(node.hol_delay_ms)) return Math.max(0.0, node.hol_delay_ms);
  }

  // 2. Dictionary / Record lookups
  if (node.sojournMs && typeof node.sojournMs === 'object') {
    const val = node.sojournMs[qos5qi];
    if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0.0, val);
  }
  if (node.holDelayMs && typeof node.holDelayMs === 'object') {
    const val = node.holDelayMs[qos5qi];
    if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0.0, val);
  }

  // 3. Class-specific property names
  let prefix = '';
  switch (qos5qi) {
    case 69: prefix = 'c2'; break;
    case 65: prefix = 'voice'; break;
    case 67: prefix = 'video'; break;
    case 70: prefix = 'photo'; break;
  }

  if (prefix) {
    const candidates = [
      `${prefix}_sojourn_ms`,
      `${prefix}_hol_delay_ms`,
      `${prefix}_delay_ms`,
      `${prefix}_hol_ms`,
      `q_${prefix}_sojourn_ms`,
      `sojourn_${qos5qi}`,
      `hol_${qos5qi}`,
    ];
    for (const key of candidates) {
      if (typeof node[key] === 'number' && Number.isFinite(node[key])) {
        return Math.max(0.0, node[key]);
      }
    }
  }

  // 4. Domain queue inspection
  if (node.queue && typeof node.queue.getHolDelayS === 'function') {
    const holS = node.queue.getHolDelayS(qos5qi, simTimeS ?? 0.0);
    if (Number.isFinite(holS) && holS >= 0) {
      return holS * 1000.0;
    }
  }

  // 5. Backlog-driven sojourn estimation when explicit delay is not captured
  const backlogBits = extractBearerBacklogBits(node, qos5qi, 128);
  if (backlogBits <= 0) {
    return 0.0;
  }

  // Packets waiting in queue during outage or low throughput accumulate delay
  const isOutage = Boolean(node.link_outage || node.linkOutage || node.isOutage || node.is_outage);
  if (isOutage) {
    // Under outage, queue buffers accumulate multiple 20ms frames of delay
    const pktCount = Math.max(1, Math.round(backlogBits / 1024));
    return Math.min(pdbMs * 1.6, pktCount * 25.0);
  }

  return 0.0;
}

/**
 * Evaluates 3GPP TS 23.501 per-bearer SLA compliance and Jain's Fairness Index
 * across active terminals and scheduled TDMA slot allocations.
 */
export function evaluate5QiBearerSlaMetrics(
  nodes: readonly any[],
  ganttAllocations?: readonly any[]
): QosNetworkSlaReport {
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const totalNodes = nodeList.length;

  const bearers: BearerSlaMetric[] = [];
  let totalNetworkBacklogBits = 0;

  for (const def of CANONICAL_5QI_BEARERS) {
    let bearerBacklogBits = 0;
    let estimatedMaxSojournMs = 0.0;
    let compliantNodeCount = 0;

    for (let i = 0; i < totalNodes; i++) {
      const node = nodeList[i];
      const bits = extractBearerBacklogBits(node, def.qos5qi, def.defaultBytes);
      bearerBacklogBits += bits;

      const nodeSojournMs = extractNodeBearerSojournMs(node, def.qos5qi, def.pdbMs);
      if (nodeSojournMs > estimatedMaxSojournMs) {
        estimatedMaxSojournMs = nodeSojournMs;
      }

      if (nodeSojournMs <= def.pdbMs) {
        compliantNodeCount++;
      }
    }

    // If there are no nodes, compliance defaults to 100%
    const slaCompliancePct = totalNodes > 0
      ? (compliantNodeCount / totalNodes) * 100.0
      : 100.0;

    const backlogKbits = bearerBacklogBits / 1000.0;
    totalNetworkBacklogBits += bearerBacklogBits;

    // Headroom = clamp[0, 100]((1 - sojourn / pdb) * 100)
    const rawHeadroom = (1.0 - (estimatedMaxSojournMs / def.pdbMs)) * 100.0;
    const pdbHeadroomPct = Math.min(100.0, Math.max(0.0, rawHeadroom));

    // Verdict: COMPLIANT (<= 75%), AT_RISK (<= 100%), BREACHED (> 100%)
    let slaVerdict: SlaVerdict = 'SLA_COMPLIANT';
    if (estimatedMaxSojournMs > def.pdbMs) {
      slaVerdict = 'SLA_BREACHED';
    } else if (estimatedMaxSojournMs > 0.75 * def.pdbMs) {
      slaVerdict = 'SLA_AT_RISK';
    }

    bearers.push({
      qos5qi: def.qos5qi,
      name: def.name,
      shortName: def.shortName,
      pdbMs: def.pdbMs,
      priorityRank: def.priorityRank,
      backlogBits: bearerBacklogBits,
      backlogKbits,
      estimatedMaxSojournMs,
      pdbHeadroomPct,
      compliantNodeCount,
      totalNodes,
      slaCompliancePct,
      slaVerdict,
    });
  }

  // Overall SLA Compliance: mean of the 4 bearers
  const overallSlaCompliancePct = bearers.length > 0
    ? bearers.reduce((acc, b) => acc + b.slaCompliancePct, 0.0) / bearers.length
    : 100.0;

  const totalNetworkBacklogKbits = totalNetworkBacklogBits / 1000.0;

  // Jain's Fairness Index computation across active LoS nodes
  const losNodes = nodeList.filter(n => {
    const isOutage = Boolean(n.link_outage || n.linkOutage || n.isOutage || n.is_outage);
    const isLos = n.terrain_is_los !== undefined ? Boolean(n.terrain_is_los) : (n.isLos !== undefined ? Boolean(n.isLos) : true);
    return isLos && !isOutage;
  });

  const targetNodes = losNodes.length > 0 ? losNodes : nodeList;
  const hasGantt = Array.isArray(ganttAllocations);
  const allocationsList = hasGantt ? ganttAllocations : [];

  const resourceValues: number[] = [];
  for (let i = 0; i < targetNodes.length; i++) {
    const node = targetNodes[i];
    const nid = node.nodeId ?? node.node_id ?? i;

    // Sum capacity from allocations matching this node
    let allocatedBits = 0;
    for (const alloc of allocationsList) {
      const allocNid = alloc.nodeId ?? alloc.node_id;
      if (allocNid === nid) {
        const cap = alloc.capacityBits ?? alloc.capacity_bits ?? 0;
        allocatedBits += cap;
      }
    }

    if (!hasGantt && allocatedBits <= 0) {
      // Fallback to node's reported capacity or bitrate only when ganttAllocations is omitted
      allocatedBits = node.allocated_capacity_bits ?? node.capacityBits ?? node.bitrate_bps ?? 0;
    }

    resourceValues.push(allocatedBits);
  }

  const jainsFairnessIndex = computeJainsFairnessIndex(resourceValues);

  return {
    timestampMs: Date.now(),
    jainsFairnessIndex,
    overallSlaCompliancePct,
    totalNetworkBacklogKbits,
    totalNetworkBacklogBits,
    bearers,
  };
}

/**
 * Filters node telemetry items belonging to a tactical team (`team:<teamId>` or raw `<teamId>`).
 */
export function filterNodesByTeam<T extends { readonly team_id?: string | null; readonly teamId?: string | null; readonly team_name?: string | null; readonly teamName?: string | null }>(
  nodes: readonly T[],
  teamIdOrSelection: string
): readonly T[] {
  if (!Array.isArray(nodes)) return [];
  const key = parseTeamSelection(teamIdOrSelection) ?? teamIdOrSelection;
  if (!key) return nodes;
  return nodes.filter(node => nodeMatchesTeam(node, key));
}

/**
 * Evaluates 3GPP TS 23.501 5QI bearer SLA compliance scoped to a single tactical team.
 */
export function evaluateTeam5QiBearerSlaMetrics(
  nodes: readonly any[],
  teamIdOrSelection: string,
  ganttAllocations?: readonly any[]
): QosNetworkSlaReport {
  const members = filterNodesByTeam(nodes, teamIdOrSelection);
  const memberIds = new Set(
    members.map((n: any) => n.nodeId ?? n.node_id).filter((id: unknown): id is number => typeof id === 'number')
  );
  const filteredAllocs = Array.isArray(ganttAllocations)
    ? ganttAllocations.filter((a: any) => memberIds.has(a.nodeId ?? a.node_id))
    : undefined;
  return evaluate5QiBearerSlaMetrics(members, filteredAllocs);
}
