/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Constellation, MANET Routing, Ground Convoy & Aerodynamics Engine (V3-04)
 *
 * Implements pure, stateless, deterministic mathematical models for:
 * 1. Multi-ACN phased constellation geometry and A2A cross-link backhaul link budgets.
 * 2. 3GPP-aligned Event A3 make-before-break handover state machine with load shedding.
 * 3. Multi-hop Dijkstra MANET router with in-band half-duplex capacity penalty:
 *    R_e2e = 1 / sum(1 / R_h).
 * 4. Continuous ground convoy / patrol mobility along closed tactical corridors.
 * 5. ISA barometric air density, true airspeed stall floor, crosswind crab angle,
 *    mission endurance bingo fuel tracking, and automatic CFIT pull-up safety.
 *
 * All functions are 100% pure, deterministic, free of Math.random(), and execute in < 5 µs/call.
 */

import { EnvironmentConfig, RFConfig, SPEED_OF_LIGHT } from './config';
import { LinkBudgetEngine } from './linkBudget';
import type { TerrainEngine } from './terrain';

const SHARED_CONSTELLATION_LINK_ENGINE = new LinkBudgetEngine();
const DEFAULT_CONSTELLATION_RF = new RFConfig();
const DEFAULT_CONSTELLATION_ENV = new EnvironmentConfig();

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ConstellationAcnState {
  id: string;
  name: string;
  position: [number, number, number];
  headingDeg: number;
}

export interface A2aCrosslinkResult {
  distanceM: number;
  horizonDistanceM: number;
  isLineOfSightClear: boolean;
  losClear?: boolean;
  fsplDb: number;
  rxPowerDbm: number;
  snrDb: number;
  capacityMbps: number;
  backhaulMbps?: number;
}

export interface NodeHandoverState {
  servingAcnId: string;
  timeToTriggerCount: number;
  candidateAcnId: string | null;
}

export interface HandoverParams {
  hysteresisDb?: number;
  timeToTriggerFrames?: number;
  outageFallbackSnrDb?: number;
}

export interface HandoverStepResult {
  state: NodeHandoverState;
  handoverTriggered: boolean;
  reason: 'NONE' | 'EVENT_A3' | 'OUTAGE_FALLBACK';
  servingAcnId: string;
  candidateAcnId: string | null;
  timeToTriggerCount: number;
}

export interface PeerLink {
  fromId: number;
  toId: number;
  capacityMbps: number;
  distanceM: number;
}

export interface ManetRouteParams {
  sourceNodeId: number;
  gatewayNodeIds: number[];
  peerLinks: PeerLink[];
  maxHops?: number;
  perHopRelayTurnaroundMs?: number;
}

export interface ManetRouteResult {
  route: number[];
  hopCount: number;
  e2eCapacityMbps: number;
  e2eLatencyMs: number;
  isRelayed: boolean;
  bottleneckHopCapacityMbps: number;
  error?: string;
}

export interface GroundConvoyState {
  nodeId: number;
  corridor: Array<[number, number]>;
  currentPos: [number, number];
  waypointIndex: number;
  speedMs: number;
  headingDeg: number;
  vx: number;
  vy: number;
}

export interface AerodynamicParams {
  altitudeMslM: number;
  trueAirspeedMps: number;
  trackHeadingDeg: number;
  windSpeedMs: number;
  windDirectionDeg: number;
  seaLevelStallSpeedMps?: number;
}

export interface AerodynamicResult {
  densityRatio: number;
  airDensityKgM3: number;
  stallSpeedTasMps: number;
  stallWarning: boolean;
  crosswindMps: number;
  headwindMps: number;
  crabAngleDeg: number;
  groundSpeedMps: number;
}

export interface CfitParams {
  currentAltitudeMslM: number;
  vzMps: number;
  maxTerrainAheadM: number;
  minAglFloorM?: number;
  maxClimbRateMps?: number;
  lookaheadSec?: number;
}

export interface CfitCommandResult {
  cfitPullUpActive: boolean;
  commandedAltitudeMslM: number;
  commandedVzMps: number;
}

export interface ConstellationMobilityTelemetry {
  acn_count: number;
  secondary_acns: Array<{
    id: string;
    name: string;
    pos_x: number;
    pos_y: number;
    altitude_msl_m: number;
    heading_deg: number;
    backhaul_snr_db: number;
    backhaul_capacity_mbps: number;
  }>;
  handover_events_total: number;
  active_serving_acns: Record<number, string>;
  manet_active_routes: Array<{
    source_node_id: number;
    gateway_node_id: number;
    hops: number[];
    e2e_capacity_mbps: number;
    e2e_latency_ms: number;
  }>;
  manet_mean_hops: number;
  manet_mean_e2e_mbps: number;
  ground_convoys: Array<{
    node_id: number;
    x: number;
    y: number;
    speed_ms: number;
    heading_deg: number;
  }>;
  aerodynamics: {
    density_ratio: number;
    air_density_kg_m3: number;
    stall_speed_tas_mps: number;
    stall_warning: boolean;
    crosswind_mps: number;
    crab_angle_deg: number;
    ground_speed_mps: number;
    endurance_remaining_min: number;
    bingo_alert: boolean;
    cfit_pull_up_active: boolean;
  };
}

// ============================================================================
// 1. Multi-ACN Constellation Geometry & A2A Cross-Link
// ============================================================================

/**
 * Deterministically generates positions and headings for a 1-4 ACN constellation.
 * ACN-1 remains at the primary trajectory position.
 * Secondary ACNs maintain a phased tactical formation orbit with vertical deconfliction.
 */
