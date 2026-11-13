/**
 * src/worker/nodeLifecycleManager.ts
 *
 * Phase 2D: Ground Node Lifecycle Manager
 *
 * Encapsulates:
 * 1. Initial node subsystem creation (`initNodes`).
 * 2. Canonical twin-node construction (`createNodePair`).
 * 3. Ground-node altitude resampling (`resampleGroundNodeAltitudes`).
 * 4. Input validation for dynamic node operations.
 * 5. Dynamic node addition: validation, entity creation, twin subsystem instantiation, and registration lifecycle.
 * 6. Dynamic node duplication: validation, entity creation, twin subsystem instantiation, and registration lifecycle.
 * 7. Dynamic node updates: validation, spatial derivation, property mutation, and registry synchronization.
 * 8. Dynamic node deletion: validation, entity unregistration, and registration lifecycle removal.
 *
 * Note: SimulationWorkerManager retains ownership of twin arrays, active schedulers, transfer manager,
 * RF caches, selection state, and simulation timing.
 */

import {
  GroundNodeEntity,
  NodeRegistry,
} from '../core/nodeRegistry';
import { NodeType } from '../core/config';
import {
  THEATER_HALF_M,
  MIN_GROUND_AGL_M,
  MAX_GROUND_AGL_M,
  DEFAULT_ANTENNA_AGL_M,
  MAX_ACTIVE_GROUND_NODES,
} from '../shared/constants';
export {
  MIN_GROUND_AGL_M,
  MAX_GROUND_AGL_M,
  DEFAULT_ANTENNA_AGL_M,
  MAX_ACTIVE_GROUND_NODES,
};
import { TerrainEngine } from '../core/terrain';
import { GroundNodeTrafficSubsystem } from '../core/queues';
import { RegistrationLifecycle } from '../core/registration';
import { isFiniteNumber } from '../shared/utils';
export { isFiniteNumber };
import type {
  WorkerInboundCommand,
} from '../shared/workerProtocol';

export interface AddNodeParams {
  msg: Extract<WorkerInboundCommand, { type: 'NODE_ADD' }>;
  nodeRegistry: NodeRegistry;
  registrationLifecycle: RegistrationLifecycle;
  terrainEngine: TerrainEngine;
  simTimeS: number;
  spatialLocked: boolean;
}

export interface AddNodeOutcome {
  accepted: boolean;
  reason?: string;
  entity?: GroundNodeEntity;
  nodePair?: [GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem];
}

export interface DeleteNodeParams {
  msg: Extract<WorkerInboundCommand, { type: 'NODE_DELETE' }>;
  nodeRegistry: NodeRegistry;
  registrationLifecycle: RegistrationLifecycle;
  simTimeS: number;
  spatialLocked: boolean;
}

export interface DeleteNodeOutcome {
  accepted: boolean;
  reason?: string;
  deletedNodeId?: number;
}

export interface DuplicateNodeParams {
  msg: Extract<WorkerInboundCommand, { type: 'NODE_DUPLICATE' }>;
  nodeRegistry: NodeRegistry;
  registrationLifecycle: RegistrationLifecycle;
  terrainEngine: TerrainEngine;
  simTimeS: number;
  spatialLocked: boolean;
}

export interface DuplicateNodeOutcome {
  accepted: boolean;
  reason?: string;
  entity?: GroundNodeEntity;
  sourceNodeId?: number;
  nodePair?: [GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem];
}

export interface UpdateNodeParams {
  msg: Extract<WorkerInboundCommand, { type: 'NODE_UPDATE' }>;
  nodesStatic: GroundNodeTrafficSubsystem[];
  nodesTac: GroundNodeTrafficSubsystem[];
  nodesReactive?: GroundNodeTrafficSubsystem[];
  nodeRegistry: NodeRegistry;
  terrainEngine: TerrainEngine;
  spatialLocked: boolean;
}

