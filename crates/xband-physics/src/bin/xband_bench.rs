//! Multi-core native Rust benchmark CLI (`xband_bench`) using Rayon.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use rayon::prelude::*;

use xband_physics::dem_raymarch::{
    evaluate_ray_diffraction, sample_dem_bilinear, DemGridSpec, DiffractionMode, DEFAULT_R_EFF_M,
    DEFAULT_X_BAND_WAVELENGTH_M,
};
use xband_physics::hillshade::generate_hillshade_rgba;
use xband_physics::viewshed::{compute_polar_viewshed_into, ViewshedParams};

const DEM_SIZE: usize = 512;
const LADAKH_HALF_W_M: f64 = 91_839.9774;
const LADAKH_HALF_H_M: f64 = 110_931.4506;

fn generate_synthetic_dem() -> Vec<f32> {
    let mut out = vec![0.0f32; DEM_SIZE * DEM_SIZE];
    for r in 0..DEM_SIZE {
        let y = LADAKH_HALF_H_M - (r as f64 / (DEM_SIZE - 1) as f64) * (2.0 * LADAKH_HALF_H_M);
        for c in 0..DEM_SIZE {
            let x = -LADAKH_HALF_W_M + (c as f64 / (DEM_SIZE - 1) as f64) * (2.0 * LADAKH_HALF_W_M);
            let ridge = 1800.0 * (-(x / 4500.0).powi(2)).exp();
            let undul = 450.0 * (x / 11_000.0).sin() * (y / 13_000.0).cos();
            out[r * DEM_SIZE + c] = (3200.0 + ridge + undul) as f32;
        }
    }
    out
}

fn load_dem(dem_path: Option<&str>, use_synthetic: bool) -> (Vec<f32>, &'static str) {
    if use_synthetic {
        return (generate_synthetic_dem(), "synthetic");
    }
    let path = dem_path
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("public/terrain/real_ladakh_dem.bin"));
    match fs::read(&path) {
        Ok(bytes) if bytes.len() >= DEM_SIZE * DEM_SIZE * 4 => {
            let mut dem = Vec::with_capacity(DEM_SIZE * DEM_SIZE);
            for chunk in bytes[..(DEM_SIZE * DEM_SIZE * 4)].chunks_exact(4) {
                dem.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
            }
            (dem, "real_ladakh_dem.bin")
        }
        _ => (generate_synthetic_dem(), "synthetic_fallback"),
    }
}