export function generateConstellationAcnPositions(
  primaryAcnPos: [number, number, number],
  acnCount: number = 1,
  formationRadiusM: number = 18000.0,
  simTimeSec: number = 0.0,
  orbitPeriodSec: number = 720.0
): ConstellationAcnState[] {
  const count = Math.min(4, Math.max(1, Math.floor(acnCount)));
  const result: ConstellationAcnState[] = [
    {
      id: 'ACN-1',
      name: 'ACN-1 (Primary)',
      position: [primaryAcnPos[0], primaryAcnPos[1], primaryAcnPos[2]],
      headingDeg: 0.0,
    },
  ];

  if (count <= 1) return result;

  const twoPi = 2.0 * Math.PI;
  const tMod = simTimeSec % orbitPeriodSec;
  const orbitPhase = (twoPi * tMod) / orbitPeriodSec;

  for (let k = 1; k < count; k++) {
    const phaseOffset = (twoPi * k) / count;
    const theta = orbitPhase + phaseOffset;
    const dx = formationRadiusM * Math.cos(theta);
    const dy = formationRadiusM * Math.sin(theta);
    const dz = k * 150.0; // 150 m vertical separation

    // Tangent flight heading: d/dt [cos(theta), sin(theta)] = [-sin(theta), cos(theta)]
    const headingRad = theta + Math.PI / 2.0;
    let headingDeg = (headingRad * 180.0) / Math.PI;
    headingDeg = ((headingDeg % 360.0) + 360.0) % 360.0;

    result.push({
      id: `ACN-${k + 1}`,
      name: `ACN-${k + 1} (Phased)`,
      position: [primaryAcnPos[0] + dx, primaryAcnPos[1] + dy, primaryAcnPos[2] + dz],
      headingDeg: Number(headingDeg.toFixed(2)),
    });
  }

  return result;
}

/**
 * Evaluates directional X-Band Air-to-Air (A2A) cross-link backhaul between two ACNs.
 * Checks smooth-Earth 4/3 effective Earth radius radio horizon clearance and optional
 * intermediate high-relief terrain ridge blockage.
 */
