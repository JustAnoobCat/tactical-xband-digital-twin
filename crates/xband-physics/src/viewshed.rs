//! Polar RF Viewshed kernel matching `PolarViewshedEngine.computeCellSinr()` (fast mode).

use core::f64::consts::PI;

use crate::dem_raymarch::{
    evaluate_ray_diffraction, sample_dem_bilinear, DemGridSpec, DiffractionMode,
};

#[derive(Debug, Clone, Copy)]
pub struct ViewshedParams {
    pub num_bearings: usize,
    pub num_ranges: usize,
    pub r_min_m: f64,
    pub r_step_m: f64,
    pub acn_pos: [f64; 3],
    pub heading_deg: f64,
    pub pitch_deg: f64,
    pub bank_deg: f64,
    pub carrier_freq_hz: f64,
    pub speed_of_light: f64,
    pub channel_bandwidth_hz: f64,
    pub acn_antenna_gain_dbi: f64,
    pub acn_noise_figure_db: f64,
    pub soldier_tx_power_dbm: f64,
    pub soldier_antenna_gain_dbi: f64,
    pub cable_loss_db: f64,
    pub implementation_margin_db: f64,
    pub boltzmann_constant: f64,
    pub hpbw_az_deg: f64,
    pub hpbw_el_deg: f64,
    pub downtilt_deg: f64,
    pub r_eff_m: f64,
    pub atmospheric_temp_k: f64,
    pub rain_rate_mmh: f64,
    pub rain_cell_length_km: f64,
    pub freezing_isotherm_m: f64,
    pub jammer_enabled: bool,
    pub jammer_by_sector: [f64; 4],
}

#[inline]
fn wrap_signed_deg(angle_deg: f64) -> f64 {
    ((angle_deg + 180.0).rem_euclid(360.0)) - 180.0
}

#[inline]
fn world_los_to_body_frame(
    los_east: f64,
    los_north: f64,
    los_up: f64,
    heading_deg: f64,
    pitch_deg: f64,
    bank_deg: f64,
) -> (f64, f64) {
    if !los_east.is_finite() || !los_north.is_finite() || !los_up.is_finite() {
        return (0.0, 0.0);
    }

    let psi = heading_deg.to_radians();
    let theta = pitch_deg.to_radians();
    let phi = bank_deg.to_radians();

    let c_psi = psi.cos();
    let s_psi = psi.sin();
    let c_theta = theta.cos();
    let s_theta = theta.sin();
    let c_phi = phi.cos();
    let s_phi = phi.sin();

    let n = los_north;
    let e = los_east;
    let d = -los_up;

    let body_forward = (c_theta * c_psi) * n + (c_theta * s_psi) * e - s_theta * d;
    let body_right = (s_phi * s_theta * c_psi - c_phi * s_psi) * n
        + (s_phi * s_theta * s_psi + c_phi * c_psi) * e
        + (s_phi * c_theta) * d;
    let body_down = (c_phi * s_theta * c_psi + s_phi * s_psi) * n
        + (c_phi * s_theta * s_psi - s_phi * c_psi) * e
        + (c_phi * c_theta) * d;

    let horiz_mag = body_forward.hypot(body_right);
    let body_azimuth_deg = if horiz_mag > 1e-12 {
        (body_right.atan2(body_forward).to_degrees() + 360.0).rem_euclid(360.0)
    } else {
        0.0
    };

    let total_mag = horiz_mag.hypot(body_down);
    let body_elevation_deg = if total_mag > 1e-12 {
        (-body_down).atan2(horiz_mag).to_degrees()
    } else {
        0.0
    };

    (body_azimuth_deg, body_elevation_deg)
}

#[inline]
fn compute_sector_attenuation_db(
    off_az_deg: f64,
    el_body_deg: f64,
    hpbw_az_deg: f64,
    hpbw_el_deg: f64,
    downtilt_deg: f64,
) -> f64 {
    const MAX_ATTEN_DB: f64 = 25.0;
    let az_ratio = off_az_deg / hpbw_az_deg;
    let az_loss = (12.0 * az_ratio * az_ratio).min(MAX_ATTEN_DB);
    let el_ratio = (el_body_deg - downtilt_deg) / hpbw_el_deg;
    let el_loss = (12.0 * el_ratio * el_ratio).min(MAX_ATTEN_DB);
    (az_loss + el_loss).min(MAX_ATTEN_DB)
}

#[inline]
fn compute_gas_loss_db(slant_dist_m: f64, node_alt_m: f64, acn_alt_m: f64) -> f64 {
    let range_m = slant_dist_m.max(1.0);
    let z1 = node_alt_m.min(acn_alt_m);
    let z2 = node_alt_m.max(acn_alt_m);
    let eta = |alt1: f64, alt2: f64, h: f64| -> f64 {
        let dz = (alt2 - alt1).abs();
        if dz > 10.0 {
            (h / dz) * ((-alt1 / h).exp() - (-alt2 / h).exp())
        } else {
            (-(alt1 + alt2) / (2.0 * h)).exp()
        }
    };
    let eta_o = eta(z1, z2, 6000.0);
    let eta_w = eta(z1, z2, 2000.0);
    ((0.0072 * eta_o + 0.0028 * eta_w) * (range_m / 1000.0)).max(0.0)
}