#[inline]
fn next_u32(state: &mut u32) -> u32 {
    *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    *state
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut seeds: usize = 100;
    let mut nodes: usize = 128;
    let mut use_synthetic = false;
    let mut dem_path: Option<String> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--seeds" if i + 1 < args.len() => {
                seeds = args[i + 1].parse().unwrap_or(100).max(1);
                i += 2;
            }
            "--nodes" if i + 1 < args.len() => {
                nodes = args[i + 1].parse().unwrap_or(128).max(1);
                i += 2;
            }
            "--synthetic" => {
                use_synthetic = true;
                i += 1;
            }
            "--dem" if i + 1 < args.len() => {
                dem_path = Some(args[i + 1].clone());
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    let (dem, dem_source) = load_dem(dem_path.as_deref(), use_synthetic);
    let spec = DemGridSpec {
        data: &dem,
        cols: DEM_SIZE,
        rows: DEM_SIZE,
        min_x: -LADAKH_HALF_W_M,
        max_x: LADAKH_HALF_W_M,
        min_y: -LADAKH_HALF_H_M,
        max_y: LADAKH_HALF_H_M,
    };

    // Deterministic seeded ray workload (N seeds * M nodes)
    let total_rays = seeds * nodes;
    let mut ray_table: Vec<[f64; 6]> = Vec::with_capacity(total_rays);
    for s in 0..seeds {
        let mut rng = (s as u32).wrapping_add(1).wrapping_mul(0x9E37_79B9);
        let theta = (s as f64) * 0.17;
        let acn_x = 12_000.0 * theta.cos();
        let acn_y = 12_000.0 * theta.sin();
        let acn_z = 5_400.0;
        for _n in 0..nodes {
            let rx = (next_u32(&mut rng) as f64 / u32::MAX as f64) * 2.0 - 1.0;
            let ry = (next_u32(&mut rng) as f64 / u32::MAX as f64) * 2.0 - 1.0;
            let nx = rx * 45_000.0;
            let ny = ry * 45_000.0;
            let gz = sample_dem_bilinear(
                spec.data,
                spec.cols,
                spec.rows,
                spec.min_x,
                spec.max_x,
                spec.min_y,
                spec.max_y,
                nx,
                ny,
            );
            let nz = (if gz.is_finite() { gz } else { 3200.0 }) + 2.0;
            ray_table.push([nx, ny, nz, acn_x, acn_y, acn_z]);
        }
    }

    // 1. Multi-core parallel terrain diffraction ray-march
    let t_rays = Instant::now();
    let losses: Vec<f64> = ray_table
        .par_iter()
        .map(|r| {
            let out = evaluate_ray_diffraction(
                &spec,
                [r[0], r[1], r[2]],
                [r[3], r[4], r[5]],
                DEFAULT_X_BAND_WAVELENGTH_M,
                DEFAULT_R_EFF_M,
                100.0,
                0.0,
                DiffractionMode::TerrainObstruction,
                None,
            );
            if out.diffraction_loss_db.is_finite() {
                out.diffraction_loss_db
            } else {
                0.0
            }
        })
        .collect();
    let rays_elapsed_s = t_rays.elapsed().as_secs_f64();
    let us_per_ray = (rays_elapsed_s * 1e6) / total_rays as f64;
    let ms_per_128_node_tick = (us_per_ray * 128.0) / 1000.0;

    // 2. 512x512 Hillshade benchmark
    let t_hs = Instant::now();
    let hs_rgba = generate_hillshade_rgba(
        &dem,
        DEM_SIZE,
        DEM_SIZE,
        DEM_SIZE,
        spec.min_x,
        spec.max_x,
        spec.min_y,
        spec.max_y,
        0.0,
    );
    let hillshade_ms = t_hs.elapsed().as_secs_f64() * 1000.0;

    // 3. 360-deg Polar Viewshed benchmark
    let vp = ViewshedParams {
        num_bearings: 36,
        num_ranges: 16,
        r_min_m: 1500.0,
        r_step_m: 1500.0,
        acn_pos: [0.0, 0.0, 5200.0],
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
    let t_vs = Instant::now();
    let mut sinr_grid = vec![0.0f32; 36 * 16];
    let mut horizon_deg = vec![0.0f32; 36];
    compute_polar_viewshed_into(&spec, &vp, &mut sinr_grid, &mut horizon_deg);
    let viewshed_ms = t_vs.elapsed().as_secs_f64() * 1000.0;

    // Deterministic order-independent checksum over ray losses + hillshade + viewshed
    let mut checksum_f64: f64 = 0.0;
    for (idx, &v) in losses.iter().enumerate() {
        checksum_f64 += v * (1.0 + (idx % 7) as f64 * 1e-4);
    }
    for &b in hs_rgba.iter().step_by(64) {
        checksum_f64 += b as f64 * 1e-3;
    }
    for &s in &sinr_grid {
        checksum_f64 += s as f64 * 1e-2;
    }

    println!(
        "{{\n  \"dem_source\": \"{}\",\n  \"threads\": {},\n  \"seeds\": {},\n  \"nodes\": {},\n  \"total_rays\": {},\n  \"rays_elapsed_ms\": {:.3},\n  \"us_per_ray\": {:.4},\n  \"ms_per_128_node_tick\": {:.4},\n  \"hillshade_ms\": {:.3},\n  \"viewshed_ms\": {:.3},\n  \"checksum_f64\": {:.6}\n}}",
        dem_source,
        rayon::current_num_threads(),
        seeds,
        nodes,
        total_rays,
        rays_elapsed_s * 1000.0,
        us_per_ray,
        ms_per_128_node_tick,
        hillshade_ms,
        viewshed_ms,
        checksum_f64
    );
}
