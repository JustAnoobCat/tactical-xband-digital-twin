/**
 * src/worker/aiCopilotCoordinator.ts
 *
 * Dedicated Edge-AI Co-Pilot Coordinator for Background Web Worker.
 *
 * Encapsulates the 5 Tactical Edge-AI Pillars:
 * 1. AI Buddy-Relay Peer-to-Peer Squad Mesh & Harmonic Capacity Routing
 * 2. EW Defilade Terrain-Shield Analysis
 * 3. Sky-Shepherd UAV Loiter Orbit Kinematics (80 m/s horiz, 25 m/s vert)
 * 4. LPI/LPD Dynamic RF Stealth Transmit Power Optimization
 * 5. 15-Second Blackout Countdown Predictive Orbit Forecaster
 *
 * In addition to Multi-Waypoint Tobler Biomechanics Movement Stepping.
 *
 * Specification: docs/specs/SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md
 */

import {
  evaluateAiBuddyRelayRescue,
  computeAiLpiStealthPower,
  predictNodeBlackoutCountdown,
  computeAiSkyShepherdUavOffset,
  computeToblerWalkingSpeedMs,
  EdgeAiQTable,
  type AiBuddyRelayResult,
  type AiLpiStealthResult,
  type AiBlackoutForecastResult,
  type AiSkyShepherdResult,
  type SquadNodeForBuddyEval,
  type AiNodeRecoveryRecommendation,
} from '../core/tacticalAiPathfinder';
import { LinkBudgetEngine, type LinkStatus } from '../core/linkBudget';
import type { Position3D } from '../shared/types';

export type AiBlackoutForecast = AiBlackoutForecastResult;
export type AiMovementDirective = AiNodeRecoveryRecommendation;

export interface ActiveAiMovement {
  targetPos: Position3D;
  speedMs: number;
  moveBearingDeg: number;
  waypoints?: readonly Position3D[];
  waypointIndex?: number;
}

export interface AiMovableGroundNode {
  nodeId: number;
  position: Position3D;
  aglM: number;
  nodeType: string;
}

export class EdgeAiCopilotCoordinator {
  // Pillar 1: AI Buddy-Relay Peer-to-Peer Squad Mesh
  public aiBuddyMeshEnabled: boolean = false;
  public readonly aiBuddyRelayResults: Map<number, AiBuddyRelayResult> = new Map();

  // Pillar 3: Sky-Shepherd UAV Loiter Shift & Physical Slew Kinematics
  public aiSkyShepherdActive: boolean = false;
  public aiSkyShepherdNodeId: number | null = null;
  public aiSkyShepherdDirective: string = '';
  public skyShepherdCurrentOffset: [number, number, number] = [0, 0, 0];
  public skyShepherdTargetOffset: [number, number, number] = [0, 0, 0];

  // Pillar 4: LPI/LPD Dynamic Power Controller
  public aiLpiStealthEnabled: boolean = false;
  public readonly aiLpiStealthResults: Map<number, AiLpiStealthResult> = new Map();

  // Pillar 5: 15-Second Blackout Countdown Forecaster
  public readonly aiBlackoutForecasts: Map<number, AiBlackoutForecastResult> = new Map();

  // Pinned units & Repositioning
  public readonly aiPinnedNodes: Set<number> = new Set();
  public readonly aiActiveMovements: Map<number, ActiveAiMovement> = new Map();
  public readonly aiActiveMovingNodes: Set<number> = new Set();
  public readonly aiRecommendations: Map<number, AiNodeRecoveryRecommendation> = new Map();
  public readonly aiLastEvalTick: Map<number, number> = new Map();

