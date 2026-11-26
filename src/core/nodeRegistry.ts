/**
 * src/core/nodeRegistry.ts
 *
 * Milestone M1a: Stable Entity Identity and Registry Compatibility.
 *
 * Implements:
 * 1. NodeIdentity interface preserving numeric nodeId (0..15), creationSequence (0..15),
 *    stable RFC 4122 UUID v4 entityId, callsign, role, and display metadata.
 * 2. GroundNodeEntity data record encapsulating identity, spatial coordinates,
 *    antenna AGL, traffic generator profile, and deterministic RNG seed.
 * 3. Seed mapping formula: 1000 + nodeId + seedOffset.
 * 4. NodeRegistry class providing O(1) indexed lookups by nodeId, entityId,
 *    and creationSequence, with mutation tracking for position/AGL changes.
 * 5. createDefault16NodeRegistry factory restoring the canonical 16-node layout.
 */

import { NodeType, GROUND_NODE_IDS } from './config';
import {
  MCP_ID,
  DEFAULT_ANTENNA_AGL_M,
  MAX_ACTIVE_GROUND_NODES,
} from '../shared/constants';

export { MCP_ID, DEFAULT_ANTENNA_AGL_M, MAX_ACTIVE_GROUND_NODES };

export interface TacticalTeam {
  readonly teamId: string;
  readonly teamName: string;
  readonly colorHex?: string;
}

export const DEFAULT_TACTICAL_TEAMS: readonly TacticalTeam[] = Object.freeze([
  { teamId: 'alpha', teamName: 'Alpha Squad', colorHex: '#38bdf8' },
  { teamId: 'bravo', teamName: 'Bravo Squad', colorHex: '#10b981' },
  { teamId: 'charlie', teamName: 'Charlie Recon', colorHex: '#f59e0b' },
  { teamId: 'hq', teamName: 'HQ Command', colorHex: '#a855f7' },
]);

