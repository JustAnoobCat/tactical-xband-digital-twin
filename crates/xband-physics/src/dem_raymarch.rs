//! Shared DEM bilinear sampling, ITU-R P.526 diffraction, and zero-allocation ray-marching.

use core::f64::consts::PI;

pub const DEFAULT_X_BAND_WAVELENGTH_M: f64 = 299_792_458.0 / 8.0e9;
pub const DEFAULT_K_FACTOR: f64 = 4.0 / 3.0;
pub const DEFAULT_TRUE_EARTH_RADIUS_M: f64 = 6_371_000.0;
pub const DEFAULT_R_EFF_M: f64 = DEFAULT_K_FACTOR * DEFAULT_TRUE_EARTH_RADIUS_M;

/// Maximum profile samples supported on-stack / reusable scratch without heap allocation.
pub const MAX_RAY_PROFILE_SAMPLES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffractionMode {
    /// Exact parity with `TerrainEngine.evaluateTerrainObstruction` on DEM-only rays
    /// (0.6 F1 LOS threshold, Bullington double-horizon + rounded-crest curvature T(m, n)).
    TerrainObstruction = 0,
    /// Pure profile single-edge J(max(nu)).
    SingleEdge = 1,
    /// Pure profile ITU-R P.526 §4.5.1 Bullington equivalent knife-edge.
    Bullington = 2,
    /// Pure profile Cascaded Deygout multi-edge with anti-shoulder valley guard.
    DeygoutMultiEdge = 3,
}

#[derive(Debug, Clone, Copy)]
pub struct DemGridSpec<'a> {
    pub data: &'a [f32],
    pub cols: usize,
    pub rows: usize,
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct RayDiffractionOutput {
    pub is_los: bool,
    pub is_coverage_complete: bool,
    pub diffraction_loss_db: f64,
    pub min_clearance_m: f64,
    pub fresnel_radius_m: f64,
    pub max_v: f64,
    pub crest_radius_m: f64,
    pub curvature_loss_db: f64,
}

/// Reusable scratch buffers for multi-edge profile diffraction (zero per-ray heap churn).
#[derive(Debug, Clone)]
pub struct RayMarchScratch {
    pub distances_m: Vec<f64>,
    pub elevations_m: Vec<f64>,
}

impl Default for RayMarchScratch {
    fn default() -> Self {
        Self::new(MAX_RAY_PROFILE_SAMPLES)
    }
}

impl RayMarchScratch {
    pub fn new(capacity: usize) -> Self {
        Self {
            distances_m: Vec::with_capacity(capacity),
            elevations_m: Vec::with_capacity(capacity),
        }
    }
}

/// ITU-R P.526-15 Eq. (14) single knife-edge diffraction loss J(v) in dB.
#[inline]
pub fn itu_knife_edge_loss_db(v: f64) -> f64 {
    if !v.is_finite() {
        return f64::NAN;
    }
    if v <= -0.78 {
        return 0.0;
    }
    let vm = v - 0.1;
    let term = (vm * vm + 1.0).sqrt() + vm;
    let loss = 6.9 + 20.0 * term.max(1e-6).log10();
    loss.max(0.0)
}

#[inline]
pub fn compute_earth_bulge_m(d1_m: f64, d2_m: f64, r_eff_m: f64) -> f64 {
    if r_eff_m <= 0.0 || d1_m <= 0.0 || d2_m <= 0.0 {
        return 0.0;
    }
    (d1_m * d2_m) / (2.0 * r_eff_m)
}

/// Exact North-up (`row 0 = max_y`, `col 0 = min_x`) bilinear DEM sampler with void handling,
/// matching `TerrainEngine.interpolateDemGrid`.
#[inline]
pub fn sample_dem_bilinear(
    dem: &[f32],
    cols: usize,
    rows: usize,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    x: f64,
    y: f64,
) -> f64 {
    if cols == 0
        || rows == 0
        || dem.len() < cols * rows
        || !x.is_finite()
        || !y.is_finite()
        || x < min_x
        || x > max_x
        || y < min_y
        || y > max_y
    {
        return f64::NAN;
    }

    let span_x = max_x - min_x;
    let span_y = max_y - min_y;
    let u = if span_x > 0.0 {
        (x - min_x) / span_x
    } else {
        0.0
    };
    let v = if span_y > 0.0 {
        (max_y - y) / span_y
    } else {
        0.0
    };

    let max_c = (cols - 1) as f64;
    let max_r = (rows - 1) as f64;
    let c_float = (u * max_c).clamp(0.0, max_c);
    let r_float = (v * max_r).clamp(0.0, max_r);

    let c0 = c_float.floor() as usize;
    let r0 = r_float.floor() as usize;
    let c1 = (c0 + 1).min(cols - 1);
    let r1 = (r0 + 1).min(rows - 1);

    let fc = c_float - c0 as f64;
    let fr = r_float - r0 as f64;

    let v00 = dem[r0 * cols + c0] as f64;
    let v01 = dem[r0 * cols + c1] as f64;
    let v10 = dem[r1 * cols + c0] as f64;
    let v11 = dem[r1 * cols + c1] as f64;

    let ok00 = v00.is_finite() && v00 != -32768.0;
    let ok01 = v01.is_finite() && v01 != -32768.0;
    let ok10 = v10.is_finite() && v10 != -32768.0;
    let ok11 = v11.is_finite() && v11 != -32768.0;

    if ok00 && ok01 && ok10 && ok11 {
        let top = v00 * (1.0 - fc) + v01 * fc;
        let bot = v10 * (1.0 - fc) + v11 * fc;
        return top * (1.0 - fr) + bot * fr;
    }

    let w00 = (1.0 - fc) * (1.0 - fr);
    let w01 = fc * (1.0 - fr);
    let w10 = (1.0 - fc) * fr;
    let w11 = fc * fr;

    let mut total_w = 0.0;
    let mut weighted = 0.0;
    if ok00 {
        total_w += w00;
        weighted += w00 * v00;
    }
    if ok01 {
        total_w += w01;
        weighted += w01 * v01;
    }
    if ok10 {
        total_w += w10;
        weighted += w10 * v10;
    }
    if ok11 {
        total_w += w11;
        weighted += w11 * v11;
    }

    if total_w > 1e-6 {
        weighted / total_w
    } else {
        f64::NAN
    }
}