export interface UpdateNodeOutcome {
  accepted: boolean;
  reason?: string;
  nodeId?: number;
  spatialChanged?: boolean;
}

export class NodeLifecycleManager {
  /**
   * Constructs an identical pair of [staticNode, tacNode] from an authoritative entity record.
   */
  public static createNodePair(
    entity: GroundNodeEntity,
    terrainEngine: TerrainEngine
  ): [GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem, GroundNodeTrafficSubsystem] {
    const nid = entity.identity.nodeId;
    const [x, y] = entity.position;
    const terrainMsl = terrainEngine.getElevation(x, y);
    const z = terrainMsl + entity.aglM;

    const staticNode = new GroundNodeTrafficSubsystem(
      nid,
      entity.identity.role,
      [x, y, z],
      entity.seed,
      entity.trafficOptions,
      entity.identity
    );
    const tacNode = new GroundNodeTrafficSubsystem(
      nid,
      entity.identity.role,
      [x, y, z],
      entity.seed,
      entity.trafficOptions,
      entity.identity
    );
    const reactiveNode = new GroundNodeTrafficSubsystem(
      nid,
      entity.identity.role,
      [x, y, z],
      entity.seed,
      entity.trafficOptions,
      entity.identity
    );

    staticNode.aglM = entity.aglM;
    tacNode.aglM = entity.aglM;
    reactiveNode.aglM = entity.aglM;
    staticNode.txPowerDbm = entity.txPowerDbm;
    tacNode.txPowerDbm = entity.txPowerDbm;
    reactiveNode.txPowerDbm = entity.txPowerDbm;

    const defaultCapacity = entity.identity.role === 'mcp' ? 20000 : 5000;
    staticNode.batteryCapacityMah = entity.batteryCapacityMah ?? defaultCapacity;
    tacNode.batteryCapacityMah = entity.batteryCapacityMah ?? defaultCapacity;
    reactiveNode.batteryCapacityMah = entity.batteryCapacityMah ?? defaultCapacity;

    const batteryLevel = entity.batteryLevelPct ?? 100.0;
    staticNode.batteryLevelPct = batteryLevel;
    tacNode.batteryLevelPct = batteryLevel;
    reactiveNode.batteryLevelPct = batteryLevel;

    const priority = entity.tacticalPriority ?? 1.0;
    staticNode.tacticalPriority = priority;
    tacNode.tacticalPriority = priority;
    reactiveNode.tacticalPriority = priority;

    const depleted = batteryLevel <= 0;
    staticNode.isDepleted = depleted;
    tacNode.isDepleted = depleted;
    reactiveNode.isDepleted = depleted;

    return [staticNode, tacNode, reactiveNode];
  }

  /**
   * Instantiates initial twin arrays from all entities currently in the registry.
   */
  public static initNodes(
    nodeRegistry: NodeRegistry,
    terrainEngine: TerrainEngine
  ): {
    nodesStatic: GroundNodeTrafficSubsystem[];
    nodesTac: GroundNodeTrafficSubsystem[];
    nodesReactive: GroundNodeTrafficSubsystem[];
  } {
    const nodesStatic: GroundNodeTrafficSubsystem[] = [];
    const nodesTac: GroundNodeTrafficSubsystem[] = [];
    const nodesReactive: GroundNodeTrafficSubsystem[] = [];

    for (const entity of nodeRegistry.getAll()) {
      const [staticNode, tacNode, reactiveNode] = this.createNodePair(entity, terrainEngine);
      nodesStatic.push(staticNode);
      nodesTac.push(tacNode);
      nodesReactive.push(reactiveNode);
    }

    return { nodesStatic, nodesTac, nodesReactive };
  }

