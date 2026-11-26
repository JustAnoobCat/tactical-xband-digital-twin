/**
 * Typed TypeScript bridge to the compiled `xband-physics` WebAssembly module.
 *
 * Invariants:
 * - Zero `eval` / `new Function` (compatible with strict `'self' 'wasm-unsafe-eval' blob:` CSP).
 * - Safe in Web Workers, browser main thread, and Node (`tsx` / `vite-node`).
 * - Graceful `null` returns when WASM has not been initialized so callers fall back
 *   seamlessly to the authoritative pure-TypeScript engine in `src/core/`.
 */

import initWasm, {
  initSync,
  wasm_compute_polar_viewshed,
  wasm_compute_polar_viewshed_slice,
  wasm_evaluate_batch_rays,
  wasm_generate_hillshade_rgba,
  wasm_knife_edge_loss_db,
  type InitInput,
  type SyncInitInput,
} from '../wasm/xband_physics/xband_physics.js';

let wasmReady = false;
let initInFlight: Promise<boolean> | null = null;

export function isWasmPhysicsReady(): boolean {
  return wasmReady;
}

/**
 * Asynchronously initializes the `xband-physics` WASM module.
 * Never throws; returns `false` if WASM cannot be loaded so pure-TS fallback remains active.
 */
export async function initWasmPhysics(wasmBytesOrUrl?: InitInput): Promise<boolean> {
  if (wasmReady) return true;
  if (initInFlight && wasmBytesOrUrl === undefined) {
    return initInFlight;
  }

  const run = async (): Promise<boolean> => {
    try {
      if (wasmBytesOrUrl !== undefined) {
        await initWasm({ module_or_path: wasmBytesOrUrl });
      } else {
        await initWasm();
      }
      wasmReady = true;
      return true;
    } catch {
      wasmReady = false;
      return false;
    } finally {
      if (wasmBytesOrUrl === undefined) {
        initInFlight = null;
      }
    }
  };

  if (wasmBytesOrUrl === undefined) {
    initInFlight = run();
    return initInFlight;
  }
  return run();
}

/**
 * Synchronously initializes the `xband-physics` WASM module from raw bytes or a compiled
 * `WebAssembly.Module` (ideal for Node / `tsx` / `vite-node` parity tests).
 */
export function initWasmPhysicsSync(wasmBytes: SyncInitInput): boolean {
  if (wasmReady) return true;
  try {
    initSync({ module: wasmBytes });
    wasmReady = true;
    return true;
  } catch {
    wasmReady = false;
    return false;
  }
}

export function wasmKnifeEdgeLossDb(v: number): number | null {
  if (!wasmReady) return null;
  return wasm_knife_edge_loss_db(v);
}

export function wasmEvaluateBatchRays(
  dem: Float32Array,
  cols: number,
  rows: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  rays: Float64Array,
  wavelengthM: number,
  rEffM: number,
  stepIntervalM: number,
  pertStdM: number = 0.0
): Float64Array | null {
  if (!wasmReady) return null;
  return wasm_evaluate_batch_rays(
    dem,
    cols,
    rows,
    minX,
    maxX,
    minY,
    maxY,
    rays,
    wavelengthM,
    rEffM,
    stepIntervalM,
    pertStdM
  );
}

export function wasmGenerateHillshadeRgba(
  dem: Float32Array,
  demCols: number,
  demRows: number,
  outSize: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  fallbackMinElevM: number = 0.0
): Uint8Array | null {
  if (!wasmReady) return null;
  return wasm_generate_hillshade_rgba(
    dem,
    demCols,
    demRows,
    outSize,
    minX,
    maxX,
    minY,
    maxY,
    fallbackMinElevM
  );
}