  /**
   * Resets all Edge-AI states to factory baseline.
   */
  public reset(): void {
    this.aiBuddyMeshEnabled = false;
    this.aiBuddyRelayResults.clear();

    this.aiSkyShepherdActive = false;
    this.aiSkyShepherdNodeId = null;
    this.aiSkyShepherdDirective = '';
    this.skyShepherdCurrentOffset = [0, 0, 0];
    this.skyShepherdTargetOffset = [0, 0, 0];

    this.aiLpiStealthEnabled = false;
    this.aiLpiStealthResults.clear();

    this.aiBlackoutForecasts.clear();
    this.aiPinnedNodes.clear();
    this.aiActiveMovements.clear();
    this.aiActiveMovingNodes.clear();
    this.aiRecommendations.clear();
    this.aiLastEvalTick.clear();
  }

  /**
   * Calculates smooth, rate-limited physical slew kinematics for the Sky-Shepherd UAV offset.
   * Rates: 80 m/s horizontal, 25 m/s vertical climb/dive.
   *
   * @param dtS Delta time in seconds (e.g., 0.02s for 50 Hz)
   * @returns Updated current offset [x, y, z]
   */
  public stepSkyShepherdSlew(dtS: number): [number, number, number] {
    const targetShepherdOffset = (this.aiSkyShepherdActive && this.aiSkyShepherdNodeId !== null)
      ? this.skyShepherdTargetOffset
      : [0, 0, 0];

    const dxShep = targetShepherdOffset[0] - this.skyShepherdCurrentOffset[0];
    const dyShep = targetShepherdOffset[1] - this.skyShepherdCurrentOffset[1];
    const dzShep = targetShepherdOffset[2] - this.skyShepherdCurrentOffset[2];
    const horizDistShep = Math.hypot(dxShep, dyShep);
    const maxHorizStep = 80.0 * dtS; // 1.6 m per 20 ms
    const maxVertStep = 25.0 * dtS;  // 0.5 m per 20 ms

    if (horizDistShep <= maxHorizStep) {
      this.skyShepherdCurrentOffset[0] = targetShepherdOffset[0];
      this.skyShepherdCurrentOffset[1] = targetShepherdOffset[1];
    } else {
      const uX = dxShep / horizDistShep;
      const uY = dyShep / horizDistShep;
      this.skyShepherdCurrentOffset[0] += uX * maxHorizStep;
      this.skyShepherdCurrentOffset[1] += uY * maxHorizStep;
    }
    this.skyShepherdCurrentOffset[2] += Math.max(-maxVertStep, Math.min(maxVertStep, dzShep));

    return [
      this.skyShepherdCurrentOffset[0],
      this.skyShepherdCurrentOffset[1],
      this.skyShepherdCurrentOffset[2],
    ];
  }

