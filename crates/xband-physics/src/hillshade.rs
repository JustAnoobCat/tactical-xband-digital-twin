//! 512x512 full-range (0 - 6,500 m) hypsometric Lambertian hillshade RGBA rasterizer.

use crate::dem_raymarch::sample_dem_bilinear;

/// Dark-mode tactical hypsometric base RGB across 0 m - 6,500 m MSL,
/// matching `computeHillshadeHypsometricRgb` in `src/worker/hillshadeGenerator.ts`.
#[inline]
pub fn compute_hillshade_hypsometric_rgb(z: f64) -> [f64; 3] {
    if z <= 0.0 {
        let t_ocean = ((z + 500.0) / 500.0).clamp(0.0, 1.0);
        return [7.0 + t_ocean * 3.0, 18.0 + t_ocean * 8.0, 30.0 + t_ocean * 14.0];
    }
    if z < 5.0 {
        let t = z / 5.0;
        return [12.0 + t * 10.0, 30.0 + t * 6.0, 44.0 - t * 10.0];
    }
    if z < 400.0 {
        let t = (z - 5.0) / 395.0;
        return [22.0 + t * 24.0, 36.0 + t * 14.0, 34.0 + t * 4.0];
    }
    if z < 1500.0 {
        let t = (z - 400.0) / 1100.0;
        return [46.0 - t * 14.0, 50.0 - t * 8.0, 38.0 + t * 6.0];
    }
    if z < 2800.0 {
        let t = (z - 1500.0) / 1300.0;
        return [32.0 - t * 18.0, 42.0 - t * 23.0, 44.0 - t * 16.0];
    }

    let t_elev = ((z - 2800.0) / 3000.0).clamp(0.0, 1.0);
    if t_elev < 0.18 {
        let t = t_elev / 0.18;
        return [14.0 + t * 6.0, 19.0 + t * 7.0, 28.0 + t * 8.0];
    }
    if t_elev < 0.55 {
        let t = (t_elev - 0.18) / 0.37;
        return [20.0 + t * 18.0, 26.0 + t * 22.0, 36.0 + t * 28.0];
    }
    if t_elev < 0.85 {
        let t = (t_elev - 0.55) / 0.30;
        return [38.0 + t * 24.0, 48.0 + t * 28.0, 64.0 + t * 34.0];
    }
    let t_snow = ((z - 5350.0) / 1150.0).clamp(0.0, 1.0);
    [62.0 + t_snow * 25.0, 76.0 + t_snow * 28.0, 98.0 + t_snow * 32.0]
}