export interface WasmPolarViewshedParams {
  readonly numBearings: number;
  readonly numRanges: number;
  readonly rMinM: number;
  readonly rStepM: number;
  readonly acnPos: readonly [number, number, number];
  readonly headingDeg: number;
  readonly pitchDeg: number;
  readonly bankDeg: number;
  readonly carrierFreqHz: number;
  readonly speedOfLight: number;
  readonly channelBandwidthHz: number;
  readonly acnAntennaGainDbi: number;
  readonly acnNoiseFigureDb: number;
  readonly soldierTxPowerDbm: number;
  readonly soldierAntennaGainDbi: number;
  readonly cableLossDb: number;
  readonly implementationMarginDb: number;
  readonly boltzmannConstant: number;
  readonly hpbwAzDeg: number;
  readonly hpbwElDeg: number;
  readonly downtiltDeg: number;
  readonly rEffM: number;
  readonly atmosphericTempK: number;
  readonly rainRateMmH: number;
  readonly rainCellLengthKm: number;
  readonly freezingIsothermM: number;
  readonly jammerEnabled: boolean;
  readonly jammerBySector?: readonly [number, number, number, number];
}

const SHARED_VIEWSHED_PARAMS = new Float64Array(31);

function packViewshedParams(p: WasmPolarViewshedParams): Float64Array {
  const arr = SHARED_VIEWSHED_PARAMS;
  arr[0] = p.rMinM;
  arr[1] = p.rStepM;
  arr[2] = p.acnPos[0];
  arr[3] = p.acnPos[1];
  arr[4] = p.acnPos[2];
  arr[5] = p.headingDeg;
  arr[6] = p.pitchDeg;
  arr[7] = p.bankDeg;
  arr[8] = p.carrierFreqHz;
  arr[9] = p.speedOfLight;
  arr[10] = p.channelBandwidthHz;
  arr[11] = p.acnAntennaGainDbi;
  arr[12] = p.acnNoiseFigureDb;
  arr[13] = p.soldierTxPowerDbm;
  arr[14] = p.soldierAntennaGainDbi;
  arr[15] = p.cableLossDb;
  arr[16] = p.implementationMarginDb;
  arr[17] = p.boltzmannConstant;
  arr[18] = p.hpbwAzDeg;
  arr[19] = p.hpbwElDeg;
  arr[20] = p.downtiltDeg;
  arr[21] = p.rEffM;
  arr[22] = p.atmosphericTempK;
  arr[23] = p.rainRateMmH;
  arr[24] = p.rainCellLengthKm;
  arr[25] = p.freezingIsothermM;
  arr[26] = p.jammerEnabled ? 1.0 : 0.0;
  const jb = p.jammerBySector;
  arr[27] = jb ? jb[0] : -150.0;
  arr[28] = jb ? jb[1] : -150.0;
  arr[29] = jb ? jb[2] : -150.0;
  arr[30] = jb ? jb[3] : -150.0;
  return arr;
}

export function wasmComputePolarViewshed(
  dem: Float32Array,
  cols: number,
  rows: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  p: WasmPolarViewshedParams
): Float32Array | null {
  if (!wasmReady) return null;
  const arr = packViewshedParams(p);

  return wasm_compute_polar_viewshed(
    dem,
    cols,
    rows,
    minX,
    maxX,
    minY,
    maxY,
    p.numBearings,
    p.numRanges,
    arr
  );
}

export function wasmComputePolarViewshedSlice(
  dem: Float32Array,
  cols: number,
  rows: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  startBearing: number,
  bearingCount: number,
  p: WasmPolarViewshedParams
): Float32Array | null {
  if (!wasmReady) return null;
  const nb = Math.max(0, Math.trunc(p.numBearings));
  const count = Math.max(0, Math.trunc(bearingCount));
  if (nb === 0 || count === 0) return new Float32Array(0);
  const normStart = ((Math.trunc(startBearing) % nb) + nb) % nb;
  const arr = packViewshedParams(p);

  return wasm_compute_polar_viewshed_slice(
    dem,
    cols,
    rows,
    minX,
    maxX,
    minY,
    maxY,
    nb,
    p.numRanges,
    normStart,
    count,
    arr
  );
}
