/**
 * Event-Sourced Deterministic Flight Recorder, State Digest & Headless Replay Engine (UPG-01)
 *
 * Captures mutating worker commands against simulation tick indices so a full 2-hour
 * mission serializes to < 50 KB JSON and replays bit-exactly against a fresh
 * `SimulationWorkerManager`.
 */

import type {
  BiomeId,
  TelemetryFrame,
  WorkerInboundCommand,
} from '../shared/workerProtocol';

export const FLIGHT_RECORDING_VERSION = 'stratos-flight-rec-v1' as const;
export const DEFAULT_MAX_RECORDED_EVENTS = 10_000;
const MAX_RECORDING_JSON_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VALID_BIOME_IDS = new Set<string>([
  'alpine_mountain',
  'dense_jungle',
  'arid_desert',
  'littoral_maritime',
  'urban_canyon',
]);

/**
 * UI-only / read-only query commands that never mutate simulation state and are omitted
 * from event-sourced flight logs.
 */
const NON_MUTATING_COMMAND_TYPES = new Set<string>([
  'SET_TELEMETRY_PROFILE',
  'GET_HILLSHADE',
  'GET_TERRAIN_BOUNDS',
  'GET_TERRAIN_MESH_DATA',
  'SET_SPEED',
  'LOAD_CUSTOM_DEM',
]);

// Reusable zero-allocation scratch buffer for IEEE-754 float64 / int32 hashing
const DIGEST_SCRATCH_BUF = new ArrayBuffer(8);
const DIGEST_SCRATCH_VIEW = new DataView(DIGEST_SCRATCH_BUF);
const DIGEST_SCRATCH_BYTES = new Uint8Array(DIGEST_SCRATCH_BUF);

const FNV32_OFFSET_A = 0x811c9dc5;
const FNV32_OFFSET_B = 0x9e3779b9;
const FNV32_PRIME = 0x01000193;

function mixByteA(h: number, b: number): number {
  return Math.imul(h ^ (b & 0xff), FNV32_PRIME) >>> 0;
}

function mixByteB(h: number, b: number): number {
  return Math.imul(h ^ ((b + 0x5a) & 0xff), FNV32_PRIME) >>> 0;
}

/**
 * Computes a deterministic, zero-allocation 64-bit FNV-1a hex digest (`0x...`, 16 hex chars)
 * over authoritative simulation state in `TelemetryFrame`:
 * - `frame_index`, `sim_time_s`
 * - ACN ENU position
 * - Active node IDs, ENU positions, and SNRs
 * - `comparative_kpi_dashboard` goodput & drop counters
 *
 * Intentionally excludes optional UI-scoped telemetry (`selected_node_fresnel`,
 * `active_gantt_allocations`, `viewshed_sinr_grid`, `state_digest_hex`, etc.) so
 * unthrottled and throttled/filtered telemetry streams produce identical digests.
 */
export function computeTelemetryStateDigest(frame: TelemetryFrame): string {
  let ha = FNV32_OFFSET_A;
  let hb = FNV32_OFFSET_B;

  const mixInt = (v: number): void => {
    const n = Number.isFinite(v) ? (v | 0) : 0;
    DIGEST_SCRATCH_VIEW.setInt32(0, n, true);
    for (let i = 0; i < 4; i++) {
      const b = DIGEST_SCRATCH_BYTES[i];
      ha = mixByteA(ha, b);
      hb = mixByteB(hb, b);
    }
  };

  const mixFloat = (v: number): void => {
    const clean = Number.isFinite(v) ? (v === 0 ? 0 : v) : 0;
    DIGEST_SCRATCH_VIEW.setFloat64(0, clean, true);
    for (let i = 0; i < 8; i++) {
      const b = DIGEST_SCRATCH_BYTES[i];
      ha = mixByteA(ha, b);
      hb = mixByteB(hb, b);
    }
  };

  mixInt(frame.frame_index ?? 0);
  mixFloat(frame.sim_time_s ?? 0);

  const acn = frame.acn_telemetry;
  mixFloat(acn?.pos_x ?? 0);
  mixFloat(acn?.pos_y ?? 0);
  mixFloat(acn?.pos_z ?? 0);

  const nodes = Array.isArray(frame.nodes_telemetry) ? frame.nodes_telemetry : [];
  mixInt(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    mixInt(node.node_id);
    mixFloat(node.x_m);
    mixFloat(node.y_m);
    mixFloat(node.z_m);
    mixFloat(node.snr_db);
  }

  const kpi = frame.comparative_kpi_dashboard;
  mixFloat(kpi?.static_goodput_mb ?? 0);
  mixFloat(kpi?.tac_goodput_mb ?? 0);
  mixInt(kpi?.static_drops ?? 0);
  mixInt(kpi?.tac_drops ?? 0);
  mixFloat(kpi?.static_goodput_frame_bits ?? 0);
  mixFloat(kpi?.tac_goodput_frame_bits ?? 0);
  mixInt(kpi?.static_drop_frame_pkts ?? 0);
  mixInt(kpi?.tac_drop_frame_pkts ?? 0);

  return `0x${ha.toString(16).padStart(8, '0')}${hb.toString(16).padStart(8, '0')}`;
}