/// ITU-R P.526-15 §4.2 Rounded-Crest Curvature Attenuation T(m, n) (dB).
#[inline]
pub fn compute_crest_curvature_loss_db(
    crest_radius_m: f64,
    d1_m: f64,
    d2_m: f64,
    h_obs_m: f64,
    wavelength_m: f64,
) -> f64 {
    if d1_m <= 0.0 || d2_m <= 0.0 || wavelength_m <= 0.0 {
        return 0.0;
    }
    let r_crest = crest_radius_m.clamp(0.5, 2000.0);
    let nu = h_obs_m * ((2.0 / wavelength_m) * (1.0 / d1_m + 1.0 / d2_m)).sqrt();
    if nu <= -0.78 {
        return 0.0;
    }

    let h_obs = h_obs_m.max(0.0);
    let m = r_crest.powf(2.0 / 3.0)
        * ((d1_m + d2_m) / (d1_m * d2_m))
        * (wavelength_m / PI).powf(1.0 / 3.0);
    let n = h_obs * r_crest.powf(-1.0 / 3.0) * (PI / wavelength_m).powf(2.0 / 3.0);
    let mn = m * n;
    let t_val = if mn <= 4.0 {
        7.2 * m.sqrt() - (2.0 - 12.5 * n) * m + 3.6 * m.powf(1.5) - 0.8 * m * m
    } else {
        -6.0 - 20.0 * mn.max(1e-9).log10()
            + 7.2 * m.sqrt()
            - (2.0 - 17.0 * n) * m
            + 3.6 * m.powf(1.5)
            - 0.8 * m * m
    };
    let base_loss = t_val.clamp(0.0, 20.0);
    if nu < 0.0 {
        let grazing = ((nu + 0.78) / 0.78).powi(2).clamp(0.0, 1.0);
        (base_loss * grazing).clamp(0.0, 20.0)
    } else {
        base_loss
    }
}

#[inline]
fn compute_terrain_knife_edge_loss_db(
    h_penetration_m: f64,
    d1_m: f64,
    d2_m: f64,
    wavelength_m: f64,
) -> f64 {
    let nu = h_penetration_m * ((2.0 / wavelength_m) * (1.0 / d1_m + 1.0 / d2_m)).sqrt();
    let vm = nu - 0.1;
    let arg = (vm * vm + 1.0).sqrt() + vm;
    6.9 + 20.0 * arg.max(1e-9).log10()
}

#[inline]
fn compute_bullington_apex(
    z_tx: f64,
    z_rx: f64,
    d3d: f64,
    s_tx_max: f64,
    s_rx_max: f64,
    s_tx_dist_m: f64,
    s_rx_dist_m: f64,
) -> (f64, f64, f64) {
    let denom = (s_tx_max + s_rx_max).max(1e-9);
    let s_min = s_tx_dist_m.min(s_rx_dist_m);
    let s_max = s_tx_dist_m.max(s_rx_dist_m);
    let s_bull = ((z_rx - z_tx + s_rx_max * d3d) / denom).clamp(s_min, s_max);
    let z_bull = z_tx + s_tx_max * s_bull;
    let z_los_bull = z_tx + (s_bull / d3d) * (z_rx - z_tx);
    let h_bull = z_bull - z_los_bull;
    (s_bull, z_bull, h_bull)
}