  /**
   * Steps all active autonomous ground node repositioning movements along multi-waypoint paths
   * with Tobler biomechanical speed scaling.
   *
   * @param dtS Step duration in seconds (0.02s at 50 Hz)
   * @param getElevationAt Function evaluating DEM ground elevation in metres
   * @param nodesStatic Static node roster
   * @param nodesTac Tactical node roster
   * @param nodesReactive Optional reactive node roster
   * @param nodeRegistry Optional spatial node registry
   * @param linkStatuses Optional live link statuses for Q-table updates
   * @param aiQTable Optional Edge-AI Q-table
   * @returns true if any node moved this step
   */
  public stepActiveAiNodeMoves(
    dtS: number,
    getElevationAt: (x: number, y: number) => number,
    nodesStatic: AiMovableGroundNode[],
    nodesTac: AiMovableGroundNode[],
    nodesReactive?: AiMovableGroundNode[],
    nodeRegistry?: { updateSpatial: (id: number, x: number, y: number) => void },
    linkStatuses?: Map<number, LinkStatus>,
    aiQTable?: EdgeAiQTable
  ): boolean {
    if (this.aiActiveMovements.size === 0) return false;

    let movedAny = false;
    for (const [nid, move] of Array.from(this.aiActiveMovements.entries())) {
      const staticNode = nodesStatic.find(n => n.nodeId === nid);
      const tacNode = nodesTac.find(n => n.nodeId === nid);
      const reactiveNode = nodesReactive?.find(n => n.nodeId === nid);

      if (!staticNode || !tacNode) {
        this.aiActiveMovements.delete(nid);
        this.aiActiveMovingNodes.delete(nid);
        continue;
      }

      const curX = staticNode.position[0];
      const curY = staticNode.position[1];

      // Multi-waypoint traversal: identify current target waypoint in the polyline
      const waypoints = move.waypoints;
      const wpIdx = move.waypointIndex ?? 1;
      const isMultiWp = Boolean(waypoints && waypoints.length > 1 && wpIdx < waypoints.length);
      const nextWp = isMultiWp && waypoints ? waypoints[wpIdx] : move.targetPos;

      const tx = nextWp[0];
      const ty = nextWp[1];
      const distRem = Math.hypot(tx - curX, ty - curY);
      const stepDist = move.speedMs * dtS;

      if (distRem <= stepDist || distRem <= 2.0) {
        // Reached intermediate or final waypoint
        const newElev = getElevationAt(tx, ty);
        staticNode.position = [tx, ty, newElev + staticNode.aglM];
        tacNode.position = [tx, ty, newElev + tacNode.aglM];
        if (reactiveNode) reactiveNode.position = [tx, ty, newElev + reactiveNode.aglM];
        if (nodeRegistry) nodeRegistry.updateSpatial(nid, tx, ty);

        if (isMultiWp && waypoints && wpIdx < waypoints.length - 1) {
          // Advance to next leg in polyline path
          move.waypointIndex = wpIdx + 1;
          const nextTarget = waypoints[move.waypointIndex];
          const legDist = Math.hypot(nextTarget[0] - tx, nextTarget[1] - ty);
          const legDeltaZ = nextTarget[2] - newElev;
          const tobler = computeToblerWalkingSpeedMs(legDist, legDeltaZ, staticNode.nodeType);
          move.speedMs = Math.max(0.5, tobler.speedMs);
          move.moveBearingDeg = ((Math.atan2(nextTarget[0] - tx, nextTarget[1] - ty) * 180.0) / Math.PI + 360.0) % 360.0;
          movedAny = true;
        } else {
          // Reached final destination recovery waypoint!
          this.aiActiveMovements.delete(nid);
          this.aiActiveMovingNodes.delete(nid);

          // Update Q-table with the restored link SINR if available
          if (linkStatuses && aiQTable) {
            const restoredLs = linkStatuses.get(nid);
            const restoredSinr = restoredLs?.sinrDb ?? restoredLs?.snrDb ?? 15.0;
            const sectorIdx = aiQTable.getSectorIndex(move.moveBearingDeg);
            aiQTable.updateQValue(nid, sectorIdx, restoredSinr);
          }

          this.aiRecommendations.delete(nid);
          this.aiLastEvalTick.delete(nid);
          movedAny = true;
        }
      } else {
        const ux = (tx - curX) / distRem;
        const uy = (ty - curY) / distRem;
        const newX = curX + ux * stepDist;
        const newY = curY + uy * stepDist;
        const newElev = getElevationAt(newX, newY);
        staticNode.position = [newX, newY, newElev + staticNode.aglM];
        tacNode.position = [newX, newY, newElev + tacNode.aglM];
        if (reactiveNode) reactiveNode.position = [newX, newY, newElev + reactiveNode.aglM];
        if (nodeRegistry) nodeRegistry.updateSpatial(nid, newX, newY);
        movedAny = true;
      }
    }

    return movedAny;
  }