export interface RecordedFlightEvent {
  readonly tick: number;
  readonly simTimeS: number;
  readonly command: WorkerInboundCommand;
}

export interface FlightRecordingV1 {
  readonly version: typeof FLIGHT_RECORDING_VERSION;
  readonly seed: number;
  readonly initialBiomeId: BiomeId;
  readonly createdUtcIso: string;
  readonly durationS: number;
  readonly totalTicks: number;
  readonly finalStateDigestHex: string;
  readonly events: readonly RecordedFlightEvent[];
}

export interface FlightRecorderOptions {
  readonly seed?: number;
  readonly initialBiomeId?: BiomeId;
  readonly createdUtcIso?: string;
  readonly maxEvents?: number;
}

export interface ReplayableSimulationManager {
  handleMessage(msg: WorkerInboundCommand): unknown;
  tickSimulation(emitTelemetry?: boolean): void;
  readonly lastTelemetryFrame: TelemetryFrame | null;
}

export interface FlightReplayResult {
  readonly ok: boolean;
  readonly expectedDigest: string;
  readonly actualDigest: string;
  readonly totalTicks: number;
}

function sanitizePlainValue(value: unknown, depth: number = 0): unknown {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      out.push(sanitizePlainValue(value[i], depth + 1));
    }
    return out;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return undefined;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_OBJECT_KEYS.has(k) || k === 'request_id') continue;
      const clean = sanitizePlainValue(v, depth + 1);
      if (clean !== undefined) {
        out[k] = clean;
      }
    }
    return out;
  }
  return undefined;
}

function isMutatingCommand(command: WorkerInboundCommand): boolean {
  if (!command || typeof command !== 'object' || typeof command.type !== 'string') {
    return false;
  }
  if (NON_MUTATING_COMMAND_TYPES.has(command.type)) {
    return false;
  }
  if (command.type === 'SIM_CONTROL') {
    const act = typeof command.action === 'string' ? command.action.toLowerCase() : '';
    return act === 'reset';
  }
  return true;
}

/**
 * Event-sourced flight recorder capturing mutating commands against authoritative tick numbers.
 */
export class EventSourcedFlightRecorder {
  private seed: number;
  private initialBiomeId: BiomeId;
  private createdUtcIso: string;
  private readonly maxEvents: number;
  private durationS: number = 0;
  private totalTicks: number = 0;
  private finalStateDigestHex: string = '0x0000000000000000';
  private readonly events: RecordedFlightEvent[] = [];

  constructor(options: FlightRecorderOptions = {}) {
    this.seed = Number.isFinite(options.seed) ? Number(options.seed) : 0;
    this.initialBiomeId = options.initialBiomeId ?? 'alpine_mountain';
    this.createdUtcIso = options.createdUtcIso ?? new Date().toISOString();
    this.maxEvents = Math.max(
      1,
      Math.min(DEFAULT_MAX_RECORDED_EVENTS, Math.trunc(options.maxEvents ?? DEFAULT_MAX_RECORDED_EVENTS))
    );
  }

  public reset(options: FlightRecorderOptions = {}): void {
    if (options.seed !== undefined && Number.isFinite(options.seed)) {
      this.seed = Number(options.seed);
    }
    if (options.initialBiomeId !== undefined) {
      this.initialBiomeId = options.initialBiomeId;
    }
    this.createdUtcIso = options.createdUtcIso ?? new Date().toISOString();
    this.durationS = 0;
    this.totalTicks = 0;
    this.finalStateDigestHex = '0x0000000000000000';
    this.events.length = 0;
  }