/// ITU-R P.526-15 §4.5.1 Bullington profile diffraction (matches `computeBullingtonDiffraction`).
pub fn compute_bullington_profile(
    distances_m: &[f64],
    elevations_m: &[f64],
    wavelength_m: f64,
    r_eff_m: f64,
) -> (f64, f64, bool) {
    let n = distances_m.len().min(elevations_m.len());
    if n < 3 {
        return (0.0, -999.0, true);
    }
    let d0 = distances_m[0];
    let total_d = distances_m[n - 1] - d0;
    if total_d <= 1e-3 {
        return (0.0, -999.0, true);
    }
    let h0 = elevations_m[0];
    let hn = elevations_m[n - 1];
    let inv_2reff = if r_eff_m > 0.0 {
        1.0 / (2.0 * r_eff_m)
    } else {
        0.0
    };
    let s_tr = (hn - h0) / total_d;

    let mut s_tim = f64::NEG_INFINITY;
    let mut s_tim_dist = 0.5 * total_d;
    let mut max_nu_los = f64::NEG_INFINITY;

    for i in 1..(n - 1) {
        let di = distances_m[i] - d0;
        if di <= 0.0 || di >= total_d {
            continue;
        }
        let d_minus_di = total_d - di;
        let bulge = di * d_minus_di * inv_2reff;
        let h_eff = elevations_m[i] + bulge;
        let s_ti = (h_eff - h0) / di;
        if s_ti > s_tim {
            s_tim = s_ti;
            s_tim_dist = di;
        }
        let h_los = h0 + (di / total_d) * (hn - h0);
        let h_obs = h_eff - h_los;
        let nu = h_obs * ((2.0 / wavelength_m) * (1.0 / di + 1.0 / d_minus_di)).sqrt();
        if nu > max_nu_los {
            max_nu_los = nu;
        }
    }

    if s_tim < s_tr {
        let loss = itu_knife_edge_loss_db(max_nu_los);
        return (loss, max_nu_los, max_nu_los <= -0.78);
    }

    let mut s_rim = f64::NEG_INFINITY;
    for i in 1..(n - 1) {
        let di = distances_m[i] - d0;
        if di <= 0.0 || di >= total_d {
            continue;
        }
        let d_minus_di = total_d - di;
        let bulge = di * d_minus_di * inv_2reff;
        let h_eff = elevations_m[i] + bulge;
        let s_ri = (h_eff - hn) / d_minus_di;
        if s_ri > s_rim {
            s_rim = s_ri;
        }
    }

    let denom = s_tim + s_rim;
    let mut d_bull = if denom > 1e-12 {
        (hn - h0 + s_rim * total_d) / denom
    } else {
        s_tim_dist
    };
    d_bull = d_bull.clamp(1e-3, total_d - 1e-3);
    let h_bull = h0 + s_tim * d_bull;
    let h_los_at_apex = h0 + (d_bull / total_d) * (hn - h0);
    let h_apex_obs = h_bull - h_los_at_apex;
    let nu_bull =
        h_apex_obs * ((2.0 / wavelength_m) * (1.0 / d_bull + 1.0 / (total_d - d_bull))).sqrt();
    (itu_knife_edge_loss_db(nu_bull), nu_bull, false)
}

/// ITU-R P.526 Cascaded Deygout Multi-Edge Diffraction with anti-shoulder valley guard
/// (matches `computeDeygoutMultiEdgeDiffraction`).
pub fn compute_deygout_multiedge_profile(
    distances_m: &[f64],
    elevations_m: &[f64],
    wavelength_m: f64,
    r_eff_m: f64,
) -> (f64, f64, usize) {
    let n = distances_m.len().min(elevations_m.len());
    if n < 3 {
        return (0.0, -999.0, 0);
    }
    let d0 = distances_m[0];
    let total_d = distances_m[n - 1] - d0;
    if total_d <= 1e-3 {
        return (0.0, -999.0, 0);
    }

    let h0 = elevations_m[0];
    let hn = elevations_m[n - 1];
    let inv_2reff = if r_eff_m > 0.0 {
        1.0 / (2.0 * r_eff_m)
    } else {
        0.0
    };

    let mut nu_m = f64::NEG_INFINITY;
    let mut m: Option<usize> = None;
    let mut d_m = 0.0;
    let mut h_eff_m = h0;

    for i in 1..(n - 1) {
        let di = distances_m[i] - d0;
        if di <= 0.0 || di >= total_d {
            continue;
        }
        let d_minus_di = total_d - di;
        let bulge = di * d_minus_di * inv_2reff;
        let h_eff = elevations_m[i] + bulge;
        let h_los = h0 + (di / total_d) * (hn - h0);
        let h_obs = h_eff - h_los;
        let nu = h_obs * ((2.0 / wavelength_m) * (1.0 / di + 1.0 / d_minus_di)).sqrt();
        if nu > nu_m {
            nu_m = nu;
            m = Some(i);
            d_m = di;
            h_eff_m = h_eff;
        }
    }

    let Some(m_idx) = m else {
        return (0.0, nu_m, 0);
    };
    if nu_m <= -0.78 || m_idx == 0 {
        return (0.0, nu_m, 0);
    }

    let primary_loss_db = itu_knife_edge_loss_db(nu_m);
    let (bullington_loss_db, _, _) =
        compute_bullington_profile(distances_m, elevations_m, wavelength_m, r_eff_m);

    // Left secondary edge with anti-shoulder valley guard
    let mut s1_idx: Option<usize> = None;
    let mut s1_nu = f64::NEG_INFINITY;
    if m_idx >= 2 && d_m > 1e-3 {
        for i in 1..m_idx {
            let hi = elevations_m[i];
            if hi < elevations_m[i - 1] || hi < elevations_m[i + 1] {
                continue;
            }
            let min_peak = hi.min(elevations_m[m_idx]);
            let has_valley = ((i + 1)..m_idx).any(|k| elevations_m[k] < min_peak - 1e-4);
            if !has_valley {
                continue;
            }
            let d1a = distances_m[i] - d0;
            let d1b = d_m - d1a;
            if d1a <= 0.0 || d1b <= 0.0 {
                continue;
            }
            let sub_bulge = (d1a * d1b) * inv_2reff;
            let h_sub_eff = hi + sub_bulge;
            let h_sub_chord = h0 + (d1a / d_m) * (h_eff_m - h0);
            let nu_sub = (h_sub_eff - h_sub_chord)
                * ((2.0 / wavelength_m) * (1.0 / d1a + 1.0 / d1b)).sqrt();
            if nu_sub > s1_nu {
                s1_nu = nu_sub;
                s1_idx = Some(i);
            }
        }
    }

    // Right secondary edge with anti-shoulder valley guard
    let mut s2_idx: Option<usize> = None;
    let mut s2_nu = f64::NEG_INFINITY;
    let d2_total = total_d - d_m;
    if m_idx + 2 < n && d2_total > 1e-3 {
        for j in (m_idx + 1)..(n - 1) {
            let hj = elevations_m[j];
            if hj < elevations_m[j - 1] || hj < elevations_m[j + 1] {
                continue;
            }
            let min_peak = hj.min(elevations_m[m_idx]);
            let has_valley = ((m_idx + 1)..j).any(|k| elevations_m[k] < min_peak - 1e-4);
            if !has_valley {
                continue;
            }
            let d2a = (distances_m[j] - d0) - d_m;
            let d2b = d2_total - d2a;
            if d2a <= 0.0 || d2b <= 0.0 {
                continue;
            }
            let sub_bulge = (d2a * d2b) * inv_2reff;
            let h_sub_eff = hj + sub_bulge;
            let h_sub_chord = h_eff_m + (d2a / d2_total) * (hn - h_eff_m);
            let nu_sub = (h_sub_eff - h_sub_chord)
                * ((2.0 / wavelength_m) * (1.0 / d2a + 1.0 / d2b)).sqrt();
            if nu_sub > s2_nu {
                s2_nu = nu_sub;
                s2_idx = Some(j);
            }
        }
    }

    let mut secondary_count = 0usize;
    let mut eff_left = 0.0;
    if let Some(idx1) = s1_idx {
        if s1_nu > -0.78 {
            secondary_count += 1;
            let l1 = itu_knife_edge_loss_db(s1_nu);
            let d_sep1 = d_m - (distances_m[idx1] - d0);
            let c1 = l1 * (-3.5 * (d_sep1 / d_m)).exp();
            eff_left = (l1 - c1).max(0.0);
        }
    }

    let mut eff_right = 0.0;
    if let Some(idx2) = s2_idx {
        if s2_nu > -0.78 {
            secondary_count += 1;
            let l2 = itu_knife_edge_loss_db(s2_nu);
            let d_sep2 = (distances_m[idx2] - d0) - d_m;
            let c2 = l2 * (-3.5 * (d_sep2 / d2_total)).exp();
            eff_right = (l2 - c2).max(0.0);
        }
    }

    let total_loss = if secondary_count > 0 {
        let raw = primary_loss_db + eff_left + eff_right;
        primary_loss_db.max(bullington_loss_db).max(raw.min(60.0))
    } else {
        primary_loss_db
    };

    (total_loss, nu_m, secondary_count)
}