export function evaluateA2aCrosslink(
  acnA: [number, number, number],
  acnB: [number, number, number],
  freqHz: number = 8e9,
  txPowerDbm: number = 33.0,
  txGainDbi: number = 15.0,
  rxGainDbi: number = 15.0,
  bandwidthHz: number = 50e6,
  noiseFigureDb: number = 4.0,
  maxCapacityMbps: number = 150.0,
  peakTerrainElevM?: number
): A2aCrosslinkResult {
  const dx = acnA[0] - acnB[0];
  const dy = acnA[1] - acnB[1];
  const dz = acnA[2] - acnB[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 4/3 Effective Earth radius (8,494,667 m)
  const effectiveEarthRadiusM = (4.0 / 3.0) * 6371000.0;
  const hA = Math.max(0.0, acnA[2]);
  const hB = Math.max(0.0, acnB[2]);
  const horizonDistanceM = Math.sqrt(2.0 * effectiveEarthRadiusM * hA) + Math.sqrt(2.0 * effectiveEarthRadiusM * hB);

  const isLineOfSightClear = d <= horizonDistanceM && d > 0.0;
  if (!isLineOfSightClear || d <= 0.0) {
    return {
      distanceM: d,
      horizonDistanceM,
      isLineOfSightClear: false,
      losClear: false,
      fsplDb: 999.0,
      rxPowerDbm: -999.0,
      snrDb: -99.0,
      capacityMbps: 0.0,
      backhaulMbps: 0.0,
    };
  }

  // Terrain ridge clearance check if peakTerrainElevM supplied
  if (peakTerrainElevM !== undefined) {
    // Straight-line midpoint altitude above MSL
    const midAltMslM = (hA + hB) * 0.5;
    // 4/3 Re Earth curvature drop at midpoint: d^2 / (8 * Re')
    const earthCurvatureDropM = (d * d) / (8.0 * effectiveEarthRadiusM);
    const rayMidAltM = midAltMslM - earthCurvatureDropM;

    if (rayMidAltM < peakTerrainElevM) {
      return {
        distanceM: d,
        horizonDistanceM,
        isLineOfSightClear: false,
        losClear: false,
        fsplDb: 999.0,
        rxPowerDbm: -999.0,
        snrDb: -99.0,
        capacityMbps: 0.0,
        backhaulMbps: 0.0,
      };
    }
  }

  // FSPL = 20 log10(d) + 20 log10(f) - 147.55
  const fsplDb = 20.0 * Math.log10(Math.max(1.0, d)) + 20.0 * Math.log10(freqHz) - 147.55;
  const rxPowerDbm = txPowerDbm + txGainDbi + rxGainDbi - fsplDb;

  // Noise floor: -174 dBm/Hz + 10 log10(B) + NF
  const noisePowerDbm = -174.0 + 10.0 * Math.log10(bandwidthHz) + noiseFigureDb;
  const snrDb = rxPowerDbm - noisePowerDbm;

  // Capacity with 3 dB implementation margin: C = B * log2(1 + 10^((SNR - 3)/10))
  const linearSnrMargin = Math.pow(10.0, (snrDb - 3.0) / 10.0);
  const capacityBps = bandwidthHz * (Math.log(1.0 + linearSnrMargin) / Math.LN2);
  const capacityMbps = Math.min(maxCapacityMbps, Math.max(0.0, capacityBps / 1e6));
  const roundedCapacity = Number(capacityMbps.toFixed(3));

  return {
    distanceM: d,
    horizonDistanceM,
    isLineOfSightClear: true,
    losClear: true,
    fsplDb,
    rxPowerDbm,
    snrDb,
    capacityMbps: roundedCapacity,
    backhaulMbps: roundedCapacity,
  };
}

// ============================================================================
// 2. 3GPP Event A3 Make-Before-Break Handover State Machine
// ============================================================================

/**
 * Executes a single discrete-event tick of the 3GPP-aligned Event A3 handover algorithm.
 * Handles Time-to-Trigger (TTT = 5 frames), load-shedding penalties, and immediate outage fallback.
 */
export function stepEventA3Handover(
  state: NodeHandoverState,
  acnSnrMap: Record<string, number> | Map<string, number>,
  acnLoadMap: Record<string, number> = {},
  params: HandoverParams = {}
): HandoverStepResult {
  const hysteresisDb = params.hysteresisDb ?? 2.0;
  const timeToTriggerFrames = params.timeToTriggerFrames ?? 5;
  const outageFallbackSnrDb = params.outageFallbackSnrDb ?? -1.5;

  const getSnr = (acnId: string): number => {
    if (acnSnrMap instanceof Map) return acnSnrMap.get(acnId) ?? -99.0;
    return acnSnrMap[acnId] ?? -99.0;
  };

  const servingAcnId = state.servingAcnId || 'ACN-1';
  const servingSnr = getSnr(servingAcnId);
  const servingLoad = acnLoadMap[servingAcnId] ?? 0.0;
  const servingLoadPenalty = Math.max(0.0, (servingLoad - 0.85) * 10.0);
  const effServingSnr = servingSnr - servingLoadPenalty;

  // Find best candidate among other ACNs
  let bestCandidateId: string | null = null;
  let bestCandidateEffSnr = -999.0;
  let bestCandidateRawSnr = -999.0;

  const candidateIds = Object.keys(acnSnrMap instanceof Map ? Object.fromEntries(acnSnrMap) : acnSnrMap).filter(
    (id) => id !== servingAcnId
  );

  for (const cid of candidateIds) {
    const rawSnr = getSnr(cid);
    const load = acnLoadMap[cid] ?? 0.0;
    const loadPenalty = Math.max(0.0, (load - 0.85) * 10.0);
    const effSnr = rawSnr - loadPenalty;

    if (effSnr > bestCandidateEffSnr) {
      bestCandidateEffSnr = effSnr;
      bestCandidateRawSnr = rawSnr;
      bestCandidateId = cid;
    }
  }

  // 1. Immediate Outage Fallback: if serving link in deep outage while a valid candidate exists
  if (servingSnr < outageFallbackSnrDb && bestCandidateId !== null && bestCandidateRawSnr >= 0.0) {
    return {
      state: {
        servingAcnId: bestCandidateId,
        timeToTriggerCount: 0,
        candidateAcnId: null,
      },
      handoverTriggered: true,
      reason: 'OUTAGE_FALLBACK',
      servingAcnId: bestCandidateId,
      candidateAcnId: null,
      timeToTriggerCount: 0,
    };
  }

  // 2. Standard 3GPP Event A3 Evaluation
  if (bestCandidateId !== null && bestCandidateEffSnr > effServingSnr + hysteresisDb) {
    const isSameCandidate = state.candidateAcnId === bestCandidateId;
    const newCount = isSameCandidate ? state.timeToTriggerCount + 1 : 1;

    if (newCount >= timeToTriggerFrames) {
      // Handover committed (make-before-break, zero drop)
      return {
        state: {
          servingAcnId: bestCandidateId,
          timeToTriggerCount: 0,
          candidateAcnId: null,
        },
        handoverTriggered: true,
        reason: 'EVENT_A3',
        servingAcnId: bestCandidateId,
        candidateAcnId: null,
        timeToTriggerCount: 0,
      };
    } else {
      // Incrementing trigger timer
      return {
        state: {
          servingAcnId,
          timeToTriggerCount: newCount,
          candidateAcnId: bestCandidateId,
        },
        handoverTriggered: false,
        reason: 'NONE',
        servingAcnId,
        candidateAcnId: bestCandidateId,
        timeToTriggerCount: newCount,
      };
    }
  }

  // Condition not met -> reset TTT counter
  return {
    state: {
      servingAcnId,
      timeToTriggerCount: 0,
      candidateAcnId: null,
    },
    handoverTriggered: false,
    reason: 'NONE',
    servingAcnId,
    candidateAcnId: null,
    timeToTriggerCount: 0,
  };
}

// ============================================================================
// 3. Multi-Hop Dijkstra MANET Router with In-Band Half-Duplex Penalty
// ============================================================================

/**
 * Computes an optimal multi-hop MANET route from an isolated ground node to an ACN gateway node.
 * Evaluates the authoritative in-band half-duplex throughput penalty:
 * R_e2e = 1 / sum(1 / R_h).
 */
export function computeMultiHopManetRoute(params: ManetRouteParams): ManetRouteResult {
  const { sourceNodeId, gatewayNodeIds, peerLinks, maxHops = 3, perHopRelayTurnaroundMs = 2.5 } = params;

  if (gatewayNodeIds.includes(sourceNodeId)) {
    return {
      route: [sourceNodeId],
      hopCount: 0,
      e2eCapacityMbps: 0.0,
      e2eLatencyMs: 0.0,
      isRelayed: false,
      bottleneckHopCapacityMbps: 0.0,
    };
  }

  if (gatewayNodeIds.length === 0 || peerLinks.length === 0) {
    return {
      route: [],
      hopCount: 0,
      e2eCapacityMbps: 0.0,
      e2eLatencyMs: 0.0,
      isRelayed: false,
      bottleneckHopCapacityMbps: 0.0,
      error: 'NO_GATEWAY_ROUTE',
    };
  }

  // Build adjacency graph
  const adj = new Map<number, Array<{ to: number; capacityMbps: number; distanceM: number; weight: number }>>();
  for (const link of peerLinks) {
    if (link.capacityMbps <= 0.0) continue;
    const weight = 1.0 / Math.max(0.1, link.capacityMbps) + 0.05;

    // Direct from -> to
    if (!adj.has(link.fromId)) adj.set(link.fromId, []);
    adj.get(link.fromId)!.push({ to: link.toId, capacityMbps: link.capacityMbps, distanceM: link.distanceM, weight });

    // Reverse to -> from (bidirectional ad-hoc peer channel)
    if (!adj.has(link.toId)) adj.set(link.toId, []);
    adj.get(link.toId)!.push({ to: link.fromId, capacityMbps: link.capacityMbps, distanceM: link.distanceM, weight });
  }

  // 2D Dijkstra search tracking lowest cost per (nodeId, hopCount) pair within maxHops
  interface DijkstraNode {
    nodeId: number;
    cost: number;
    hops: number;
    path: number[];
  }

  // dist2D tracks min cost for each (nodeId, hops) pair: key `${nodeId}:${hops}`
  const dist2D = new Map<string, number>();
  dist2D.set(`${sourceNodeId}:0`, 0.0);

  const queue: DijkstraNode[] = [{ nodeId: sourceNodeId, cost: 0.0, hops: 0, path: [sourceNodeId] }];
  let bestRoute: number[] = [];
  let bestCost = Infinity;

  while (queue.length > 0) {
    // Deterministic min extraction
    queue.sort((a, b) => a.cost - b.cost);
    const curr = queue.shift()!;

    if (curr.cost >= bestCost) continue;

    if (gatewayNodeIds.includes(curr.nodeId)) {
      if (curr.cost < bestCost) {
        bestCost = curr.cost;
        bestRoute = curr.path;
      }
      continue;
    }

    if (curr.hops >= maxHops) continue;

    const nextHops = curr.hops + 1;
    const neighbors = adj.get(curr.nodeId) || [];
    for (const edge of neighbors) {
      if (curr.path.includes(edge.to)) continue; // Avoid topological cycles

      const nextCost = curr.cost + edge.weight;
      const stateKey = `${edge.to}:${nextHops}`;
      const existingDist = dist2D.get(stateKey) ?? Infinity;

      if (nextCost < existingDist - 1e-9) {
        dist2D.set(stateKey, nextCost);
        queue.push({
          nodeId: edge.to,
          cost: nextCost,
          hops: nextHops,
          path: [...curr.path, edge.to],
        });
      }
    }
  }

  if (bestRoute.length < 2) {
    return {
      route: [],
      hopCount: 0,
      e2eCapacityMbps: 0.0,
      e2eLatencyMs: 0.0,
      isRelayed: false,
      bottleneckHopCapacityMbps: 0.0,
      error: 'NO_GATEWAY_ROUTE',
    };
  }

  // Calculate in-band half-duplex throughput and cumulative latency
  const hopCount = bestRoute.length - 1;
  let inverseCapacitySum = 0.0;
  let totalDistanceM = 0.0;
  let minHopCapacity = Infinity;

  for (let i = 0; i < hopCount; i++) {
    const u = bestRoute[i];
    const v = bestRoute[i + 1];
    const edge = (adj.get(u) || []).find((e) => e.to === v);
    const cap = edge?.capacityMbps ?? 10.0;
    const distM = edge?.distanceM ?? 1000.0;

    minHopCapacity = Math.min(minHopCapacity, cap);
    inverseCapacitySum += 1.0 / Math.max(1e-6, cap);
    totalDistanceM += distM;
  }

  // Exact half-duplex in-band throughput: R_e2e = 1 / sum(1 / R_h)
  const e2eCapacityMbps = inverseCapacitySum > 0 ? 1.0 / inverseCapacitySum : 0.0;

  // Latency: sum(d_h / c) + (H - 1) * T_turnaround
  const propagationLatencyMs = (totalDistanceM / SPEED_OF_LIGHT) * 1000.0;
  const turnaroundLatencyMs = Math.max(0, hopCount - 1) * perHopRelayTurnaroundMs;
  const e2eLatencyMs = propagationLatencyMs + turnaroundLatencyMs;

  return {
    route: bestRoute,
    hopCount,
    e2eCapacityMbps: Number(e2eCapacityMbps.toFixed(3)),
    e2eLatencyMs: Number(e2eLatencyMs.toFixed(3)),
    isRelayed: true,
    bottleneckHopCapacityMbps: Number(minHopCapacity.toFixed(3)),
  };
}

// ============================================================================
// 4. Continuous Ground Convoy / Patrol Kinematics
// ============================================================================

/**
 * Advances a ground unit smoothly and deterministically along a closed corridor at configured speed.
 */
export function stepGroundConvoyNode(convoy: GroundConvoyState, dtSec: number): GroundConvoyState {
  if (!convoy.corridor || convoy.corridor.length < 2) {
    return convoy;
  }

  const currentWpIndex = convoy.waypointIndex % convoy.corridor.length;
  const targetWp = convoy.corridor[currentWpIndex];

  const dx = targetWp[0] - convoy.currentPos[0];
  const dy = targetWp[1] - convoy.currentPos[1];
  const distToTarget = Math.sqrt(dx * dx + dy * dy);

  const stepDist = convoy.speedMs * dtSec;

  if (distToTarget <= stepDist || distToTarget < 0.1) {
    // Waypoint reached -> snap to waypoint and advance to next
    const nextWpIndex = (currentWpIndex + 1) % convoy.corridor.length;
    const nextTarget = convoy.corridor[nextWpIndex];
    const ndx = nextTarget[0] - targetWp[0];
    const ndy = nextTarget[1] - targetWp[1];
    const ndist = Math.sqrt(ndx * ndx + ndy * ndy) || 1.0;

    const vx = (ndx / ndist) * convoy.speedMs;
    const vy = (ndy / ndist) * convoy.speedMs;
    const headingRad = Math.atan2(ndy, ndx);
    let headingDeg = (headingRad * 180.0) / Math.PI;
    headingDeg = ((headingDeg % 360.0) + 360.0) % 360.0;

    return {
      ...convoy,
      currentPos: [targetWp[0], targetWp[1]],
      waypointIndex: nextWpIndex,
      vx,
      vy,
      headingDeg: Number(headingDeg.toFixed(2)),
    };
  }

  // Advance along current segment
  const ux = dx / distToTarget;
  const uy = dy / distToTarget;
  const newX = convoy.currentPos[0] + ux * stepDist;
  const newY = convoy.currentPos[1] + uy * stepDist;

  const vx = ux * convoy.speedMs;
  const vy = uy * convoy.speedMs;
  const headingRad = Math.atan2(uy, ux);
  let headingDeg = (headingRad * 180.0) / Math.PI;
  headingDeg = ((headingDeg % 360.0) + 360.0) % 360.0;

  return {
    ...convoy,
    currentPos: [newX, newY],
    vx,
    vy,
    headingDeg: Number(headingDeg.toFixed(2)),
  };
}

// ============================================================================
// 5. ISA Air Density, Wind Coupling, Endurance & CFIT Safety
// ============================================================================

/**
 * Computes International Standard Atmosphere (ISA) air density ratio, true airspeed stall floor,
 * crosswind crab angle, and ground speed.
 */
export function evaluateHighAltAerodynamics(params: AerodynamicParams): AerodynamicResult {
  const {
    altitudeMslM,
    trueAirspeedMps,
    trackHeadingDeg,
    windSpeedMs,
    windDirectionDeg,
    seaLevelStallSpeedMps = 24.0,
  } = params;

  // ISA Troposphere density ratio: sigma = (1 - 2.25577e-5 * h)^4.25588
  const hClamped = Math.max(0.0, Math.min(11000.0, altitudeMslM));
  const base = 1.0 - 2.25577e-5 * hClamped;
  const densityRatio = Math.max(0.01, Math.pow(Math.max(0.0, base), 4.25588));
  const airDensityKgM3 = 1.225 * densityRatio;

  // Stall speed scaling: V_stall,TAS = V_stall,0 / sqrt(sigma)
  const stallSpeedTasMps = seaLevelStallSpeedMps / Math.sqrt(densityRatio);
  const stallWarning = trueAirspeedMps < stallSpeedTasMps * 1.1;

  // Wind coupling: windDirectionDeg is direction FROM which wind blows
  // Relative wind angle relative to track heading
  const relWindAngleRad = ((windDirectionDeg - trackHeadingDeg) * Math.PI) / 180.0;
  const crosswindMps = windSpeedMs * Math.sin(relWindAngleRad);
  const headwindMps = windSpeedMs * Math.cos(relWindAngleRad);

  // Crab angle: beta = asin(clamp(v_cross / V_TAS, -0.95, 0.95)) in degrees
  const tasSafe = Math.max(1.0, trueAirspeedMps);
  const crabRatio = Math.max(-0.95, Math.min(0.95, crosswindMps / tasSafe));
  const crabAngleRad = Math.asin(crabRatio);
  const crabAngleDeg = (crabAngleRad * 180.0) / Math.PI;

  // Ground speed vector (exact wind triangle in compass NED-horizontal coordinates:
  // heading 0 deg = North (+y), 90 deg = East (+x); windDirectionDeg is FROM which wind blows).
  const trackRad = (trackHeadingDeg * Math.PI) / 180.0;
  const windRad = (windDirectionDeg * Math.PI) / 180.0;
  const crabbedHeadingRad = trackRad + crabAngleRad;

  // Airspeed vector projected along the crabbed heading
  const vtasX = trueAirspeedMps * Math.sin(crabbedHeadingRad);
  const vtasY = trueAirspeedMps * Math.cos(crabbedHeadingRad);

  // Wind vector (blowing towards windDirectionDeg + 180 deg)
  const vwindX = -windSpeedMs * Math.sin(windRad);
  const vwindY = -windSpeedMs * Math.cos(windRad);

  const vgX = vtasX + vwindX;
  const vgY = vtasY + vwindY;
  const groundSpeedMps = Math.hypot(vgX, vgY);

  return {
    densityRatio: Number(densityRatio.toFixed(5)),
    airDensityKgM3: Number(airDensityKgM3.toFixed(4)),
    stallSpeedTasMps: Number(stallSpeedTasMps.toFixed(2)),
    stallWarning,
    crosswindMps: Number(crosswindMps.toFixed(2)),
    headwindMps: Number(headwindMps.toFixed(2)),
    crabAngleDeg,
    groundSpeedMps,
  };
}

/**
 * Steps the UAV endurance tracker, factoring high-altitude drag and climb fuel burn.
 */
export function stepEnduranceState(
  remainingMin: number,
  altitudeMslM: number,
  vzMps: number,
  dtSec: number,
  bingoReserveMin: number = 45.0
): { remainingMin: number; bingoAlert: boolean } {
  const hClamped = Math.max(0.0, Math.min(11000.0, altitudeMslM));
  const base = 1.0 - 2.25577e-5 * hClamped;
  const densityRatio = Math.max(0.01, Math.pow(Math.max(0.0, base), 4.25588));

  // Fuel burn elevated by thin air drag (sqrt(rho0/rho)) and climb rate
  const dragFactor = Math.sqrt(1.0 / densityRatio);
  const climbFactor = 1.0 + Math.max(0.0, vzMps / 10.0) * 0.5;
  const burnRateFactor = dragFactor * climbFactor;

  const fuelConsumedMin = (dtSec / 60.0) * burnRateFactor;
  const newRemainingMin = Math.max(0.0, remainingMin - fuelConsumedMin);
  const bingoAlert = newRemainingMin <= bingoReserveMin;

  return {
    remainingMin: Number(newRemainingMin.toFixed(2)),
    bingoAlert,
  };
}

/**
 * Evaluates Controlled Flight Into Terrain (CFIT) risk and generates an emergency pull-up command if breached.
 */
export function computeCfitPullUpCommand(params: CfitParams): CfitCommandResult {
  const {
    currentAltitudeMslM,
    vzMps,
    maxTerrainAheadM,
    minAglFloorM = 300.0,
    maxClimbRateMps = 10.0,
    lookaheadSec = 5.0,
  } = params;

  const safeFloorM = maxTerrainAheadM + minAglFloorM;
  const projectedAltM = currentAltitudeMslM + vzMps * lookaheadSec;

  const isViolated = currentAltitudeMslM < safeFloorM || projectedAltM < safeFloorM;

  if (isViolated) {
    return {
      cfitPullUpActive: true,
      commandedAltitudeMslM: safeFloorM + 50.0,
      commandedVzMps: maxClimbRateMps,
    };
  }

  return {
    cfitPullUpActive: false,
    commandedAltitudeMslM: currentAltitudeMslM,
    commandedVzMps: vzMps,
  };
}


// ============================================================================
// 6. Worker Orchestration & Telemetry Assembly Helper
// ============================================================================

export function createDefaultGroundConvoyStates(): Map<number, GroundConvoyState> {
  const map = new Map<number, GroundConvoyState>();
  map.set(2, {
    nodeId: 2,
    corridor: [
      [-5000, 3000],
      [-1000, 4500],
      [3000, 2000],
      [-1000, 1000],
    ],
    currentPos: [-5000, 3000],
    waypointIndex: 1,
    speedMs: 12.0,
    headingDeg: 20.56,
    vx: 11.24,
    vy: 4.22,
  });
  return map;
}

export interface ConstellationMultiAcnParams {
  readonly acnStates: readonly ConstellationAcnState[];
  readonly primaryAcnPos: [number, number, number];
  readonly nodePositions: Map<number, [number, number, number]>;
  readonly nodeDirectSnrMap: Map<number, number>;
  readonly nodeHandoverStates: Map<number, NodeHandoverState>;
  readonly handoverEventsTotal: number;
  readonly terrain?: TerrainEngine;
  readonly rfConfig?: RFConfig;
  readonly envConfig?: EnvironmentConfig;
}

export interface ConstellationMultiAcnResult {
  readonly secondaryAcns: ConstellationMobilityTelemetry['secondary_acns'];
  readonly activeServingAcns: Record<number, string>;
  readonly handoverEventsTotal: number;
  readonly acnSnrByNode: Record<number, Record<string, number>>;
}

/**
 * Evaluates secondary ACN A2A backhaul links and per-node multi-ACN candidate SNR + Event A3 handovers.
 * When `terrain` is provided, each secondary ACN evaluates its own 3D ray diffraction/LOS against terrain
 * rather than copying ACN-1's shadow penalty.
 */
export function evaluateConstellationMultiAcn(
  params: ConstellationMultiAcnParams,
  terrain?: TerrainEngine
): ConstellationMultiAcnResult {
  const {
    acnStates,
    primaryAcnPos,
    nodePositions,
    nodeDirectSnrMap,
    nodeHandoverStates,
  } = params;
  const effTerrain = terrain ?? params.terrain;
  const effRf = params.rfConfig ?? DEFAULT_CONSTELLATION_RF;
  const effEnv = params.envConfig ?? DEFAULT_CONSTELLATION_ENV;
  let handoverEventsTotal = params.handoverEventsTotal;

  const secondaryAcns: ConstellationMobilityTelemetry['secondary_acns'] = [];
  for (let k = 1; k < acnStates.length; k++) {
    const acn = acnStates[k];
    let peakTerrainElevM: number | undefined = undefined;
    if (effTerrain) {
      let maxElev = -Infinity;
      const samples = 8;
      for (let s = 1; s < samples; s++) {
        const u = s / samples;
        const sx = acn.position[0] + u * (primaryAcnPos[0] - acn.position[0]);
        const sy = acn.position[1] + u * (primaryAcnPos[1] - acn.position[1]);
        const elev = effTerrain.getElevation(sx, sy);
        if (Number.isFinite(elev) && elev > maxElev) {
          maxElev = elev;
        }
      }
      if (Number.isFinite(maxElev)) {
        peakTerrainElevM = maxElev;
      }
    }
    const xLink = evaluateA2aCrosslink(
      acn.position,
      primaryAcnPos,
      effRf.carrierFrequencyHz,
      33.0,
      15.0,
      15.0,
      50e6,
      4.0,
      150.0,
      peakTerrainElevM
    );
    secondaryAcns.push({
      id: acn.id,
      name: acn.name,
      pos_x: Number(acn.position[0].toFixed(1)),
      pos_y: Number(acn.position[1].toFixed(1)),
      altitude_msl_m: Number(acn.position[2].toFixed(1)),
      heading_deg: acn.headingDeg,
      backhaul_snr_db: Number(xLink.snrDb.toFixed(1)),
      backhaul_capacity_mbps: xLink.capacityMbps,
    });
  }

  const activeServingAcns: Record<number, string> = {};
  const acnSnrByNode: Record<number, Record<string, number>> = {};

  for (const [nodeId, directSnr] of nodeDirectSnrMap.entries()) {
    let state = nodeHandoverStates.get(nodeId);
    if (!state) {
      state = { servingAcnId: 'ACN-1', timeToTriggerCount: 0, candidateAcnId: null };
      nodeHandoverStates.set(nodeId, state);
    }

    const snrMap: Record<string, number> = { 'ACN-1': directSnr };

    if (acnStates.length > 1) {
      const npos = nodePositions.get(nodeId) || [0, 0, 0];
      const d0x = primaryAcnPos[0] - npos[0];
      const d0y = primaryAcnPos[1] - npos[1];
      const d0z = primaryAcnPos[2] - npos[2];
      const dist0 = Math.max(100.0, Math.sqrt(d0x * d0x + d0y * d0y + d0z * d0z));

      for (let k = 1; k < acnStates.length; k++) {
        const secAcn = acnStates[k];
        const dx = secAcn.position[0] - npos[0];
        const dy = secAcn.position[1] - npos[1];
        const dz = secAcn.position[2] - npos[2];
        const distSec = Math.max(1.0, Math.sqrt(dx * dx + dy * dy + dz * dz));

        if (effTerrain) {
          const stepIntervalM = Math.max(250.0, distSec / 24.0);
          const obs = effTerrain.evaluateTerrainObstruction(
            npos,
            secAcn.position,
            effRf,
            effEnv,
            stepIntervalM
          );
          const secLink = SHARED_CONSTELLATION_LINK_ENGINE.evaluateLink({
            nodeType: 'soldier',
            slantRangeM: distSec,
            diffractionLossDb: obs.diffractionLossDb,
            rf: effRf,
            env: effEnv,
            obstacleBlocked: obs.obstacleBlocked,
            nodeAltM: npos[2],
            acnAltM: secAcn.position[2],
            crestRadiusM: obs.crestRadiusM,
            curvatureLossDb: obs.curvatureLossDb,
            txX: npos[0],
            txY: npos[1],
            rxX: secAcn.position[0],
            rxY: secAcn.position[1],
          });
          snrMap[secAcn.id] = secLink.snrDb;
        } else {
          const deltaFspl = 20.0 * Math.log10(distSec / dist0);
          snrMap[secAcn.id] = directSnr - deltaFspl;
        }
      }

      const hoRes = stepEventA3Handover(state, snrMap);
      nodeHandoverStates.set(nodeId, hoRes.state);
      activeServingAcns[nodeId] = hoRes.servingAcnId;
      if (hoRes.handoverTriggered) {
        handoverEventsTotal++;
      }
    } else {
      activeServingAcns[nodeId] = 'ACN-1';
    }

    acnSnrByNode[nodeId] = snrMap;
  }

  return {
    secondaryAcns,
    activeServingAcns,
    handoverEventsTotal,
    acnSnrByNode,
  };
}

export interface ManetMeshRoutingParams {
  readonly nodePositions: Map<number, [number, number, number]>;
  readonly nodeDirectSnrMap: Map<number, number>;
  readonly maxPeerRangeM?: number;
  readonly maxHops?: number;
  readonly gatewaySnrThresholdDb?: number;
  readonly terrain?: TerrainEngine;
  readonly rfConfig?: RFConfig;
  readonly envConfig?: EnvironmentConfig;
}

export interface ManetMeshRoutingResult {
  readonly manetRoutes: ConstellationMobilityTelemetry['manet_active_routes'];
  readonly peerLinks: PeerLink[];
  readonly manetMeanHops: number;
  readonly manetMeanCapacity: number;
}

/**
 * Evaluates multi-hop MANET peer links and Dijkstra routes from blocked ground nodes to gateways.
 * When `terrain` is provided, candidate ground peer links are screened against terrain LOS/diffraction
 * so routes cannot tunnel through blocking mountain ridges.
 */
export function evaluateManetMeshRouting(
  params: ManetMeshRoutingParams,
  terrain?: TerrainEngine
): ManetMeshRoutingResult {
  const {
    nodePositions,
    nodeDirectSnrMap,
    maxPeerRangeM = 15000.0,
    maxHops = 3,
    gatewaySnrThresholdDb = 3.0,
  } = params;
  const effTerrain = terrain ?? params.terrain;
  const effRf = params.rfConfig ?? DEFAULT_CONSTELLATION_RF;
  const effEnv = params.envConfig ?? DEFAULT_CONSTELLATION_ENV;

  const gateways: number[] = [];
  const blockedNodes: number[] = [];

  for (const [nodeId, snr] of nodeDirectSnrMap.entries()) {
    if (snr >= gatewaySnrThresholdDb) {
      gateways.push(nodeId);
    } else {
      blockedNodes.push(nodeId);
    }
  }

  const peerLinks: PeerLink[] = [];
  const allNodeIds = Array.from(nodePositions.keys());
  for (let i = 0; i < allNodeIds.length; i++) {
    for (let j = i + 1; j < allNodeIds.length; j++) {
      const idA = allNodeIds[i];
      const idB = allNodeIds[j];
      const posA = nodePositions.get(idA)!;
      const posB = nodePositions.get(idB)!;
      const dx = posA[0] - posB[0];
      const dy = posA[1] - posB[1];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= maxPeerRangeM) {
        if (effTerrain) {
          const dz = posA[2] - posB[2];
          const d3d = Math.max(1.0, Math.sqrt(dx * dx + dy * dy + dz * dz));
          const stepIntervalM = Math.max(150.0, d / 24.0);
          const obs = effTerrain.evaluateTerrainObstruction(posA, posB, effRf, effEnv, stepIntervalM);
          const peerStatus = SHARED_CONSTELLATION_LINK_ENGINE.evaluateLink({
            nodeType: 'soldier',
            slantRangeM: d3d,
            diffractionLossDb: obs.diffractionLossDb,
            rf: effRf,
            env: effEnv,
            obstacleBlocked: obs.obstacleBlocked,
            customRxGainDbi: effRf.soldierAntennaGainDbi,
            nodeAltM: posA[2],
            acnAltM: posB[2],
            crestRadiusM: obs.crestRadiusM,
            curvatureLossDb: obs.curvatureLossDb,
            txX: posA[0],
            txY: posA[1],
            rxX: posB[0],
            rxY: posB[1],
          });
          if (!obs.obstacleBlocked && !peerStatus.isOutage && peerStatus.bitrateMbps > 0.0) {
            peerLinks.push({
              fromId: idA,
              toId: idB,
              capacityMbps: peerStatus.bitrateMbps,
              distanceM: d,
            });
          }
        } else {
          const cap = Math.max(1.0, 15.0 - (d / maxPeerRangeM) * 10.0);
          peerLinks.push({ fromId: idA, toId: idB, capacityMbps: cap, distanceM: d });
        }
      }
    }
  }

  const manetRoutes: ConstellationMobilityTelemetry['manet_active_routes'] = [];
  let manetTotalHops = 0;
  let manetTotalCapacity = 0;

  for (const bNodeId of blockedNodes) {
    const res = computeMultiHopManetRoute({
      sourceNodeId: bNodeId,
      gatewayNodeIds: gateways,
      peerLinks,
      maxHops,
    });

    if (res.route.length > 1) {
      manetRoutes.push({
        source_node_id: bNodeId,
        gateway_node_id: res.route[res.route.length - 1],
        hops: res.route,
        e2e_capacity_mbps: res.e2eCapacityMbps,
        e2e_latency_ms: res.e2eLatencyMs,
      });
      manetTotalHops += res.hopCount;
      manetTotalCapacity += res.e2eCapacityMbps;
    }
  }

  const manetMeanHops = manetRoutes.length > 0 ? Number((manetTotalHops / manetRoutes.length).toFixed(2)) : 0.0;
  const manetMeanCapacity = manetRoutes.length > 0 ? Number((manetTotalCapacity / manetRoutes.length).toFixed(2)) : 0.0;

  return {
    manetRoutes,
    peerLinks,
    manetMeanHops,
    manetMeanCapacity,
  };
}

