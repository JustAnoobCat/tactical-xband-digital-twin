/* @ts-self-types="./xband_physics.d.ts" */

/**
 * Computes polar viewshed SINR grid + per-bearing horizon elevation angles.
 *
 * `params` packs 29 scalars in fixed order:
 * `[0] r_min_m, [1] r_step_m, [2..5] acn_x, acn_y, acn_z, [5..8] heading, pitch, bank,`
 * `[8] carrier_freq_hz, [9] speed_of_light, [10] bandwidth_hz, [11] acn_gain_dbi,`
 * `[12] acn_nf_db, [13] soldier_tx_dbm, [14] soldier_gain_dbi, [15] cable_loss_db,`
 * `[16] impl_margin_db, [17] k_b, [18] hpbw_az, [19] hpbw_el, [20] downtilt,`
 * `[21] r_eff_m, [22] temp_k, [23] rain_mmh, [24] rain_cell_km, [25] freezing_iso_m,`
 * `[26] jammer_enabled (0/1), [27..31] jammer_sector_0..3` (length 31).
 *
 * Returns `Vec<f32>` of length `num_bearings * num_ranges + num_bearings`:
 * first `num_bearings * num_ranges` entries = `sinr_db`, trailing `num_bearings` = `horizon_elev_deg`.
 * @param {Float32Array | number[]} dem
 * @param {number} cols
 * @param {number} rows
 * @param {number} min_x
 * @param {number} max_x
 * @param {number} min_y
 * @param {number} max_y
 * @param {number} num_bearings
 * @param {number} num_ranges
 * @param {Float64Array | number[]} params
 * @returns {Float32Array}
 */
export function wasm_compute_polar_viewshed(dem, cols, rows, min_x, max_x, min_y, max_y, num_bearings, num_ranges, params) {
    const val3 = +cols;
    const val4 = +rows;
    const val5 = +min_x;
    const val6 = +max_x;
    const val7 = +min_y;
    const val8 = +max_y;
    const val9 = +num_bearings;
    const val10 = +num_ranges;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF32ToWasm0(dem, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 4, 4); }
        throw e;
    }
    const ret = wasm.wasm_compute_polar_viewshed(ptr0, len0, val3, val4, val5, val6, val7, val8, val9, val10, ptr1, len1);
    var v11 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v11;
}

/**
 * @param {Float32Array | number[]} dem
 * @param {number} cols
 * @param {number} rows
 * @param {number} min_x
 * @param {number} max_x
 * @param {number} min_y
 * @param {number} max_y
 * @param {Float64Array | number[]} rays
 * @param {number} wavelength_m
 * @param {number} r_eff_m
 * @param {number} step_interval_m
 * @param {number} pert_std_m
 * @returns {Float64Array}
 */
export function wasm_evaluate_batch_rays(dem, cols, rows, min_x, max_x, min_y, max_y, rays, wavelength_m, r_eff_m, step_interval_m, pert_std_m) {
    const val3 = +cols;
    const val4 = +rows;
    const val5 = +min_x;
    const val6 = +max_x;
    const val7 = +min_y;
    const val8 = +max_y;
    const val9 = +wavelength_m;
    const val10 = +r_eff_m;
    const val11 = +step_interval_m;
    const val12 = +pert_std_m;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF32ToWasm0(dem, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(rays, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 4, 4); }
        throw e;
    }
    const ret = wasm.wasm_evaluate_batch_rays(ptr0, len0, val3, val4, val5, val6, val7, val8, ptr1, len1, val9, val10, val11, val12);
    var v13 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v13;
}

/**
 * @param {Float32Array | number[]} dem
 * @param {number} dem_cols
 * @param {number} dem_rows
 * @param {number} out_size
 * @param {number} min_x
 * @param {number} max_x
 * @param {number} min_y
 * @param {number} max_y
 * @param {number} fallback_min_elev_m
 * @returns {Uint8Array}
 */
export function wasm_generate_hillshade_rgba(dem, dem_cols, dem_rows, out_size, min_x, max_x, min_y, max_y, fallback_min_elev_m) {
    const val2 = +dem_cols;
    const val3 = +dem_rows;
    const val4 = +out_size;
    const val5 = +min_x;
    const val6 = +max_x;
    const val7 = +min_y;
    const val8 = +max_y;
    const val9 = +fallback_min_elev_m;
    const ptr0 = passArrayF32ToWasm0(dem, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.wasm_generate_hillshade_rgba(ptr0, len0, val2, val3, val4, val5, val6, val7, val8, val9);
    var v10 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v10;
}

/**
 * @param {number} v
 * @returns {number}
 */
export function wasm_knife_edge_loss_db(v) {
    const ret = wasm.wasm_knife_edge_loss_db(v);
    return ret;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./xband_physics_bg.js": import0,
    };
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('xband_physics_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