#[inline]
fn apply_perturbation(h_terrain: f64, x: f64, y: f64, pert_std_m: f64) -> f64 {
    if pert_std_m > 0.0 && h_terrain.is_finite() {
        h_terrain
            + pert_std_m
                * (0.013 * x + 0.017 * y).sin()
                * (0.011 * x - 0.019 * y).cos()
    } else {
        h_terrain
    }
}

/// Evaluates terrain diffraction along a 3D ray over a DEM raster with zero per-ray heap allocation.
pub fn evaluate_ray_diffraction(
    dem: &DemGridSpec<'_>,
    node_pos: [f64; 3],
    acn_pos: [f64; 3],
    wavelength_m: f64,
    r_eff_m: f64,
    step_interval_m: f64,
    elevation_perturbation_std_m: f64,
    mode: DiffractionMode,
    scratch: Option<&mut RayMarchScratch>,
) -> RayDiffractionOutput {
    let [nx, ny, nz] = node_pos;
    let [ax, ay, az] = acn_pos;
    let dx = ax - nx;
    let dy = ay - ny;
    let dz = az - nz;
    let d3d = dx.hypot(dy).hypot(dz);

    if !nx.is_finite()
        || !ny.is_finite()
        || !nz.is_finite()
        || !ax.is_finite()
        || !ay.is_finite()
        || !az.is_finite()
        || !d3d.is_finite()
        || nx < dem.min_x
        || nx > dem.max_x
        || ny < dem.min_y
        || ny > dem.max_y
        || ax < dem.min_x
        || ax > dem.max_x
        || ay < dem.min_y
        || ay > dem.max_y
    {
        return RayDiffractionOutput {
            is_los: false,
            is_coverage_complete: false,
            diffraction_loss_db: f64::NAN,
            min_clearance_m: f64::NAN,
            fresnel_radius_m: f64::NAN,
            max_v: f64::NAN,
            crest_radius_m: 2000.0,
            curvature_loss_db: 0.0,
        };
    }

    if d3d < 1e-3 {
        let h_terrain = sample_dem_bilinear(
            dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y, dem.max_y, nx, ny,
        );
        if !h_terrain.is_finite() {
            return RayDiffractionOutput {
                is_los: false,
                is_coverage_complete: false,
                diffraction_loss_db: f64::NAN,
                min_clearance_m: f64::NAN,
                fresnel_radius_m: f64::NAN,
                max_v: f64::NAN,
                crest_radius_m: 2000.0,
                curvature_loss_db: 0.0,
            };
        }
        let h_clear = nz - h_terrain;
        return RayDiffractionOutput {
            is_los: h_clear >= 0.0,
            is_coverage_complete: true,
            diffraction_loss_db: 0.0,
            min_clearance_m: h_clear,
            fresnel_radius_m: 0.0,
            max_v: -999.0,
            crest_radius_m: 2000.0,
            curvature_loss_db: 0.0,
        };
    }

    let step = step_interval_m.max(1.0);

    // Optional profile-based modes using caller-supplied reusable scratch (zero heap churn)
    if mode != DiffractionMode::TerrainObstruction {
        if let Some(buf) = scratch {
            buf.distances_m.clear();
            buf.elevations_m.clear();
            buf.distances_m.push(0.0);
            buf.elevations_m.push(nz);

            let mut min_clear_m = f64::INFINITY;
            let mut min_r1_m = 0.0;
            let mut min_ratio = f64::INFINITY;
            let mut max_v = f64::NEG_INFINITY;

            if d3d <= step * 2.0 {
                let d1 = 0.5 * d3d;
                let d2 = d3d - d1;
                let sx = nx + 0.5 * dx;
                let sy = ny + 0.5 * dy;
                let h_t = apply_perturbation(
                    sample_dem_bilinear(
                        dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y, dem.max_y,
                        sx, sy,
                    ),
                    sx,
                    sy,
                    elevation_perturbation_std_m,
                );
                if !h_t.is_finite() {
                    return RayDiffractionOutput {
                        is_los: false,
                        is_coverage_complete: false,
                        diffraction_loss_db: f64::NAN,
                        min_clearance_m: f64::NAN,
                        fresnel_radius_m: f64::NAN,
                        max_v: f64::NAN,
                        crest_radius_m: 2000.0,
                        curvature_loss_db: 0.0,
                    };
                }
                buf.distances_m.push(d1);
                buf.elevations_m.push(h_t);
                let bulge = compute_earth_bulge_m(d1, d2, r_eff_m);
                let h_clear = (nz + 0.5 * dz) - (h_t + bulge);
                let r1 = ((wavelength_m * d1 * d2) / d3d).sqrt();
                min_clear_m = h_clear;
                min_r1_m = r1;
                min_ratio = h_clear / r1;
                max_v = (-h_clear) * ((2.0 / wavelength_m) * (1.0 / d1 + 1.0 / d2)).sqrt();
            } else {
                let mut d1 = step;
                while d1 < d3d && buf.distances_m.len() + 1 < MAX_RAY_PROFILE_SAMPLES {
                    let d2 = d3d - d1;
                    let frac = d1 / d3d;
                    let sx = nx + frac * dx;
                    let sy = ny + frac * dy;
                    let h_t = apply_perturbation(
                        sample_dem_bilinear(
                            dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y,
                            dem.max_y, sx, sy,
                        ),
                        sx,
                        sy,
                        elevation_perturbation_std_m,
                    );
                    if !h_t.is_finite() {
                        return RayDiffractionOutput {
                            is_los: false,
                            is_coverage_complete: false,
                            diffraction_loss_db: f64::NAN,
                            min_clearance_m: f64::NAN,
                            fresnel_radius_m: f64::NAN,
                            max_v: f64::NAN,
                            crest_radius_m: 2000.0,
                            curvature_loss_db: 0.0,
                        };
                    }
                    buf.distances_m.push(d1);
                    buf.elevations_m.push(h_t);

                    let bulge = compute_earth_bulge_m(d1, d2, r_eff_m);
                    let h_clear = (nz + frac * dz) - (h_t + bulge);
                    let r1 = ((wavelength_m * d1 * d2) / d3d).sqrt();
                    let ratio = h_clear / r1;
                    if ratio < min_ratio {
                        min_ratio = ratio;
                        min_clear_m = h_clear;
                        min_r1_m = r1;
                    }
                    let nu = (-h_clear) * ((2.0 / wavelength_m) * (1.0 / d1 + 1.0 / d2)).sqrt();
                    if nu > max_v {
                        max_v = nu;
                    }
                    d1 += step;
                }
            }

            buf.distances_m.push(d3d);
            buf.elevations_m.push(az);

            let (loss_db, nu_out) = match mode {
                DiffractionMode::SingleEdge => (itu_knife_edge_loss_db(max_v), max_v),
                DiffractionMode::Bullington => {
                    let (l, nu, _) = compute_bullington_profile(
                        &buf.distances_m,
                        &buf.elevations_m,
                        wavelength_m,
                        r_eff_m,
                    );
                    (l, nu)
                }
                DiffractionMode::DeygoutMultiEdge => {
                    let (l, nu, _) = compute_deygout_multiedge_profile(
                        &buf.distances_m,
                        &buf.elevations_m,
                        wavelength_m,
                        r_eff_m,
                    );
                    (l, nu)
                }
                DiffractionMode::TerrainObstruction => unreachable!(),
            };
            return RayDiffractionOutput {
                is_los: min_ratio > 0.0,
                is_coverage_complete: true,
                diffraction_loss_db: loss_db,
                min_clearance_m: min_clear_m,
                fresnel_radius_m: min_r1_m,
                max_v: nu_out,
                crest_radius_m: 2000.0,
                curvature_loss_db: 0.0,
            };
        }
    }

    // Standard zero-allocation TerrainEngine.evaluateTerrainObstruction kernel
    let mut min_clearance_ratio = f64::INFINITY;
    let mut min_clearance_m = 0.0;
    let mut crit_fresnel_radius_m = 0.0;
    let mut crit_d1 = d3d * 0.5;
    let mut crit_d2 = d3d * 0.5;
    let mut i_peak: isize = -1;
    let total_steps: isize;

    let mut s_tx_max = f64::NEG_INFINITY;
    let mut s_rx_max = f64::NEG_INFINITY;
    let mut s_tx_dist_m = 0.0;
    let mut s_rx_dist_m = 0.0;
    let mut i_tx: isize = -1;
    let mut i_rx: isize = -1;
    let mut max_nu = f64::NEG_INFINITY;

    if d3d <= step * 2.0 {
        let d1 = d3d * 0.5;
        let d2 = d3d - d1;
        let frac = 0.5;
        let sx = nx + frac * dx;
        let sy = ny + frac * dy;
        let h_terrain = apply_perturbation(
            sample_dem_bilinear(
                dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y, dem.max_y, sx, sy,
            ),
            sx,
            sy,
            elevation_perturbation_std_m,
        );
        if !h_terrain.is_finite() {
            return RayDiffractionOutput {
                is_los: false,
                is_coverage_complete: false,
                diffraction_loss_db: f64::NAN,
                min_clearance_m: f64::NAN,
                fresnel_radius_m: f64::NAN,
                max_v: f64::NAN,
                crest_radius_m: 2000.0,
                curvature_loss_db: 0.0,
            };
        }
        let earth_bulge = compute_earth_bulge_m(d1, d2, r_eff_m);
        let h_terrain_eff = h_terrain + earth_bulge;
        let h_los = nz + frac * dz;
        let h_clear = h_los - h_terrain_eff;
        let r1 = ((wavelength_m * d1 * d2) / d3d).sqrt();
        min_clearance_ratio = h_clear / r1;
        min_clearance_m = h_clear;
        crit_fresnel_radius_m = r1;
        crit_d1 = d1;
        crit_d2 = d2;
        i_peak = 1;
        total_steps = 1;
        s_tx_max = (h_terrain_eff - nz) / d1;
        s_tx_dist_m = d1;
        i_tx = 1;
        s_rx_max = (h_terrain_eff - az) / d2;
        s_rx_dist_m = d1;
        i_rx = 1;
        max_nu = (-h_clear) * ((2.0 / wavelength_m) * (1.0 / d1 + 1.0 / d2)).sqrt();
    } else {
        let mut step_idx: isize = 0;
        let mut d1 = step;
        while d1 < d3d {
            step_idx += 1;
            let d2 = d3d - d1;
            let frac = d1 / d3d;
            let sx = nx + frac * dx;
            let sy = ny + frac * dy;
            let h_terrain = apply_perturbation(
                sample_dem_bilinear(
                    dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y, dem.max_y, sx,
                    sy,
                ),
                sx,
                sy,
                elevation_perturbation_std_m,
            );
            if !h_terrain.is_finite() {
                return RayDiffractionOutput {
                    is_los: false,
                    is_coverage_complete: false,
                    diffraction_loss_db: f64::NAN,
                    min_clearance_m: f64::NAN,
                    fresnel_radius_m: f64::NAN,
                    max_v: f64::NAN,
                    crest_radius_m: 2000.0,
                    curvature_loss_db: 0.0,
                };
            }
            let earth_bulge = compute_earth_bulge_m(d1, d2, r_eff_m);
            let h_terrain_eff = h_terrain + earth_bulge;
            let h_los = nz + frac * dz;
            let h_clear = h_los - h_terrain_eff;
            let r1 = ((wavelength_m * d1 * d2) / d3d).sqrt();
            let ratio = h_clear / r1;
            if ratio < min_clearance_ratio {
                min_clearance_ratio = ratio;
                min_clearance_m = h_clear;
                crit_fresnel_radius_m = r1;
                crit_d1 = d1;
                crit_d2 = d2;
                i_peak = step_idx;
            }
            let nu = (-h_clear) * ((2.0 / wavelength_m) * (1.0 / d1 + 1.0 / d2)).sqrt();
            if nu > max_nu {
                max_nu = nu;
            }
            let s_tx = (h_terrain_eff - nz) / d1;
            if s_tx > s_tx_max {
                s_tx_max = s_tx;
                s_tx_dist_m = d1;
                i_tx = step_idx;
            }
            let s_rx = (h_terrain_eff - az) / d2;
            if s_rx > s_rx_max {
                s_rx_max = s_rx;
                s_rx_dist_m = d1;
                i_rx = step_idx;
            }
            d1 += step;
        }
        total_steps = step_idx;
    }

    let diffraction_loss_db: f64;
    let is_los: bool;
    let mut crest_radius_m = 2000.0;
    let mut curvature_loss_db = 0.0;

    if min_clearance_ratio >= 0.6 {
        diffraction_loss_db = 0.0;
        is_los = true;
    } else if min_clearance_ratio > 0.0 {
        diffraction_loss_db = 6.0 * (1.0 - min_clearance_ratio / 0.6);
        is_los = true;
    } else {
        is_los = false;
        let mut knife_edge_loss = 0.0;
        let mut used_bullington = false;

        if i_tx != i_rx && i_tx != -1 && i_rx != -1 {
            let (s_bull, _z_bull, h_bull) = compute_bullington_apex(
                nz, az, d3d, s_tx_max, s_rx_max, s_tx_dist_m, s_rx_dist_m,
            );
            if h_bull > 0.0 {
                knife_edge_loss =
                    compute_terrain_knife_edge_loss_db(h_bull, s_bull, d3d - s_bull, wavelength_m);
                used_bullington = true;
            }
        }
        if !used_bullington {
            knife_edge_loss =
                compute_terrain_knife_edge_loss_db(-min_clearance_m, crit_d1, crit_d2, wavelength_m);
        }

        if i_peak > 1
            && i_peak < total_steps
            && crit_d1 - step > 0.0
            && crit_d1 + step < d3d
        {
            let s_prev = crit_d1 - step;
            let s_next = crit_d1 + step;
            let x_prev = nx + (s_prev / d3d) * dx;
            let y_prev = ny + (s_prev / d3d) * dy;
            let x_next = nx + (s_next / d3d) * dx;
            let y_next = ny + (s_next / d3d) * dy;
            let x_peak = nx + (crit_d1 / d3d) * dx;
            let y_peak = ny + (crit_d1 / d3d) * dy;

            let z_t_prev = apply_perturbation(
                sample_dem_bilinear(
                    dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y, dem.max_y,
                    x_prev, y_prev,
                ),
                x_prev,
                y_prev,
                elevation_perturbation_std_m,
            );
            let z_t_peak = apply_perturbation(
                sample_dem_bilinear(
                    dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y, dem.max_y,
                    x_peak, y_peak,
                ),
                x_peak,
                y_peak,
                elevation_perturbation_std_m,
            );
            let z_t_next = apply_perturbation(
                sample_dem_bilinear(
                    dem.data, dem.cols, dem.rows, dem.min_x, dem.max_x, dem.min_y, dem.max_y,
                    x_next, y_next,
                ),
                x_next,
                y_next,
                elevation_perturbation_std_m,
            );

            if z_t_prev.is_finite() && z_t_peak.is_finite() && z_t_next.is_finite() {
                let z_prev = z_t_prev + compute_earth_bulge_m(s_prev, d3d - s_prev, r_eff_m);
                let z_peak = z_t_peak + compute_earth_bulge_m(crit_d1, crit_d2, r_eff_m);
                let z_next = z_t_next + compute_earth_bulge_m(s_next, d3d - s_next, r_eff_m);

                let z_prime = (z_next - z_prev) / (2.0 * step);
                let z_double_prime = (z_prev - 2.0 * z_peak + z_next) / (step * step);
                if z_double_prime < 0.0 {
                    let denom_curv = (-z_double_prime).max(5e-4);
                    let r_val = (1.0 + z_prime * z_prime).powf(1.5) / denom_curv;
                    crest_radius_m = r_val.clamp(0.5, 2000.0);
                    let h_obs = (-min_clearance_m).max(0.0);
                    curvature_loss_db = compute_crest_curvature_loss_db(
                        crest_radius_m,
                        crit_d1,
                        crit_d2,
                        h_obs,
                        wavelength_m,
                    );
                }
            }
        }
        diffraction_loss_db = knife_edge_loss + curvature_loss_db;
    }

    RayDiffractionOutput {
        is_los,
        is_coverage_complete: true,
        diffraction_loss_db,
        min_clearance_m,
        fresnel_radius_m: crit_fresnel_radius_m,
        max_v: max_nu,
        crest_radius_m,
        curvature_loss_db,
    }
}