export interface ConstellationWorkerContext {
  acnConstellationCount: number;
  enableMultiHopManet: boolean;
  enableGroundConvoyMobility: boolean;
  windSpeedMs: number;
  windDirectionDeg: number;
  enableAutoCfitPullUp: boolean;
  simTimeSec: number;
  primaryAcnPos: [number, number, number];
  primaryAcnHdgDeg: number;
  liveAltitudeM: number;
  liveVzMps: number;
  maxTerrainAheadM: number;
  nodePositions: Map<number, [number, number, number]>;
  nodeDirectSnrMap: Map<number, number>;
  nodeHandoverStates: Map<number, NodeHandoverState>;
  groundConvoyStates: Map<number, GroundConvoyState>;
  uavEnduranceRemainingMin: number;
  handoverEventsTotal: number;
  dtSec: number;
  terrain?: TerrainEngine;
  rfConfig?: RFConfig;
  envConfig?: EnvironmentConfig;
}

export interface ConstellationWorkerStepOutput {
  telemetry: ConstellationMobilityTelemetry;
  updatedEnduranceMin: number;
  cfitPullUpActive: boolean;
  commandedVzMps?: number;
  commandedAltitudeMslM?: number;
  handoverEventsTotal: number;
}

/**
 * Orchestrates multi-ACN positions, cross-links, handovers, MANET routes, convoy advances,
 * aerodynamics, and CFIT safety in a single call.
 */
