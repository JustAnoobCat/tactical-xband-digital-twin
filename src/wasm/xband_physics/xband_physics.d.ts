/* tslint:disable */
/* eslint-disable */

/**
 * Computes polar viewshed SINR grid + per-bearing horizon elevation angles.
 *
 * `params` packs 31 scalars in fixed order:
 * `[0] r_min_m, [1] r_step_m, [2..5] acn_x, acn_y, acn_z, [5..8] heading, pitch, bank,`
 * `[8] carrier_freq_hz, [9] speed_of_light, [10] bandwidth_hz, [11] acn_gain_dbi,`
 * `[12] acn_nf_db, [13] soldier_tx_dbm, [14] soldier_gain_dbi, [15] cable_loss_db,`
 * `[16] impl_margin_db, [17] k_b, [18] hpbw_az, [19] hpbw_el, [20] downtilt,`
 * `[21] r_eff_m, [22] temp_k, [23] rain_mmh, [24] rain_cell_km, [25] freezing_iso_m,`
 * `[26] jammer_enabled (0/1), [27..31] jammer_sector_0..3` (length 31).
 *
 * Returns `Vec<f32>` of length `num_bearings * num_ranges + num_bearings`:
 * first `num_bearings * num_ranges` entries = `sinr_db`, trailing `num_bearings` = `horizon_elev_deg`.
 */
export function wasm_compute_polar_viewshed(dem: Float32Array | number[], cols: number, rows: number, min_x: number, max_x: number, min_y: number, max_y: number, num_bearings: number, num_ranges: number, params: Float64Array | number[]): Float32Array;

/**
 * Computes an incremental slice `[start_bearing, start_bearing + bearing_count)` (mod `num_bearings`)
 * of the polar viewshed SINR grid + horizon elevation angles.
 *
 * Returns `Vec<f32>` of length `bearing_count * num_ranges + bearing_count`.
 */
export function wasm_compute_polar_viewshed_slice(dem: Float32Array | number[], cols: number, rows: number, min_x: number, max_x: number, min_y: number, max_y: number, num_bearings: number, num_ranges: number, start_bearing: number, bearing_count: number, params: Float64Array | number[]): Float32Array;

export function wasm_evaluate_batch_rays(dem: Float32Array | number[], cols: number, rows: number, min_x: number, max_x: number, min_y: number, max_y: number, rays: Float64Array | number[], wavelength_m: number, r_eff_m: number, step_interval_m: number, pert_std_m: number): Float64Array;

export function wasm_generate_hillshade_rgba(dem: Float32Array | number[], dem_cols: number, dem_rows: number, out_size: number, min_x: number, max_x: number, min_y: number, max_y: number, fallback_min_elev_m: number): Uint8Array;

export function wasm_knife_edge_loss_db(v: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly wasm_compute_polar_viewshed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number];
    readonly wasm_compute_polar_viewshed_slice: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
    readonly wasm_evaluate_batch_rays: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
    readonly wasm_generate_hillshade_rgba: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly wasm_knife_edge_loss_db: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