/// Rasterizes a square `out_size x out_size` RGBA hillshade image (`out_size * out_size * 4` bytes)
/// from a North-up DEM raster.
#[allow(clippy::too_many_arguments)]
pub fn generate_hillshade_rgba_into(
    dem: &[f32],
    dem_cols: usize,
    dem_rows: usize,
    out_size: usize,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    fallback_min_elev_m: f64,
    elev_scratch: &mut Vec<f64>,
    out_rgba: &mut [u8],
) {
    if out_size < 2 || dem_cols == 0 || dem_rows == 0 || dem.len() < dem_cols * dem_rows {
        return;
    }
    let needed_rgba = out_size * out_size * 4;
    if out_rgba.len() < needed_rgba {
        return;
    }

    let total = out_size * out_size;
    elev_scratch.clear();
    elev_scratch.resize(total, f64::NAN);

    let step_x = (max_x - min_x) / (out_size - 1) as f64;
    let step_y = (max_y - min_y) / (out_size - 1) as f64;

    if out_size == dem_cols && out_size == dem_rows {
        for (dst, &src) in elev_scratch.iter_mut().zip(dem.iter().take(total)) {
            *dst = src as f64;
        }
    } else {
        for r in 0..out_size {
            let y = max_y - (r as f64) * step_y;
            let row_off = r * out_size;
            for c in 0..out_size {
                let x = min_x + (c as f64) * step_x;
                let v = sample_dem_bilinear(dem, dem_cols, dem_rows, min_x, max_x, min_y, max_y, x, y);
                elev_scratch[row_off + c] = if v.is_finite() { v } else { fallback_min_elev_m };
            }
        }
    }

    // Northwest Sun Illumination: Azimuth 315 deg, Altitude 45 deg
    const LX: f64 = -0.5;
    const LY: f64 = 0.5;
    const LZ: f64 = 0.7071;
    const EXAGGERATION: f64 = 2.4;

    for r in 0..out_size {
        let r_prev = r.saturating_sub(1);
        let r_next = (r + 1).min(out_size - 1);
        let row_off = r * out_size;
        let row_prev_off = r_prev * out_size;
        let row_next_off = r_next * out_size;

        for c in 0..out_size {
            let c_prev = c.saturating_sub(1);
            let c_next = (c + 1).min(out_size - 1);
            let out_idx = (row_off + c) * 4;

            let z = elev_scratch[row_off + c];
            if !z.is_finite() {
                out_rgba[out_idx] = 0;
                out_rgba[out_idx + 1] = 0;
                out_rgba[out_idx + 2] = 0;
                out_rgba[out_idx + 3] = 0;
                continue;
            }

            let z_c_next = elev_scratch[row_off + c_next];
            let z_c_prev = elev_scratch[row_off + c_prev];
            let dzdx = if z_c_next.is_finite() && z_c_prev.is_finite() && c_next != c_prev {
                (z_c_next - z_c_prev) / ((c_next - c_prev) as f64 * step_x)
            } else if z_c_next.is_finite() && c_next != c {
                (z_c_next - z) / ((c_next - c) as f64 * step_x)
            } else if z_c_prev.is_finite() && c != c_prev {
                (z - z_c_prev) / ((c - c_prev) as f64 * step_x)
            } else {
                0.0
            };

            let z_r_prev = elev_scratch[row_prev_off + c];
            let z_r_next = elev_scratch[row_next_off + c];
            let dzdy = if z_r_prev.is_finite() && z_r_next.is_finite() && r_next != r_prev {
                (z_r_prev - z_r_next) / ((r_next - r_prev) as f64 * step_y)
            } else if z_r_prev.is_finite() && r != r_prev {
                (z_r_prev - z) / ((r - r_prev) as f64 * step_y)
            } else if z_r_next.is_finite() && r_next != r {
                (z - z_r_next) / ((r_next - r) as f64 * step_y)
            } else {
                0.0
            };

            let nx = -dzdx * EXAGGERATION;
            let ny = -dzdy * EXAGGERATION;
            let nz = 1.0;
            let len_n = (nx * nx + ny * ny + nz * nz).sqrt();

            let dot = (nx * LX + ny * LY + nz * LZ) / len_n;
            let shade = (0.44 + 0.56 * dot).clamp(0.22, 1.0);

            let [r_base, g_base, b_base] = compute_hillshade_hypsometric_rgb(z);
            let red = ((r_base * shade).floor() as i32).clamp(7, 255) as u8;
            let green = ((g_base * shade).floor() as i32).clamp(14, 255) as u8;
            let blue = ((b_base * shade).floor() as i32).clamp(20, 255) as u8;

            out_rgba[out_idx] = red;
            out_rgba[out_idx + 1] = green;
            out_rgba[out_idx + 2] = blue;
            out_rgba[out_idx + 3] = 255;
        }
    }
}

/// Allocates and returns a flat `out_size * out_size * 4` RGBA buffer.
#[allow(clippy::too_many_arguments)]
pub fn generate_hillshade_rgba(
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
    let mut elev_scratch = Vec::new();
    let mut out_rgba = vec![0u8; out_size * out_size * 4];
    generate_hillshade_rgba_into(
        dem,
        dem_cols,
        dem_rows,
        out_size,
        min_x,
        max_x,
        min_y,
        max_y,
        fallback_min_elev_m,
        &mut elev_scratch,
        &mut out_rgba,
    );
    out_rgba
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hypsometric_rgb_ranges() {
        let sea = compute_hillshade_hypsometric_rgb(0.0);
        assert_eq!(sea, [10.0, 26.0, 44.0]);
        let alpine = compute_hillshade_hypsometric_rgb(4000.0);
        assert!(alpine[2] > alpine[0]);
        let snow = compute_hillshade_hypsometric_rgb(6500.0);
        assert!((snow[0] - 87.0).abs() < 1e-9);
    }

    #[test]
    fn test_hillshade_rgba_dimensions_and_nan_handling() {
        let size = 64;
        let mut dem = vec![3800.0f32; size * size];
        dem[0] = f32::NAN;
        for r in 0..size {
            for c in 0..size {
                if r + c > 0 {
                    dem[r * size + c] = 3500.0 + (c as f32) * 15.0;
                }
            }
        }
        let rgba = generate_hillshade_rgba(
            &dem, size, size, size, -50000.0, 50000.0, -50000.0, 50000.0, 0.0,
        );
        assert_eq!(rgba.len(), size * size * 4);
        assert_eq!(&rgba[0..4], &[0, 0, 0, 0]);
        let mid = (32 * size + 32) * 4;
        assert_eq!(rgba[mid + 3], 255);
        assert!(rgba[mid] >= 7 && rgba[mid + 1] >= 14 && rgba[mid + 2] >= 20);
    }
}