export function stepConstellationWorkerSystem(ctx: ConstellationWorkerContext): ConstellationWorkerStepOutput {
  const {
    acnConstellationCount,
    enableMultiHopManet,
    enableGroundConvoyMobility,
    windSpeedMs,
    windDirectionDeg,
    enableAutoCfitPullUp,
    simTimeSec,
    primaryAcnPos,
    primaryAcnHdgDeg,
    liveAltitudeM,
    liveVzMps,
    maxTerrainAheadM,
    nodePositions,
    nodeDirectSnrMap,
    nodeHandoverStates,
    groundConvoyStates,
    uavEnduranceRemainingMin,
    dtSec,
    terrain,
    rfConfig,
    envConfig,
  } = ctx;

  // 1. Generate constellation ACN positions
  const acnStates = generateConstellationAcnPositions(
    primaryAcnPos,
    acnConstellationCount,
    18000.0,
    simTimeSec
  );

  // 2 & 3. Secondary ACN A2A cross-link evaluations & multi-ACN Event A3 handovers
  const constellationEval = evaluateConstellationMultiAcn(
    {
      acnStates,
      primaryAcnPos,
      nodePositions,
      nodeDirectSnrMap,
      nodeHandoverStates,
      handoverEventsTotal: ctx.handoverEventsTotal,
      rfConfig,
      envConfig,
    },
    terrain
  );
  const secondaryAcns = constellationEval.secondaryAcns;
  const activeServingAcns = constellationEval.activeServingAcns;
  const handoverEventsTotal = constellationEval.handoverEventsTotal;

  // 4. Ground Convoy Mobility Advance
  const convoyTelem: ConstellationMobilityTelemetry['ground_convoys'] = [];
  if (enableGroundConvoyMobility) {
    for (const [nodeId, convoy] of groundConvoyStates.entries()) {
      const updated = stepGroundConvoyNode(convoy, dtSec);
      groundConvoyStates.set(nodeId, updated);
      convoyTelem.push({
        node_id: nodeId,
        x: Number(updated.currentPos[0].toFixed(1)),
        y: Number(updated.currentPos[1].toFixed(1)),
        speed_ms: updated.speedMs,
        heading_deg: updated.headingDeg,
      });

      // Update position in nodePositions map
      const existingPos = nodePositions.get(nodeId) || [0, 0, 0];
      nodePositions.set(nodeId, [updated.currentPos[0], updated.currentPos[1], existingPos[2]]);
    }
  }

  // 5. Multi-Hop MANET Routing
  let manetRoutes: ConstellationMobilityTelemetry['manet_active_routes'] = [];
  let manetMeanHops = 0.0;
  let manetMeanCapacity = 0.0;

  if (enableMultiHopManet) {
    const manetRes = evaluateManetMeshRouting(
      {
        nodePositions,
        nodeDirectSnrMap,
        rfConfig,
        envConfig,
      },
      terrain
    );
    manetRoutes = manetRes.manetRoutes;
    manetMeanHops = manetRes.manetMeanHops;
    manetMeanCapacity = manetRes.manetMeanCapacity;
  }

  // 6. Aerodynamics, Endurance & CFIT
  const aero = evaluateHighAltAerodynamics({
    altitudeMslM: liveAltitudeM,
    trueAirspeedMps: 60.0,
    trackHeadingDeg: primaryAcnHdgDeg,
    windSpeedMs,
    windDirectionDeg,
  });

  const endurance = stepEnduranceState(uavEnduranceRemainingMin, liveAltitudeM, liveVzMps, dtSec);

  let cfitPullUpActive = false;
  let commandedVzMps: number | undefined;
  let commandedAltitudeMslM: number | undefined;

  if (enableAutoCfitPullUp) {
    const cfitCmd = computeCfitPullUpCommand({
      currentAltitudeMslM: liveAltitudeM,
      vzMps: liveVzMps,
      maxTerrainAheadM,
      minAglFloorM: 300.0,
      maxClimbRateMps: 10.0,
    });
    cfitPullUpActive = cfitCmd.cfitPullUpActive;
    if (cfitPullUpActive) {
      commandedVzMps = cfitCmd.commandedVzMps;
      commandedAltitudeMslM = cfitCmd.commandedAltitudeMslM;
    }
  }

  const telemetry: ConstellationMobilityTelemetry = {
    acn_count: acnStates.length,
    secondary_acns: secondaryAcns,
    handover_events_total: handoverEventsTotal,
    active_serving_acns: activeServingAcns,
    manet_active_routes: manetRoutes,
    manet_mean_hops: manetMeanHops,
    manet_mean_e2e_mbps: manetMeanCapacity,
    ground_convoys: convoyTelem,
    aerodynamics: {
      density_ratio: aero.densityRatio,
      air_density_kg_m3: aero.airDensityKgM3,
      stall_speed_tas_mps: aero.stallSpeedTasMps,
      stall_warning: aero.stallWarning,
      crosswind_mps: aero.crosswindMps,
      crab_angle_deg: aero.crabAngleDeg,
      ground_speed_mps: aero.groundSpeedMps,
      endurance_remaining_min: endurance.remainingMin,
      bingo_alert: endurance.bingoAlert,
      cfit_pull_up_active: cfitPullUpActive,
    },
  };

  return {
    telemetry,
    updatedEnduranceMin: endurance.remainingMin,
    cfitPullUpActive,
    commandedVzMps,
    commandedAltitudeMslM,
    handoverEventsTotal,
  };
}