  /**
   * Computes the remaining travel distance along the current path for an active movement.
   */
  public getActiveRepositionDistRemaining(nodeId: number, currentPos: Position3D): number | null {
    const move = this.aiActiveMovements.get(nodeId);
    if (!move) return null;

    if (move.waypoints && move.waypoints.length > 1 && typeof move.waypointIndex === 'number') {
      const curX = currentPos[0];
      const curY = currentPos[1];
      const nextWp = move.waypoints[move.waypointIndex] ?? move.targetPos;
      let totalRem = Math.hypot(nextWp[0] - curX, nextWp[1] - curY);
      for (let i = move.waypointIndex; i < move.waypoints.length - 1; i++) {
        const pA = move.waypoints[i];
        const pB = move.waypoints[i + 1];
        totalRem += Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
      }
      return totalRem;
    }

    return Math.hypot(move.targetPos[0] - currentPos[0], move.targetPos[1] - currentPos[1]);
  }

  /**
   * Evaluates Pillar 1: AI Buddy-Relay Peer-to-Peer Rescue.
   */
  public evaluateBuddyRelay(
    targetNode: {
      nodeId: number;
      position: Position3D;
      isOutage: boolean;
      directBitrateMbps: number;
      directSinrDb: number;
    },
    squadCandidates: SquadNodeForBuddyEval[],
    getElevationAt: (x: number, y: number) => number,
    carrierFrequencyHz: number,
    channelBandwidthHz: number = 5.0e6
  ): AiBuddyRelayResult {
    return evaluateAiBuddyRelayRescue(
      targetNode,
      squadCandidates,
      getElevationAt,
      carrierFrequencyHz,
      channelBandwidthHz
    );
  }

  /**
   * Evaluates Pillar 4: LPI/LPD Dynamic Power Throttling.
   * Preserves a +2.5 dB fade margin above the active MODCOD threshold (floored at targetSinrDb).
   */
  public evaluateLpiStealth(
    nominalTxPowerDbm: number,
    currentSinrDb: number,
    isOutage: boolean,
    targetSinrDb: number = 18.5,
    activeModcodMinSnrDb?: number
  ): AiLpiStealthResult {
    const resolvedModcodMinSnrDb =
      activeModcodMinSnrDb !== undefined && Number.isFinite(activeModcodMinSnrDb)
        ? activeModcodMinSnrDb
        : LinkBudgetEngine.selectModCod(currentSinrDb).minSnrDb;
    const effectiveTargetDb = Number.isFinite(resolvedModcodMinSnrDb)
      ? Math.max(targetSinrDb, resolvedModcodMinSnrDb + 2.5)
      : targetSinrDb;
    return computeAiLpiStealthPower(
      nominalTxPowerDbm,
      currentSinrDb,
      isOutage,
      effectiveTargetDb
    );
  }

  /**
   * Evaluates Pillar 5: 15-Second Blackout Countdown Forecast.
   */
  public evaluateBlackoutCountdown(
    nodePosition: Position3D,
    sinrDb: number,
    isOutage: boolean,
    getAcnPosAtDt: (dtS: number) => Position3D,
    getElevationAt: (x: number, y: number) => number,
    simTimeS: number,
    carrierFrequencyHz: number,
    channelBandwidthHz: number = 5.0e6
  ): AiBlackoutForecastResult {
    return predictNodeBlackoutCountdown(
      nodePosition,
      sinrDb,
      isOutage,
      getAcnPosAtDt,
      getElevationAt,
      simTimeS,
      carrierFrequencyHz,
      channelBandwidthHz
    );
  }

  /**
   * Evaluates Pillar 3: Sky-Shepherd UAV Loiter Orbit Shift for Pinned Units.
   */
  public evaluateSkyShepherd(
    pinnedNodePos: Position3D,
    acnCenterPos: Position3D,
    getElevationAt: (x: number, y: number) => number,
    carrierFrequencyHz: number,
    channelBandwidthHz: number = 5.0e6
  ): AiSkyShepherdResult {
    return computeAiSkyShepherdUavOffset(
      pinnedNodePos,
      acnCenterPos,
      getElevationAt,
      carrierFrequencyHz,
      channelBandwidthHz
    );
  }
}