#[inline]
fn compute_rain_loss_db(
    slant_dist_m: f64,
    rain_rate_mmh: f64,
    rain_cell_length_km: f64,
    node_alt_m: f64,
    acn_alt_m: f64,
    freezing_isotherm_m: f64,
) -> f64 {
    if rain_rate_mmh <= 0.0 || slant_dist_m <= 0.0 {
        return 0.0;
    }
    let gamma_r = 0.00411 * rain_rate_mmh.powf(1.39);
    let rain_path_km = (slant_dist_m / 1000.0).min(rain_cell_length_km);
    let z1 = node_alt_m.min(acn_alt_m);
    let z2 = node_alt_m.max(acn_alt_m);
    let hr = if freezing_isotherm_m.is_finite() {
        freezing_isotherm_m
    } else {
        4800.0
    };
    let f_liquid = if z1 >= hr {
        0.0
    } else if z2 <= hr {
        1.0
    } else {
        let dz = (z2 - z1).abs();
        if dz > 0.0 {
            ((hr - z1) / dz).clamp(0.0, 1.0)
        } else {
            1.0
        }
    };
    (gamma_r * rain_path_km * (f_liquid + 0.08 * (1.0 - f_liquid))).max(0.0)
}

/// Computes the polar RF viewshed sweep (`num_bearings x num_ranges`) into caller-owned slices.
pub fn compute_polar_viewshed_into(
    dem: &DemGridSpec<'_>,
    params: &ViewshedParams,
    out_sinr_db: &mut [f32],
    out_horizon_elev_deg: &mut [f32],
) {
    let nb = params.num_bearings;
    let nr = params.num_ranges;
    if nb == 0 || nr == 0 || out_sinr_db.len() < nb * nr || out_horizon_elev_deg.len() < nb {
        return;
    }

    let wavelength_m = params.speed_of_light / params.carrier_freq_hz.max(1.0);
    let fspl_const = 20.0 * params.carrier_freq_hz.max(1.0).log10()
        + 20.0 * ((4.0 * PI) / params.speed_of_light.max(1.0)).log10();

    let noise_factor = 10.0_f64.powf(params.acn_noise_figure_db / 10.0);
    let p_noise_w = params.boltzmann_constant
        * params.atmospheric_temp_k
        * params.channel_bandwidth_hz
        * noise_factor;
    let p_noise_thermal_dbm = 10.0 * (p_noise_w * 1000.0).log10();
    let deg_step = 360.0 / nb as f64;

    for az_idx in 0..nb {
        let bearing_deg = (az_idx as f64 * deg_step).rem_euclid(360.0);
        let rad = bearing_deg.to_radians();
        let sin_b = rad.sin();
        let cos_b = rad.cos();
        let base_off = az_idx * nr;
        let mut max_horizon_deg = -90.0_f64;

        for r_idx in 0..nr {
            let range_m = params.r_min_m + (r_idx as f64) * params.r_step_m;
            let cell_x = params.acn_pos[0] + range_m * sin_b;
            let cell_y = params.acn_pos[1] + range_m * cos_b;

            let raw_z = sample_dem_bilinear(
                dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y, dem.max_y, cell_x,
                cell_y,
            );
            let z_ground = if raw_z.is_finite() { raw_z } else { 0.0 };
            let cell_z = z_ground + 2.0;

            let elev_deg = (z_ground - params.acn_pos[2]).atan2(range_m.max(1.0)).to_degrees();
            if elev_deg > max_horizon_deg {
                max_horizon_deg = elev_deg;
            }

            let dx = cell_x - params.acn_pos[0];
            let dy = cell_y - params.acn_pos[1];
            let dz = cell_z - params.acn_pos[2];
            let slant_dist_m = dx.hypot(dy).hypot(dz).max(1.0);

            let obs = evaluate_ray_diffraction(
                dem,
                [cell_x, cell_y, cell_z],
                params.acn_pos,
                wavelength_m,
                params.r_eff_m,
                150.0,
                0.0,
                DiffractionMode::TerrainObstruction,
                None,
            );
            let diff_loss_db = if obs.diffraction_loss_db.is_finite() {
                obs.diffraction_loss_db
            } else {
                45.0
            };

            let (body_az_deg, body_el_deg) = world_los_to_body_frame(
                dx,
                dy,
                dz,
                params.heading_deg,
                params.pitch_deg,
                params.bank_deg,
            );

            let mut min_atten_db = f64::INFINITY;
            let mut active_sector = 0usize;
            for s in 0..4 {
                let boresight = (s * 90) as f64;
                let off_az = wrap_signed_deg(body_az_deg - boresight);
                let atten = compute_sector_attenuation_db(
                    off_az,
                    body_el_deg,
                    params.hpbw_az_deg,
                    params.hpbw_el_deg,
                    params.downtilt_deg,
                );
                if atten < min_atten_db {
                    min_atten_db = atten;
                    active_sector = s;
                }
            }
            let rx_gain_dbi = params.acn_antenna_gain_dbi - min_atten_db;

            let fspl_db = 20.0 * slant_dist_m.log10() + fspl_const;
            let gas_loss_db = compute_gas_loss_db(slant_dist_m, cell_z, params.acn_pos[2]);
            let rain_loss_db = compute_rain_loss_db(
                slant_dist_m,
                params.rain_rate_mmh,
                params.rain_cell_length_km,
                cell_z,
                params.acn_pos[2],
                params.freezing_isotherm_m,
            );
            let total_loss_db = fspl_db
                + diff_loss_db
                + gas_loss_db
                + rain_loss_db
                + params.cable_loss_db
                + params.implementation_margin_db;

            let prx_dbm =
                params.soldier_tx_power_dbm + params.soldier_antenna_gain_dbi + rx_gain_dbi
                    - total_loss_db;

            let a_atm = gas_loss_db + rain_loss_db;
            let sky_temp_k = 275.0 * (1.0 - 10.0_f64.powf(-a_atm / 10.0));
            let sky_noise_increase_db =
                10.0 * (1.0 + sky_temp_k / (290.0 * noise_factor)).log10();
            let p_noise_dbm = p_noise_thermal_dbm + sky_noise_increase_db;

            let mut p_noise_and_interf_dbm = p_noise_dbm;
            if params.jammer_enabled {
                let j_dbm = params.jammer_by_sector[active_sector];
                if j_dbm.is_finite() {
                    let p_noise_mw = 10.0_f64.powf(p_noise_dbm / 10.0);
                    let p_jammer_mw = 10.0_f64.powf(j_dbm / 10.0);
                    p_noise_and_interf_dbm = 10.0 * (p_noise_mw + p_jammer_mw).log10();
                }
            }

            out_sinr_db[base_off + r_idx] = (prx_dbm - p_noise_and_interf_dbm) as f32;
        }
        out_horizon_elev_deg[az_idx] = max_horizon_deg as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dem_raymarch::DEFAULT_R_EFF_M;

    #[test]
    fn test_polar_viewshed_flat_and_ridge_shadow() {
        let size = 128;
        let mut dem_data = vec![3200.0f32; size * size];
        // Ridge to the North (y > 4000 m) rising to 5400 m
        for r in 0..size {
            let y = 30000.0 - (r as f64 / (size - 1) as f64) * 60000.0;
            let dist_to_ridge = (y - 5000.0).abs();
            let prof = (1.0 - dist_to_ridge / 1500.0).max(0.0);
            let z = (3200.0 + 2200.0 * prof) as f32;
            for c in 0..size {
                dem_data[r * size + c] = z;
            }
        }
        let dem = DemGridSpec {
            data: &dem_data,
            cols: size,
            rows: size,
            min_x: -30000.0,
            max_x: 30000.0,
            min_y: -30000.0,
            max_y: 30000.0,
        };
        let params = ViewshedParams {
            num_bearings: 36,
            num_ranges: 16,
            r_min_m: 1500.0,
            r_step_m: 1500.0,
            acn_pos: [0.0, 0.0, 4800.0],
            heading_deg: 0.0,
            pitch_deg: 0.0,
            bank_deg: 0.0,
            carrier_freq_hz: 8.0e9,
            speed_of_light: 299_792_458.0,
            channel_bandwidth_hz: 1.0e6,
            acn_antenna_gain_dbi: 16.0,
            acn_noise_figure_db: 5.0,
            soldier_tx_power_dbm: 36.0,
            soldier_antenna_gain_dbi: 3.0,
            cable_loss_db: 1.5,
            implementation_margin_db: 2.5,
            boltzmann_constant: 1.380_649e-23,
            hpbw_az_deg: 90.0,
            hpbw_el_deg: 65.0,
            downtilt_deg: -15.0,
            r_eff_m: DEFAULT_R_EFF_M,
            atmospheric_temp_k: 290.0,
            rain_rate_mmh: 0.0,
            rain_cell_length_km: 10.0,
            freezing_isotherm_m: 4200.0,
            jammer_enabled: false,
            jammer_by_sector: [-150.0; 4],
        };

        let mut sinr = vec![0.0f32; 36 * 16];
        let mut horizon = vec![0.0f32; 36];
        compute_polar_viewshed_into(&dem, &params, &mut sinr, &mut horizon);

        // North bearing (az=0), range 15 km (r_idx=9) is shadowed behind 5400 m ridge
        let shadowed = sinr[9];
        // East bearing (az=9), range 15 km (r_idx=9) is open valley
        let open_valley = sinr[9 * 16 + 9];
        assert!(shadowed.is_finite() && open_valley.is_finite());
        assert!(open_valley - shadowed > 15.0, "open={open_valley}, shadowed={shadowed}");
        assert!(horizon[0] > horizon[9]);
    }
}