  /**
   * Re-derives each ground node's MSL altitude from the active terrain and its AGL.
   * Synchronizes spatial changes back to the nodeRegistry.
   */
  public static resampleGroundNodeAltitudes(
    nodesStatic: GroundNodeTrafficSubsystem[],
    nodesTac: GroundNodeTrafficSubsystem[],
    nodeRegistry: NodeRegistry,
    terrainEngine: TerrainEngine,
    nodesReactive?: GroundNodeTrafficSubsystem[]
  ): void {
    const lists = nodesReactive ? [nodesStatic, nodesTac, nodesReactive] : [nodesStatic, nodesTac];
    for (const nodes of lists) {
      for (const node of nodes) {
        const [x, y] = node.position;
        const elev = terrainEngine.getElevation(x, y);
        const groundMsl = Number.isFinite(elev)
          ? elev
          : (Number.isFinite(node.position[2]) ? node.position[2] - node.aglM : 3500);
        node.position = [x, y, groundMsl + node.aglM];
        nodeRegistry.updateSpatial(node.nodeId, x, y, node.aglM);
      }
    }
  }

  /**
   * Validates and executes dynamic node addition (NODE_ADD).
   */
  public static addNode(params: AddNodeParams): AddNodeOutcome {
    const {
      msg,
      nodeRegistry,
      registrationLifecycle,
      terrainEngine,
      simTimeS,
      spatialLocked,
    } = params;

    if (spatialLocked) {
      return { accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.' };
    }
    if (nodeRegistry.size >= MAX_ACTIVE_GROUND_NODES) {
      return { accepted: false, reason: `Maximum active ground-node capacity (${MAX_ACTIVE_GROUND_NODES}) reached.` };
    }

    const xm = msg.x_m !== undefined ? msg.x_m : 0.0;
    const ym = msg.y_m !== undefined ? msg.y_m : 0.0;
    const aglM = msg.agl_m !== undefined ? msg.agl_m : DEFAULT_ANTENNA_AGL_M;

    if (!isFiniteNumber(xm) || !isFiniteNumber(ym) || Math.abs(xm) > THEATER_HALF_M || Math.abs(ym) > THEATER_HALF_M) {
      return { accepted: false, reason: 'NODE_ADD requires finite x_m and y_m coordinates within theater bounds (±600000 m).' };
    }
    if (!isFiniteNumber(aglM) || aglM < MIN_GROUND_AGL_M || aglM > MAX_GROUND_AGL_M) {
      return { accepted: false, reason: `NODE_ADD requires agl_m between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.` };
    }
    if (msg.role !== undefined && msg.role !== 'soldier' && msg.role !== 'mcp') {
      return { accepted: false, reason: "role must be 'soldier' or 'mcp'." };
    }
    if (msg.callsign !== undefined && (typeof msg.callsign !== 'string' || msg.callsign.trim().length === 0)) {
      return { accepted: false, reason: 'callsign must be a non-empty string.' };
    }
    if (msg.tx_power_dbm !== undefined && (!isFiniteNumber(msg.tx_power_dbm) || msg.tx_power_dbm < 10.0 || msg.tx_power_dbm > 50.0)) {
      return { accepted: false, reason: 'tx_power_dbm must be a finite number between 10.0 and 50.0 dBm.' };
    }
    if (msg.battery_capacity_mah !== undefined && (!isFiniteNumber(msg.battery_capacity_mah) || msg.battery_capacity_mah < 100.0 || msg.battery_capacity_mah > 500000.0)) {
      return { accepted: false, reason: 'battery_capacity_mah must be a finite number between 100.0 and 500000.0 mAh.' };
    }
    if (msg.battery_level_pct !== undefined && (!isFiniteNumber(msg.battery_level_pct) || msg.battery_level_pct < 0.0 || msg.battery_level_pct > 100.0)) {
      return { accepted: false, reason: 'battery_level_pct must be a finite number between 0.0 and 100.0 percent.' };
    }
    if (msg.tactical_priority !== undefined && (!isFiniteNumber(msg.tactical_priority) || msg.tactical_priority < 0.1 || msg.tactical_priority > 5.0)) {
      return { accepted: false, reason: 'tactical_priority must be a finite number between 0.1 and 5.0.' };
    }
    if (msg.color_hex !== undefined && (typeof msg.color_hex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(msg.color_hex.trim()))) {
      return { accepted: false, reason: 'color_hex must be a valid hex color code (e.g. #38bdf8).' };
    }

    const role: NodeType = msg.role ?? 'soldier';
    const entity = nodeRegistry.createDynamicNode({
      callsign: msg.callsign ? msg.callsign.trim() : undefined,
      role,
      position: [xm, ym],
      aglM,
      trafficOptions: msg.traffic_options,
      colorHex: msg.color_hex ? msg.color_hex.trim() : undefined,
      txPowerDbm: msg.tx_power_dbm,
      batteryCapacityMah: msg.battery_capacity_mah,
      batteryLevelPct: msg.battery_level_pct,
      tacticalPriority: msg.tactical_priority,
    });

    const nid = entity.identity.nodeId;
    registrationLifecycle.add(nid, simTimeS);

    const nodePair = this.createNodePair(entity, terrainEngine);

    return {
      accepted: true,
      entity,
      nodePair,
    };
  }

  /**
   * Validates and executes node deletion (NODE_DELETE).
   */
  public static deleteNode(params: DeleteNodeParams): DeleteNodeOutcome {
    const {
      msg,
      nodeRegistry,
      registrationLifecycle,
      simTimeS,
      spatialLocked,
    } = params;

    if (spatialLocked) {
      return { accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.' };
    }
    const nid = msg.node_id;
    if (!Number.isInteger(nid) || !nodeRegistry.hasNodeId(nid)) {
      return { accepted: false, reason: 'node_id must identify an active registered ground node.' };
    }

    // 1. Registry unregister and tombstone
    nodeRegistry.unregister(nid);

    // 2. Registration lifecycle removal
    registrationLifecycle.remove(nid, simTimeS);

    return {
      accepted: true,
      deletedNodeId: nid,
    };
  }

  /**
   * Validates and executes dynamic node duplication (NODE_DUPLICATE).
   */
  public static duplicateNode(params: DuplicateNodeParams): DuplicateNodeOutcome {
    const {
      msg,
      nodeRegistry,
      registrationLifecycle,
      terrainEngine,
      simTimeS,
      spatialLocked,
    } = params;

    if (spatialLocked) {
      return { accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.' };
    }
    if (nodeRegistry.size >= MAX_ACTIVE_GROUND_NODES) {
      return { accepted: false, reason: `Maximum active ground-node capacity (${MAX_ACTIVE_GROUND_NODES}) reached.` };
    }

    const srcId = msg.source_node_id;
    if (!Number.isInteger(srcId) || !nodeRegistry.hasNodeId(srcId)) {
      return { accepted: false, reason: 'source_node_id must identify an active registered ground node.' };
    }
    const src = nodeRegistry.getByNodeId(srcId);
    if (!src) {
      return { accepted: false, reason: 'Source node entity could not be retrieved.' };
    }

    const dx = isFiniteNumber(msg.offset_x_m) ? msg.offset_x_m : 500.0;
    const dy = isFiniteNumber(msg.offset_y_m) ? msg.offset_y_m : 500.0;
    const newX = src.position[0] + dx;
    const newY = src.position[1] + dy;

    if (Math.abs(newX) > THEATER_HALF_M || Math.abs(newY) > THEATER_HALF_M) {
      return { accepted: false, reason: 'Duplicated node coordinates fall outside theater bounds (±600000 m).' };
    }

    const callsign = msg.callsign && typeof msg.callsign === 'string' && msg.callsign.trim().length > 0
      ? msg.callsign.trim()
      : `${src.identity.callsign}_copy`;

    const entity = nodeRegistry.createDynamicNode({
      callsign,
      role: src.identity.role,
      position: [newX, newY],
      aglM: src.aglM,
      trafficOptions: { ...src.trafficOptions },
      colorHex: src.identity.colorHex,
      txPowerDbm: src.txPowerDbm,
      batteryCapacityMah: src.batteryCapacityMah,
      batteryLevelPct: src.batteryLevelPct,
      tacticalPriority: src.tacticalPriority,
    });

    const nid = entity.identity.nodeId;
    registrationLifecycle.add(nid, simTimeS);

    const nodePair = this.createNodePair(entity, terrainEngine);

    return {
      accepted: true,
      entity,
      sourceNodeId: srcId,
      nodePair,
    };
  }

  /**
   * Validates and executes node property and spatial updates (NODE_UPDATE).
   */
  public static updateNode(params: UpdateNodeParams): UpdateNodeOutcome {
    const {
      msg,
      nodesStatic,
      nodesTac,
      nodeRegistry,
      terrainEngine,
      spatialLocked,
    } = params;

    const nid = msg.node_id;
    if (!Number.isInteger(nid) || !nodeRegistry.hasNodeId(nid)) {
      return { accepted: false, reason: 'node_id must identify an active registered ground node.' };
    }

    const changesSpatial = msg.x_m !== undefined || msg.y_m !== undefined || msg.agl_m !== undefined;
    if (spatialLocked && changesSpatial) {
      return { accepted: false, reason: 'Spatial lock is enabled; spatial state was not changed.' };
    }

    const staticNode = nodesStatic.find(n => n.nodeId === nid);
    const tacNode = nodesTac.find(n => n.nodeId === nid);
    const reactiveNode = params.nodesReactive?.find(n => n.nodeId === nid);
    const entity = nodeRegistry.getByNodeId(nid);
    if (!staticNode || !tacNode || !entity) {
      return { accepted: false, reason: 'Target node was not found.' };
    }

    if (msg.x_m !== undefined && (!isFiniteNumber(msg.x_m) || Math.abs(msg.x_m) > THEATER_HALF_M)) {
      return { accepted: false, reason: 'x_m must be a finite number within theater bounds (±600000 m).' };
    }
    if (msg.y_m !== undefined && (!isFiniteNumber(msg.y_m) || Math.abs(msg.y_m) > THEATER_HALF_M)) {
      return { accepted: false, reason: 'y_m must be a finite number within theater bounds (±600000 m).' };
    }
    if (msg.agl_m !== undefined && (!isFiniteNumber(msg.agl_m) || msg.agl_m < MIN_GROUND_AGL_M || msg.agl_m > MAX_GROUND_AGL_M)) {
      return { accepted: false, reason: `agl_m must be between ${MIN_GROUND_AGL_M} and ${MAX_GROUND_AGL_M} metres.` };
    }
    if (msg.role !== undefined && msg.role !== 'soldier' && msg.role !== 'mcp') {
      return { accepted: false, reason: "role must be 'soldier' or 'mcp'." };
    }
    if (msg.callsign !== undefined && (typeof msg.callsign !== 'string' || msg.callsign.trim().length === 0)) {
      return { accepted: false, reason: 'callsign must be a non-empty string.' };
    }
    if (msg.tx_power_dbm !== undefined && (!isFiniteNumber(msg.tx_power_dbm) || msg.tx_power_dbm < 10.0 || msg.tx_power_dbm > 50.0)) {
      return { accepted: false, reason: 'tx_power_dbm must be a finite number between 10.0 and 50.0 dBm.' };
    }
    if (msg.battery_capacity_mah !== undefined && (!isFiniteNumber(msg.battery_capacity_mah) || msg.battery_capacity_mah < 100.0 || msg.battery_capacity_mah > 500000.0)) {
      return { accepted: false, reason: 'battery_capacity_mah must be a finite number between 100.0 and 500000.0 mAh.' };
    }
    if (msg.battery_level_pct !== undefined && (!isFiniteNumber(msg.battery_level_pct) || msg.battery_level_pct < 0.0 || msg.battery_level_pct > 100.0)) {
      return { accepted: false, reason: 'battery_level_pct must be a finite number between 0.0 and 100.0 percent.' };
    }
    if (msg.tactical_priority !== undefined && (!isFiniteNumber(msg.tactical_priority) || msg.tactical_priority < 0.1 || msg.tactical_priority > 5.0)) {
      return { accepted: false, reason: 'tactical_priority must be a finite number between 0.1 and 5.0.' };
    }
    if (msg.color_hex !== undefined && (typeof msg.color_hex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(msg.color_hex.trim()))) {
      return { accepted: false, reason: 'color_hex must be a valid hex color code (e.g. #38bdf8).' };
    }

    const nextX = msg.x_m !== undefined ? msg.x_m : staticNode.position[0];
    const nextY = msg.y_m !== undefined ? msg.y_m : staticNode.position[1];
    const nextAgl = msg.agl_m !== undefined ? msg.agl_m : staticNode.aglM;
    const nextTerrainMsl = terrainEngine.getElevation(nextX, nextY);
    const nextZ = nextTerrainMsl + nextAgl;

    staticNode.position = [nextX, nextY, nextZ];
    tacNode.position = [nextX, nextY, nextZ];
    if (reactiveNode) reactiveNode.position = [nextX, nextY, nextZ];
    staticNode.aglM = nextAgl;
    tacNode.aglM = nextAgl;
    if (reactiveNode) reactiveNode.aglM = nextAgl;

    if (msg.role !== undefined) {
      staticNode.nodeType = msg.role;
      tacNode.nodeType = msg.role;
      if (reactiveNode) reactiveNode.nodeType = msg.role;
    }
    if (msg.tx_power_dbm !== undefined) {
      staticNode.txPowerDbm = msg.tx_power_dbm;
      tacNode.txPowerDbm = msg.tx_power_dbm;
      if (reactiveNode) reactiveNode.txPowerDbm = msg.tx_power_dbm;
    }
    if (msg.battery_capacity_mah !== undefined) {
      staticNode.batteryCapacityMah = msg.battery_capacity_mah;
      tacNode.batteryCapacityMah = msg.battery_capacity_mah;
      if (reactiveNode) reactiveNode.batteryCapacityMah = msg.battery_capacity_mah;
    }
    if (msg.battery_level_pct !== undefined) {
      staticNode.batteryLevelPct = msg.battery_level_pct;
      tacNode.batteryLevelPct = msg.battery_level_pct;
      staticNode.isDepleted = msg.battery_level_pct <= 0;
      tacNode.isDepleted = msg.battery_level_pct <= 0;
      if (reactiveNode) {
        reactiveNode.batteryLevelPct = msg.battery_level_pct;
        reactiveNode.isDepleted = msg.battery_level_pct <= 0;
      }
    }
    if (msg.tactical_priority !== undefined) {
      staticNode.tacticalPriority = msg.tactical_priority;
      tacNode.tacticalPriority = msg.tactical_priority;
      if (reactiveNode) reactiveNode.tacticalPriority = msg.tactical_priority;
    }

    nodeRegistry.updateEntity(nid, {
      position: [nextX, nextY],
      aglM: nextAgl,
      role: msg.role,
      callsign: msg.callsign ? msg.callsign.trim() : undefined,
      trafficOptions: msg.traffic_options,
      colorHex: msg.color_hex ? msg.color_hex.trim() : undefined,
      txPowerDbm: msg.tx_power_dbm,
      batteryCapacityMah: msg.battery_capacity_mah,
      batteryLevelPct: msg.battery_level_pct,
      tacticalPriority: msg.tactical_priority,
    });

    const updatedEntity = nodeRegistry.getByNodeId(nid);
    if (updatedEntity) {
      (staticNode as any).identity = updatedEntity.identity;
      (tacNode as any).identity = updatedEntity.identity;
    }

    return {
      accepted: true,
      nodeId: nid,
      spatialChanged: changesSpatial,
    };
  }
}