/// Evaluates `N` rays in a single contiguous call.
///
/// `rays` has length `N * 6`, packed as `[nx, ny, nz, ax, ay, az]` per ray.
/// `out_results` has length `N * 4`, written as `[is_los (1.0/0.0), diffraction_loss_db, min_clearance_m, max_v]` per ray.
pub fn evaluate_batch_rays(
    dem: &DemGridSpec<'_>,
    rays: &[f64],
    wavelength_m: f64,
    r_eff_m: f64,
    step_interval_m: f64,
    elevation_perturbation_std_m: f64,
    out_results: &mut [f64],
) -> usize {
    let ray_count = (rays.len() / 6).min(out_results.len() / 4);
    for idx in 0..ray_count {
        let base = idx * 6;
        let res = evaluate_ray_diffraction(
            dem,
            [rays[base], rays[base + 1], rays[base + 2]],
            [rays[base + 3], rays[base + 4], rays[base + 5]],
            wavelength_m,
            r_eff_m,
            step_interval_m,
            elevation_perturbation_std_m,
            DiffractionMode::TerrainObstruction,
            None,
        );
        let obase = idx * 4;
        out_results[obase] = if res.is_los { 1.0 } else { 0.0 };
        out_results[obase + 1] = res.diffraction_loss_db;
        out_results[obase + 2] = res.min_clearance_m;
        out_results[obase + 3] = res.max_v;
    }
    ray_count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_flat_dem(cols: usize, rows: usize, elev_m: f32) -> Vec<f32> {
        vec![elev_m; cols * rows]
    }

    #[test]
    fn test_itu_knife_edge_loss_db() {
        assert_eq!(itu_knife_edge_loss_db(-0.78), 0.0);
        assert_eq!(itu_knife_edge_loss_db(-2.0), 0.0);
        let l0 = itu_knife_edge_loss_db(0.0);
        assert!((l0 - 6.0328522).abs() < 1e-6, "J(0)={l0}");
        let l2 = itu_knife_edge_loss_db(2.0);
        assert!((l2 - 19.0428595).abs() < 1e-6, "J(2)={l2}");
    }

    #[test]
    fn test_sample_dem_bilinear_corners_and_voids() {
        let dem = vec![100.0f32, 200.0, 300.0, 400.0];
        // row 0 = max_y = 100.0, row 1 = min_y = -100.0; col 0 = min_x = -100.0, col 1 = max_x = 100.0
        assert!((sample_dem_bilinear(&dem, 2, 2, -100.0, 100.0, -100.0, 100.0, -100.0, 100.0) - 100.0).abs() < 1e-9);
        assert!((sample_dem_bilinear(&dem, 2, 2, -100.0, 100.0, -100.0, 100.0, 100.0, -100.0) - 400.0).abs() < 1e-9);
        assert!((sample_dem_bilinear(&dem, 2, 2, -100.0, 100.0, -100.0, 100.0, 0.0, 0.0) - 250.0).abs() < 1e-9);
        assert!(sample_dem_bilinear(&dem, 2, 2, -100.0, 100.0, -100.0, 100.0, 101.0, 0.0).is_nan());

        let dem_void = vec![100.0f32, -32768.0, 300.0, 400.0];
        let v = sample_dem_bilinear(&dem_void, 2, 2, -100.0, 100.0, -100.0, 100.0, 0.0, 0.0);
        assert!((v - (800.0 / 3.0)).abs() < 1e-6);
    }

    #[test]
    fn test_ray_diffraction_los_ridge_and_batch() {
        let cols = 128;
        let rows = 128;
        let mut dem_data = make_flat_dem(cols, rows, 3000.0);
        // Put a sharp mountain ridge at x = 0 across all y
        for r in 0..rows {
            for c in 0..cols {
                let x = -20000.0 + (c as f64 / (cols - 1) as f64) * 40000.0;
                let ridge = 1800.0 * (-(x / 1200.0).powi(2)).exp();
                dem_data[r * cols + c] = 3000.0 + ridge as f32;
            }
        }
        let dem = DemGridSpec {
            data: &dem_data,
            cols,
            rows,
            min_x: -20000.0,
            max_x: 20000.0,
            min_y: -20000.0,
            max_y: 20000.0,
        };

        // Clear LOS parallel to ridge at x = -10000
        let clear = evaluate_ray_diffraction(
            &dem,
            [-10000.0, -5000.0, 3002.0],
            [-10000.0, 5000.0, 5000.0],
            DEFAULT_X_BAND_WAVELENGTH_M,
            DEFAULT_R_EFF_M,
            100.0,
            0.0,
            DiffractionMode::TerrainObstruction,
            None,
        );
        assert!(clear.is_los);
        assert_eq!(clear.diffraction_loss_db, 0.0);

        // Blocked across ridge at x = 0 (ridge ~4800 m, ray at 3200 -> 4500 m)
        let blocked = evaluate_ray_diffraction(
            &dem,
            [-8000.0, 0.0, 3200.0],
            [8000.0, 0.0, 4500.0],
            DEFAULT_X_BAND_WAVELENGTH_M,
            DEFAULT_R_EFF_M,
            100.0,
            0.0,
            DiffractionMode::TerrainObstruction,
            None,
        );
        assert!(!blocked.is_los);
        assert!(blocked.diffraction_loss_db > 20.0);
        assert!(blocked.min_clearance_m < 0.0);

        // Batch evaluation matches individual calls
        let rays = [
            -10000.0, -5000.0, 3002.0, -10000.0, 5000.0, 5000.0,
            -8000.0, 0.0, 3200.0, 8000.0, 0.0, 4500.0,
        ];
        let mut out = [0.0; 8];
        let count = evaluate_batch_rays(
            &dem,
            &rays,
            DEFAULT_X_BAND_WAVELENGTH_M,
            DEFAULT_R_EFF_M,
            100.0,
            0.0,
            &mut out,
        );
        assert_eq!(count, 2);
        assert_eq!(out[0], 1.0);
        assert_eq!(out[1], clear.diffraction_loss_db);
        assert_eq!(out[4], 0.0);
        assert!((out[5] - blocked.diffraction_loss_db).abs() < 1e-12);
    }

    #[test]
    fn test_deygout_anti_shoulder_and_two_edges() {
        let mut scratch = RayMarchScratch::default();
        // Two distinct knife edges separated by a valley
        let d = [0.0, 3000.0, 4500.0, 7000.0, 10000.0];
        let z = [0.0, 60.0, 5.0, 60.0, 0.0];
        let (bull_loss, _, _) = compute_bullington_profile(&d, &z, DEFAULT_X_BAND_WAVELENGTH_M, DEFAULT_R_EFF_M);
        let (deyg_loss, _, sec_cnt) = compute_deygout_multiedge_profile(&d, &z, DEFAULT_X_BAND_WAVELENGTH_M, DEFAULT_R_EFF_M);
        assert_eq!(sec_cnt, 1);
        assert!(deyg_loss >= bull_loss);

        // Verify zero-heap-allocation profile evaluation via evaluate_ray_diffraction
        let dem_data = vec![3000.0f32; 64 * 64];
        let dem = DemGridSpec {
            data: &dem_data,
            cols: 64,
            rows: 64,
            min_x: -10000.0,
            max_x: 10000.0,
            min_y: -10000.0,
            max_y: 10000.0,
        };
        let out = evaluate_ray_diffraction(
            &dem,
            [-5000.0, 0.0, 3002.0],
            [5000.0, 0.0, 4500.0],
            DEFAULT_X_BAND_WAVELENGTH_M,
            DEFAULT_R_EFF_M,
            100.0,
            0.0,
            DiffractionMode::DeygoutMultiEdge,
            Some(&mut scratch),
        );
        assert!(out.is_coverage_complete);
        assert_eq!(out.diffraction_loss_db, 0.0);
    }
}