  public recordCommand(command: WorkerInboundCommand, tick: number, simTimeS: number): boolean {
    if (!isMutatingCommand(command)) {
      return false;
    }
    if (command.type === 'SIM_CONTROL' && command.action === 'reset') {
      this.reset();
      return false;
    }
    if (this.events.length >= this.maxEvents) {
      return false;
    }
    const cleanCmd = sanitizePlainValue(command) as WorkerInboundCommand | undefined;
    if (!cleanCmd || typeof cleanCmd !== 'object' || typeof cleanCmd.type !== 'string') {
      return false;
    }
    const safeTick = Number.isFinite(tick) && tick >= 0 ? Math.trunc(tick) : 0;
    const safeTime = Number.isFinite(simTimeS) && simTimeS >= 0 ? Number(simTimeS.toFixed(4)) : 0;
    this.events.push({
      tick: safeTick,
      simTimeS: safeTime,
      command: cleanCmd,
    });
    return true;
  }

  public observeFrame(frame: TelemetryFrame): void {
    if (!frame) return;
    const idx = Number.isFinite(frame.frame_index) ? Math.trunc(frame.frame_index) : 0;
    const simTime = Number.isFinite(frame.sim_time_s) ? frame.sim_time_s : 0;
    if (idx >= this.totalTicks) {
      this.totalTicks = idx;
      this.durationS = simTime;
      this.finalStateDigestHex = frame.state_digest_hex ?? computeTelemetryStateDigest(frame);
    }
  }

  public getEventCount(): number {
    return this.events.length;
  }

  public getTotalTicks(): number {
    return this.totalTicks;
  }

  public getFinalDigest(): string {
    return this.finalStateDigestHex;
  }

  public toRecording(): FlightRecordingV1 {
    return {
      version: FLIGHT_RECORDING_VERSION,
      seed: this.seed,
      initialBiomeId: this.initialBiomeId,
      createdUtcIso: this.createdUtcIso,
      durationS: Number(this.durationS.toFixed(4)),
      totalTicks: this.totalTicks,
      finalStateDigestHex: this.finalStateDigestHex,
      events: this.events.slice(),
    };
  }

  public toJson(pretty: boolean = false): string {
    return pretty ? JSON.stringify(this.toRecording(), null, 2) : JSON.stringify(this.toRecording());
  }
}

/**
 * Strictly parses and validates a `stratos-flight-rec-v1` JSON string with prototype-pollution protection.
 */