export function normalizeTeamId(nameOrId: string): string {
  const cleaned = String(nameOrId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'alpha';
}

export function getDefaultTeamForCanonicalNode(nodeId: number): TacticalTeam {
  if (nodeId === MCP_ID) return DEFAULT_TACTICAL_TEAMS[3]; // HQ Command
  if (nodeId === 3 || nodeId === 4 || nodeId === 9 || nodeId === 12 || nodeId === 13) {
    return DEFAULT_TACTICAL_TEAMS[2]; // Charlie Recon
  }
  if (nodeId === 6 || nodeId === 7 || nodeId === 8 || nodeId === 10 || nodeId === 11) {
    return DEFAULT_TACTICAL_TEAMS[1]; // Bravo Squad
  }
  return DEFAULT_TACTICAL_TEAMS[0]; // Alpha Squad
}

export function parseTeamSelection(selection: unknown): string | null {
  if (typeof selection !== 'string') return null;
  const trimmed = selection.trim();
  if (!trimmed.toLowerCase().startsWith('team:')) return null;
  const rawKey = trimmed.slice(5).trim();
  return rawKey ? normalizeTeamId(rawKey) : null;
}

export function nodeMatchesTeam(
  node: {
    readonly team_id?: string | null;
    readonly teamId?: string | null;
    readonly team_name?: string | null;
    readonly teamName?: string | null;
  } | null | undefined,
  teamIdOrSelection: string
): boolean {
  if (!node) return false;
  const key = parseTeamSelection(teamIdOrSelection) ?? normalizeTeamId(teamIdOrSelection);
  if (!key) return false;
  const rawId = typeof node.team_id === 'string' && node.team_id.trim()
    ? node.team_id
    : (typeof node.teamId === 'string' && node.teamId.trim() ? node.teamId : '');
  const rawName = typeof node.team_name === 'string' && node.team_name.trim()
    ? node.team_name
    : (typeof node.teamName === 'string' && node.teamName.trim() ? node.teamName : '');
  if (rawId && normalizeTeamId(rawId) === key) return true;
  if (rawName) {
    const normName = normalizeTeamId(rawName);
    if (normName === key || (!rawId && normName === `${key}-team`)) return true;
    if (rawId && normName === key) return true;
  }
  return false;
}

export interface CollectedTeamSummary {
  readonly teamId: string;
  readonly teamName: string;
  readonly nodeIds: readonly number[];
}

export function collectTeamsFromNodes(
  nodes: ReadonlyArray<{
    readonly node_id?: number;
    readonly nodeId?: number;
    readonly team_id?: string;
    readonly teamId?: string;
    readonly team_name?: string;
    readonly teamName?: string;
    readonly node_type?: string;
  }>
): CollectedTeamSummary[] {
  const map = new Map<string, { teamId: string; teamName: string; nodeIds: number[] }>();
  for (const n of nodes) {
    const nid = typeof n.node_id === 'number' ? n.node_id : (typeof n.nodeId === 'number' ? n.nodeId : -1);
    if (nid < 0) continue;
    const rawName = (n.team_name ?? n.teamName ?? '').trim();
    const rawId = (n.team_id ?? n.teamId ?? '').trim();
    const fallbackName = n.node_type === 'mcp' ? 'HQ Command' : 'Alpha Squad';
    const teamName = rawName || rawId || fallbackName;
    const teamId = rawId ? normalizeTeamId(rawId) : normalizeTeamId(teamName);
    let entry = map.get(teamId);
    if (!entry) {
      entry = { teamId, teamName, nodeIds: [] };
      map.set(teamId, entry);
    }
    entry.nodeIds.push(nid);
  }
  return Array.from(map.values()).sort((a, b) => a.teamName.localeCompare(b.teamName));
}

export interface NodeIdentity {
  /** Stable RFC 4122 UUID v4 or persistent string identifier. */
  readonly entityId: string;
  /** Compact numeric index; 0–15 for canonical legacy nodes. */
  readonly nodeId: number;
  /** Monotonically assigned sequence index; 0–15 for canonical legacy nodes. */
  readonly creationSequence: number;
  /** Tactical callsign (e.g., 'S0'..'S14', 'MCP'). */
  readonly callsign: string;
  /** Operational node type. */
  readonly role: NodeType;
  /** Display / operational role metadata (e.g., 'soldier' | 'convoy' | 'mcp'). */
  readonly nodeRole?: string;
  /** Assigned tactical team identifier. */
  readonly teamId?: string;
  /** Assigned tactical team display name. */
  readonly teamName?: string;
  /** Presentation UI color hex code. */
  readonly colorHex?: string;
}

export interface NodeTrafficOptions {
  readonly hasVoice?: boolean;
  readonly voiceStartS?: number;
  readonly voiceEndS?: number;
  readonly hasVideo?: boolean;
  readonly videoMeanPktsPerFrame?: number;
  readonly hasPhoto?: boolean;
  readonly photoTriggerTimeS?: number;
  readonly photoSizeBytes?: number;
}

export interface GroundNodeEntity {
  readonly identity: NodeIdentity;
  /** Planar coordinates [x, y] in local theater Cartesian metres. */
  position: [number, number];
  /** Antenna height above ground level in metres. */
  aglM: number;
  /** Traffic subsystem options. */
  trafficOptions: NodeTrafficOptions;
  /** Deterministic RNG seed derived via computeNodeSeed. */
  readonly seed: number;
  /** Configured transmit power in dBm. */
  txPowerDbm?: number;
  /** Battery capacity in mAh. */
  batteryCapacityMah?: number;
  /** Current battery level percentage (0.0 - 100.0). */
  batteryLevelPct?: number;
  /** Tactical priority multiplier (0.1 - 5.0). */
  tacticalPriority?: number;
}

let fallbackUuidCounter = 1;

/**
 * Generates an RFC 4122 UUID v4 identifier.
 * Uses crypto.randomUUID() when available, falling back to a deterministic
 * xorshift32 PRNG (never Math.random()) so simulation environments stay reproducible.
 */
export function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  let state = (0x9e3779b9 ^ (fallbackUuidCounter++ * 0x85ebca6b)) >>> 0;
  const nextNibble = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) & 0xf;
  };
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = nextNibble();
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Deterministically formats an RFC 4122 UUID v4 for a canonical node ID.
 * Produces format: 00000000-0000-4000-8000-xxxxxxxxxxxx
 */
