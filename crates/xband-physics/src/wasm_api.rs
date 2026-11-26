//! WebAssembly bindings (`wasm-bindgen`) for `xband-physics`.

use wasm_bindgen::prelude::*;

use crate::dem_raymarch::{evaluate_batch_rays, itu_knife_edge_loss_db, DemGridSpec};
use crate::hillshade::generate_hillshade_rgba;
use crate::viewshed::{compute_polar_viewshed_into, ViewshedParams};

#[wasm_bindgen]
pub fn wasm_knife_edge_loss_db(v: f64) -> f64 {
    itu_knife_edge_loss_db(v)
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn wasm_evaluate_batch_rays(
    dem: &[f32],
    cols: usize,
    rows: usize,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    rays: &[f64],
    wavelength_m: f64,
    r_eff_m: f64,
    step_interval_m: f64,
    pert_std_m: f64,
) -> Vec<f64> {
    let ray_count = rays.len() / 6;
    let mut out = vec![0.0f64; ray_count * 4];
    let spec = DemGridSpec {
        data: dem,
        cols,
        rows,
        min_x,
        max_x,
        min_y,
        max_y,
    };
    evaluate_batch_rays(
        &spec,
        rays,
        wavelength_m,
        r_eff_m,
        step_interval_m,
        pert_std_m,
        &mut out,
    );
    out
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn wasm_generate_hillshade_rgba(
    dem: &[f32],
    dem_cols: usize,
    dem_rows: usize,
    out_size: usize,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    fallback_min_elev_m: f64,
) -> Vec<u8> {
    generate_hillshade_rgba(
        dem,
        dem_cols,
        dem_rows,
        out_size,
        min_x,
        max_x,
        min_y,
        max_y,
        fallback_min_elev_m,
    )
}

/// Computes polar viewshed SINR grid + per-bearing horizon elevation angles.
///
/// `params` packs 29 scalars in fixed order:
/// `[0] r_min_m, [1] r_step_m, [2..5] acn_x, acn_y, acn_z, [5..8] heading, pitch, bank,`
/// `[8] carrier_freq_hz, [9] speed_of_light, [10] bandwidth_hz, [11] acn_gain_dbi,`
/// `[12] acn_nf_db, [13] soldier_tx_dbm, [14] soldier_gain_dbi, [15] cable_loss_db,`
/// `[16] impl_margin_db, [17] k_b, [18] hpbw_az, [19] hpbw_el, [20] downtilt,`
/// `[21] r_eff_m, [22] temp_k, [23] rain_mmh, [24] rain_cell_km, [25] freezing_iso_m,`
/// `[26] jammer_enabled (0/1), [27..31] jammer_sector_0..3` (length 31).
///
/// Returns `Vec<f32>` of length `num_bearings * num_ranges + num_bearings`:
/// first `num_bearings * num_ranges` entries = `sinr_db`, trailing `num_bearings` = `horizon_elev_deg`.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn wasm_compute_polar_viewshed(
    dem: &[f32],
    cols: usize,
    rows: usize,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    num_bearings: usize,
    num_ranges: usize,
    params: &[f64],
) -> Vec<f32> {
    if params.len() < 31 || num_bearings == 0 || num_ranges == 0 {
        return Vec::new();
    }
    let vp = ViewshedParams {
        num_bearings,
        num_ranges,
        r_min_m: params[0],
        r_step_m: params[1],
        acn_pos: [params[2], params[3], params[4]],
        heading_deg: params[5],
        pitch_deg: params[6],
        bank_deg: params[7],
        carrier_freq_hz: params[8],
        speed_of_light: params[9],
        channel_bandwidth_hz: params[10],
        acn_antenna_gain_dbi: params[11],
        acn_noise_figure_db: params[12],
        soldier_tx_power_dbm: params[13],
        soldier_antenna_gain_dbi: params[14],
        cable_loss_db: params[15],
        implementation_margin_db: params[16],
        boltzmann_constant: params[17],
        hpbw_az_deg: params[18],
        hpbw_el_deg: params[19],
        downtilt_deg: params[20],
        r_eff_m: params[21],
        atmospheric_temp_k: params[22],
        rain_rate_mmh: params[23],
        rain_cell_length_km: params[24],
        freezing_isotherm_m: params[25],
        jammer_enabled: params[26] > 0.5,
        jammer_by_sector: [params[27], params[28], params[29], params[30]],
    };
    let grid_len = num_bearings * num_ranges;
    let mut out = vec![0.0f32; grid_len + num_bearings];
    let (sinr_slice, horizon_slice) = out.split_at_mut(grid_len);
    let spec = DemGridSpec {
        data: dem,
        cols,
        rows,
        min_x,
        max_x,
        min_y,
        max_y,
    };
    compute_polar_viewshed_into(&spec, &vp, sinr_slice, horizon_slice);
    out
}