export function parseFlightRecordingJson(raw: string): FlightRecordingV1 {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('Flight recording JSON must be a non-empty string.');
  }
  if (raw.length > MAX_RECORDING_JSON_BYTES) {
    throw new Error(`Flight recording JSON exceeds maximum size (${MAX_RECORDING_JSON_BYTES} bytes).`);
  }

  let forbiddenKeyFound: string | null = null;
  const parsed: unknown = JSON.parse(raw, (key, value) => {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      forbiddenKeyFound = key;
      return undefined;
    }
    return value;
  });

  if (forbiddenKeyFound !== null) {
    throw new Error(
      `Security violation: prototype pollution attempt via forbidden key "${forbiddenKeyFound}" rejected.`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Flight recording root must be a JSON object.');
  }

  const rec = parsed as Record<string, unknown>;
  if (rec.version !== FLIGHT_RECORDING_VERSION) {
    throw new Error(`Unsupported flight recording version "${String(rec.version)}".`);
  }
  if (typeof rec.seed !== 'number' || !Number.isFinite(rec.seed)) {
    throw new Error('Flight recording seed must be a finite number.');
  }
  if (typeof rec.initialBiomeId !== 'string' || !VALID_BIOME_IDS.has(rec.initialBiomeId)) {
    throw new Error(`Invalid initialBiomeId "${String(rec.initialBiomeId)}".`);
  }
  if (typeof rec.createdUtcIso !== 'string' || rec.createdUtcIso.length === 0) {
    throw new Error('Flight recording createdUtcIso must be a non-empty string.');
  }
  if (typeof rec.durationS !== 'number' || !Number.isFinite(rec.durationS) || rec.durationS < 0) {
    throw new Error('Flight recording durationS must be a non-negative finite number.');
  }
  if (
    typeof rec.totalTicks !== 'number' ||
    !Number.isInteger(rec.totalTicks) ||
    rec.totalTicks < 0
  ) {
    throw new Error('Flight recording totalTicks must be a non-negative integer.');
  }
  if (
    typeof rec.finalStateDigestHex !== 'string' ||
    !/^0x[0-9a-fA-F]{8,16}$/.test(rec.finalStateDigestHex)
  ) {
    throw new Error('Flight recording finalStateDigestHex must be a valid hex digest.');
  }
  if (!Array.isArray(rec.events)) {
    throw new Error('Flight recording events must be an array.');
  }
  if (rec.events.length > DEFAULT_MAX_RECORDED_EVENTS) {
    throw new Error(`Flight recording exceeds max event bound (${DEFAULT_MAX_RECORDED_EVENTS}).`);
  }

  const cleanEvents: RecordedFlightEvent[] = [];
  for (let i = 0; i < rec.events.length; i++) {
    const ev = rec.events[i] as Record<string, unknown> | null;
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
      throw new Error(`Invalid recorded event at index ${i}.`);
    }
    if (typeof ev.tick !== 'number' || !Number.isInteger(ev.tick) || ev.tick < 0) {
      throw new Error(`Invalid event tick at index ${i}.`);
    }
    if (typeof ev.simTimeS !== 'number' || !Number.isFinite(ev.simTimeS) || ev.simTimeS < 0) {
      throw new Error(`Invalid event simTimeS at index ${i}.`);
    }
    const cmd = ev.command as Record<string, unknown> | null;
    if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd) || typeof cmd.type !== 'string') {
      throw new Error(`Invalid event command at index ${i}.`);
    }
    cleanEvents.push({
      tick: ev.tick,
      simTimeS: ev.simTimeS,
      command: cmd as unknown as WorkerInboundCommand,
    });
  }

  return {
    version: FLIGHT_RECORDING_VERSION,
    seed: rec.seed,
    initialBiomeId: rec.initialBiomeId as BiomeId,
    createdUtcIso: rec.createdUtcIso,
    durationS: rec.durationS,
    totalTicks: rec.totalTicks,
    finalStateDigestHex: rec.finalStateDigestHex,
    events: cleanEvents,
  };
}

/**
 * Replays a parsed flight recording deterministically in a fresh headless manager instance
 * and verifies bit-exact final state digest parity.
 */
export function replayFlightRecordingHeadless(
  recording: FlightRecordingV1,
  managerFactory: (recording: FlightRecordingV1) => ReplayableSimulationManager
): FlightReplayResult {
  const manager = managerFactory(recording);

  const sortedEvents = recording.events.slice().sort((a, b) => a.tick - b.tick);
  const eventsByTick = new Map<number, WorkerInboundCommand[]>();
  for (let i = 0; i < sortedEvents.length; i++) {
    const ev = sortedEvents[i];
    let list = eventsByTick.get(ev.tick);
    if (!list) {
      list = [];
      eventsByTick.set(ev.tick, list);
    }
    list.push(ev.command);
  }

  const tick0Events = eventsByTick.get(0) ?? [];
  const hasTick0Biome = tick0Events.some((c) => c.type === 'SET_BIOME');
  if (recording.initialBiomeId && recording.initialBiomeId !== 'alpine_mountain' && !hasTick0Biome) {
    manager.handleMessage({ type: 'SET_BIOME', biomeId: recording.initialBiomeId });
  }
  for (let i = 0; i < tick0Events.length; i++) {
    manager.handleMessage(tick0Events[i]);
  }

  for (let t = 1; t <= recording.totalTicks; t++) {
    manager.tickSimulation(t === recording.totalTicks);
    const cmds = eventsByTick.get(t);
    if (cmds) {
      for (let i = 0; i < cmds.length; i++) {
        manager.handleMessage(cmds[i]);
      }
    }
  }

  const finalFrame = manager.lastTelemetryFrame;
  const actualDigest = finalFrame ? computeTelemetryStateDigest(finalFrame) : '';
  return {
    ok: recording.finalStateDigestHex.length > 0 && actualDigest === recording.finalStateDigestHex,
    expectedDigest: recording.finalStateDigestHex,
    actualDigest,
    totalTicks: recording.totalTicks,
  };
}