export function formatDeterministicNodeUuid(nodeId: number): string {
  const hex = (nodeId >>> 0).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/**
 * Authoritative seed calculation formula: 1000 + nodeId + seedOffset.
 */
export function computeNodeSeed(nodeId: number, seedOffset: number = 0): number {
  return 1000 + nodeId + seedOffset;
}

/**
 * Authoritative initial 16-node tactical planar coordinate layout.
 */
export const CANONICAL_16_NODE_POSITIONS: readonly (readonly [number, number])[] = Object.freeze([
  [-18000.0, -12000.0], // Node 0: Rifleman
  [-8000.0, -5000.0],   // Node 1: Squad Leader
  [15000.0, -20000.0],  // Node 2: Medic
  [-25000.0, 18000.0],  // Node 3: Scout Alpha
  [12000.0, 8000.0],    // Node 4: Recon Patrol (Occlusion Target)
  [28000.0, 32000.0],   // Node 5: Rifleman
  [-32000.0, -25000.0], // Node 6: Scout Bravo
  [-12000.0, 24000.0],  // Node 7: Designated Marksman
  [22000.0, 12000.0],   // Node 8: Support Gunner
  [35000.0, -15000.0],  // Node 9: Scout Charlie
  [42000.0, -28000.0],  // Node 10: Rifleman
  [-40000.0, 5000.0],   // Node 11: Ammo Carrier
  [8000.0, -14000.0],   // Node 12: Forward Observer
  [18000.0, 22000.0],   // Node 13: RTL Relay
  [-5000.0, 15000.0],   // Node 14: Rifleman
  [-20000.0, -30000.0], // Node 15: Main Command Post (MCP 20W Dish)
]);

/**
 * Resolves default traffic options for the canonical 16-node scenario.
 */
export function getCanonicalTrafficOptions(nodeId: number): NodeTrafficOptions {
  return {
    hasVoice: nodeId === MCP_ID || nodeId === 4 || nodeId === 1 || nodeId === 2,
    voiceStartS: nodeId === 4 ? 1.0 : 0.0,
    voiceEndS: nodeId === 4 ? 3.8 : 1e6,
    hasVideo: nodeId === MCP_ID || nodeId === 3 || nodeId === 6 || nodeId === 9,
    videoMeanPktsPerFrame: nodeId === MCP_ID ? 2.5 : 0.8,
    hasPhoto: nodeId === 4,
    photoTriggerTimeS: 1.8,
    photoSizeBytes: 240000,
  };
}

/**
 * NodeRegistry encapsulates stable ground node entity records.
 */
export class NodeRegistry {
  private readonly byNodeId: Map<number, GroundNodeEntity> = new Map();
  private readonly byEntityId: Map<string, GroundNodeEntity> = new Map();
  private readonly bySequence: Map<number, GroundNodeEntity> = new Map();
  private readonly entityList: GroundNodeEntity[] = [];
  private readonly deletedNodeIds: Set<number> = new Set();
  private readonly teams: Map<string, TacticalTeam> = new Map();
  private nextAvailableNodeId: number = 16;
  private nextCreationSequence: number = 16;

  constructor(public readonly seedOffset: number = 0) {
    this.seedDefaultTeams();
  }

  private seedDefaultTeams(): void {
    for (const team of DEFAULT_TACTICAL_TEAMS) {
      this.teams.set(team.teamId, team);
    }
  }

  public registerTeam(teamId: string, teamName: string, colorHex?: string): TacticalTeam {
    const cleanName = String(teamName || '').trim() || teamId || 'Alpha Squad';
    const cleanId = normalizeTeamId(teamId || cleanName);
    const existing = this.teams.get(cleanId);
    const team: TacticalTeam = {
      teamId: cleanId,
      teamName: cleanName,
      colorHex: colorHex ?? existing?.colorHex,
    };
    this.teams.set(cleanId, team);
    return team;
  }

  public getTeams(): readonly TacticalTeam[] {
    const out = new Map<string, TacticalTeam>(this.teams);
    for (const entity of this.entityList) {
      if (entity.identity.teamId && entity.identity.teamName) {
        out.set(entity.identity.teamId, {
          teamId: entity.identity.teamId,
          teamName: entity.identity.teamName,
        });
      }
    }
    return Array.from(out.values());
  }

  public assignNodesToTeam(nodeIds: readonly number[], teamId: string, teamName: string): number[] {
    const team = this.registerTeam(teamId, teamName);
    const updated: number[] = [];
    for (const nid of nodeIds) {
      const entity = this.byNodeId.get(nid);
      if (!entity) continue;
      (entity as { identity: NodeIdentity }).identity = {
        ...entity.identity,
        teamId: team.teamId,
        teamName: team.teamName,
      };
      updated.push(nid);
    }
    return updated;
  }

  public register(entity: GroundNodeEntity): void {
    if (this.byNodeId.has(entity.identity.nodeId)) {
      throw new Error(`NodeRegistry: duplicate nodeId ${entity.identity.nodeId}`);
    }
    if (this.byEntityId.has(entity.identity.entityId)) {
      throw new Error(`NodeRegistry: duplicate entityId ${entity.identity.entityId}`);
    }
    this.byNodeId.set(entity.identity.nodeId, entity);
    this.byEntityId.set(entity.identity.entityId, entity);
    // Also index "node-${nodeId}" for flexible lookup
    this.byEntityId.set(`node-${entity.identity.nodeId}`, entity);
    this.bySequence.set(entity.identity.creationSequence, entity);
    this.entityList.push(entity);

    // Keep allocation watermarks beyond any manually or canonically registered node
    if (entity.identity.nodeId >= this.nextAvailableNodeId) {
      this.nextAvailableNodeId = entity.identity.nodeId + 1;
    }
    if (entity.identity.creationSequence >= this.nextCreationSequence) {
      this.nextCreationSequence = entity.identity.creationSequence + 1;
    }
  }

  public getByNodeId(nodeId: number): GroundNodeEntity | undefined {
    return this.byNodeId.get(nodeId);
  }

  public getByEntityId(entityId: string): GroundNodeEntity | undefined {
    return this.byEntityId.get(entityId);
  }

  public getByCreationSequence(sequence: number): GroundNodeEntity | undefined {
    return this.bySequence.get(sequence);
  }

  public hasNodeId(nodeId: number): boolean {
    return this.byNodeId.has(nodeId);
  }

  public hasEntityId(entityId: string): boolean {
    return this.byEntityId.has(entityId);
  }

  public getAll(): readonly GroundNodeEntity[] {
    return [...this.entityList];
  }

  public getNodeIds(): readonly number[] {
    return this.entityList.map(e => e.identity.nodeId);
  }

  public getEntityIds(): readonly string[] {
    return this.entityList.map(e => e.identity.entityId);
  }

  public get size(): number {
    return this.entityList.length;
  }

  public canAddNode(): boolean {
    return this.entityList.length < MAX_ACTIVE_GROUND_NODES;
  }

  /**
   * Allocates the next strictly unique numeric nodeId.
   * Never reuses any previously allocated or deleted nodeId.
   */
  public allocateNextNodeId(): number {
    while (this.byNodeId.has(this.nextAvailableNodeId) || this.deletedNodeIds.has(this.nextAvailableNodeId)) {
      this.nextAvailableNodeId++;
    }
    return this.nextAvailableNodeId++;
  }

  /**
   * Allocates the next monotonically increasing creation sequence index.
   */
  public allocateNextCreationSequence(): number {
    return this.nextCreationSequence++;
  }

  public isNodeIdDeleted(nodeId: number): boolean {
    return this.deletedNodeIds.has(nodeId);
  }

  public getDeletedNodeIds(): readonly number[] {
    return Array.from(this.deletedNodeIds);
  }

  /**
   * Safely unregisters an active ground node, removing it from all active index maps
   * and recording its numeric nodeId in the deleted tombstone set to prevent reuse.
   */
  public unregister(nodeId: number): GroundNodeEntity | undefined {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return undefined;

    this.byNodeId.delete(nodeId);
    this.byEntityId.delete(entity.identity.entityId);
    this.byEntityId.delete(`node-${nodeId}`);
    this.bySequence.delete(entity.identity.creationSequence);

    const idx = this.entityList.findIndex(e => e.identity.nodeId === nodeId);
    if (idx !== -1) {
      this.entityList.splice(idx, 1);
    }

    this.deletedNodeIds.add(nodeId);
    return entity;
  }

  /**
   * Creates, registers, and returns a new dynamic ground node entity.
   * Enforces the MAX_ACTIVE_GROUND_NODES (128) ceiling.
   */
  public createDynamicNode(params: {
    callsign?: string;
    role?: NodeType;
    nodeRole?: string;
    teamId?: string;
    teamName?: string;
    position?: [number, number];
    aglM?: number;
    trafficOptions?: NodeTrafficOptions;
    entityId?: string;
    colorHex?: string;
    txPowerDbm?: number;
    batteryCapacityMah?: number;
    batteryLevelPct?: number;
    tacticalPriority?: number;
  } = {}): GroundNodeEntity {
    if (!this.canAddNode()) {
      throw new Error(`Maximum active ground-node capacity (${MAX_ACTIVE_GROUND_NODES}) reached.`);
    }

    const nodeId = this.allocateNextNodeId();
    const creationSequence = this.allocateNextCreationSequence();
    const entityId = params.entityId ?? generateUuidV4();
    const rawRole = String(params.nodeRole ?? params.role ?? 'soldier');
    const role: NodeType = params.role ?? 'soldier';
    const callsign = params.callsign ?? (role === 'mcp' ? `MCP-${nodeId}` : `S${nodeId}`);
    const defaultTeam = role === 'mcp' ? DEFAULT_TACTICAL_TEAMS[3] : DEFAULT_TACTICAL_TEAMS[0];
    const teamName = params.teamName?.trim() || (params.teamId ? (this.teams.get(normalizeTeamId(params.teamId))?.teamName ?? params.teamId) : defaultTeam.teamName);
    const teamId = params.teamId ? normalizeTeamId(params.teamId) : (params.teamName ? normalizeTeamId(teamName) : defaultTeam.teamId);
    this.registerTeam(teamId, teamName);
    const colorHex = params.colorHex ?? (role === 'mcp' ? '#f59e0b' : '#38bdf8');
    const position: [number, number] = params.position ? [params.position[0], params.position[1]] : [0, 0];
    const aglM = params.aglM !== undefined ? params.aglM : DEFAULT_ANTENNA_AGL_M;
    const trafficOptions: NodeTrafficOptions = params.trafficOptions ? { ...params.trafficOptions } : {};
    const seed = computeNodeSeed(nodeId, this.seedOffset);
    const txPowerDbm = params.txPowerDbm !== undefined ? params.txPowerDbm : (role === 'mcp' ? 43.0 : 36.0);
    const batteryCapacityMah = params.batteryCapacityMah !== undefined ? params.batteryCapacityMah : (role === 'mcp' ? 20000 : 5000);
    const batteryLevelPct = params.batteryLevelPct !== undefined ? Math.max(0.0, Math.min(100.0, params.batteryLevelPct)) : 100.0;
    const tacticalPriority = params.tacticalPriority !== undefined ? Math.max(0.1, Math.min(5.0, params.tacticalPriority)) : 1.0;

    const identity: NodeIdentity = {
      entityId,
      nodeId,
      creationSequence,
      callsign,
      role,
      nodeRole: rawRole,
      teamId,
      teamName,
      colorHex,
    };

    const entity: GroundNodeEntity = {
      identity,
      position,
      aglM,
      trafficOptions,
      seed,
      txPowerDbm,
      batteryCapacityMah,
      batteryLevelPct,
      tacticalPriority,
    };

    this.register(entity);
    return entity;
  }

  public updateSpatial(nodeId: number, x: number, y: number, aglM?: number): boolean {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return false;
    entity.position = [x, y];
    if (aglM !== undefined) {
      entity.aglM = aglM;
    }
    return true;
  }

  public updateAgl(nodeId: number, aglM: number): boolean {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return false;
    entity.aglM = aglM;
    return true;
  }

  public updateBatteryLevel(nodeId: number, batteryLevelPct: number): boolean {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return false;
    entity.batteryLevelPct = Math.max(0.0, Math.min(100.0, batteryLevelPct));
    return true;
  }

  public updateEntity(
    nodeId: number,
    updates: {
      callsign?: string;
      role?: NodeType;
      nodeRole?: string;
      teamId?: string;
      teamName?: string;
      position?: [number, number];
      aglM?: number;
      trafficOptions?: NodeTrafficOptions;
      colorHex?: string;
      txPowerDbm?: number;
      batteryCapacityMah?: number;
      batteryLevelPct?: number;
      tacticalPriority?: number;
    }
  ): boolean {
    const entity = this.byNodeId.get(nodeId);
    if (!entity) return false;

    if (updates.position) {
      entity.position = [updates.position[0], updates.position[1]];
    }
    if (updates.aglM !== undefined) {
      entity.aglM = updates.aglM;
    }
    if (updates.trafficOptions) {
      entity.trafficOptions = { ...updates.trafficOptions };
    }
    if (updates.txPowerDbm !== undefined) {
      entity.txPowerDbm = updates.txPowerDbm;
    }
    if (updates.batteryCapacityMah !== undefined) {
      entity.batteryCapacityMah = updates.batteryCapacityMah;
    }
    if (updates.batteryLevelPct !== undefined) {
      entity.batteryLevelPct = Math.max(0.0, Math.min(100.0, updates.batteryLevelPct));
    }
    if (updates.tacticalPriority !== undefined) {
      entity.tacticalPriority = Math.max(0.1, Math.min(5.0, updates.tacticalPriority));
    }
    if (
      updates.callsign !== undefined ||
      updates.role !== undefined ||
      updates.nodeRole !== undefined ||
      updates.teamId !== undefined ||
      updates.teamName !== undefined ||
      updates.colorHex !== undefined
    ) {
      let nextTeamId = entity.identity.teamId;
      let nextTeamName = entity.identity.teamName;
      if (updates.teamId !== undefined || updates.teamName !== undefined) {
        const rawName = updates.teamName?.trim();
        const rawId = updates.teamId?.trim();
        nextTeamName = rawName || (rawId ? (this.teams.get(normalizeTeamId(rawId))?.teamName ?? rawId) : nextTeamName) || 'Alpha Squad';
        nextTeamId = rawId ? normalizeTeamId(rawId) : normalizeTeamId(nextTeamName);
        this.registerTeam(nextTeamId, nextTeamName);
      }
      const updatedIdentity: NodeIdentity = {
        ...entity.identity,
        callsign: updates.callsign ?? entity.identity.callsign,
        role: updates.role ?? entity.identity.role,
        nodeRole: updates.nodeRole ?? (updates.role ? String(updates.role) : entity.identity.nodeRole),
        teamId: nextTeamId,
        teamName: nextTeamName,
        colorHex: updates.colorHex ?? entity.identity.colorHex,
      };
      (entity as any).identity = updatedIdentity;
    }
    return true;
  }

  public clear(): void {
    this.byNodeId.clear();
    this.byEntityId.clear();
    this.bySequence.clear();
    this.entityList.length = 0;
    this.deletedNodeIds.clear();
    this.teams.clear();
    this.seedDefaultTeams();
    this.nextAvailableNodeId = 0;
    this.nextCreationSequence = 0;
  }
}

/**
 * Creates and populates the canonical 16-node registry for M1a.
 */
export function createDefault16NodeRegistry(seedOffset: number = 0): NodeRegistry {
  const registry = new NodeRegistry(seedOffset);

  for (const i of GROUND_NODE_IDS) {
    const [x, y] = CANONICAL_16_NODE_POSITIONS[i];
    const role: NodeType = i === MCP_ID ? 'mcp' : 'soldier';
    const callsign = i === MCP_ID ? 'MCP' : `S${i}`;
    const team = getDefaultTeamForCanonicalNode(i);
    const entityId = formatDeterministicNodeUuid(i);
    const creationSequence = i;
    const seed = computeNodeSeed(i, seedOffset);
    const trafficOptions = getCanonicalTrafficOptions(i);

    const identity: NodeIdentity = {
      entityId,
      nodeId: i,
      creationSequence,
      callsign,
      role,
      nodeRole: role,
      teamId: team.teamId,
      teamName: team.teamName,
      colorHex: i === MCP_ID ? '#f59e0b' : '#38bdf8',
    };

    const entity: GroundNodeEntity = {
      identity,
      position: [x, y],
      aglM: DEFAULT_ANTENNA_AGL_M,
      trafficOptions,
      seed,
      txPowerDbm: i === MCP_ID ? 43.0 : 36.0,
      batteryCapacityMah: i === MCP_ID ? 20000 : 5000,
      batteryLevelPct: 100.0,
      tacticalPriority: 1.0,
    };

    registry.register(entity);
  }

  return registry;
}
