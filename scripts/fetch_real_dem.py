#!/usr/bin/env python3
"""
scripts/fetch_real_dem.py - Real Satellite DEM Acquisition via AWS Terrarium
Tactical X-Band Air-to-Ground Network Digital Twin

Downloads real satellite elevation tiles from the open AWS Terrarium Terrain-RGB bucket
(MapLibre / Nextzen open data source), decodes the RGB elevation equations, stitches the tiles,
interpolates to a 512x512 matrix over the Ladakh/Kargil bounding box,
and exports:
  1. data/terrain/ladakh_real_dem.npy (NumPy array for Python/benchmarks)
  2. public/terrain/real_ladakh_dem.bin (Raw Float32 binary for Vite & WebWorker)
"""

from __future__ import annotations

import argparse
import io
import math
from pathlib import Path
import sys
import urllib.error
import urllib.request

import numpy as np
from PIL import Image
from scipy.interpolate import RegularGridInterpolator

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "data" / "terrain"
OUTPUT_NPY = OUTPUT_DIR / "ladakh_real_dem.npy"
OUTPUT_BIN = PROJECT_ROOT / "public" / "terrain" / "real_ladakh_dem.bin"

# Center of theater: Kargil sector (34.5°N, 76.5°E)
LAT_CENTER = 34.5
LON_CENTER = 76.5

TARGET_SIZE = 512
ZOOM_LEVEL = 8


def compute_bounds_for_theater(radius_km: float = 150.0) -> tuple[float, float, float, float]:
    """Calculates latitude/longitude bounds for a given theater radius (km)."""
    km_per_lat = 111.0
    km_per_lon = 111.0 * math.cos(math.radians(LAT_CENTER))

    d_lat = radius_km / km_per_lat
    d_lon = radius_km / km_per_lon

    return (
        round(LAT_CENTER - d_lat, 2),
        round(LAT_CENTER + d_lat, 2),
        round(LON_CENTER - d_lon, 2),
        round(LON_CENTER + d_lon, 2),
    )


def deg2num(lat_deg: float, lon_deg: float, zoom: int) -> tuple[int, int]:
    """Converts WGS-84 lat/lon to OpenStreetMap slippy tile indices."""
    lat_rad = math.radians(lat_deg)
    n = 1 << zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return (xtile, ytile)


def num2deg(xtile: int, ytile: int, zoom: int) -> tuple[float, float]:
    """Converts slippy tile indices back to NW-corner WGS-84 lat/lon."""
    n = 1 << zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * ytile / n)))
    lat_deg = math.degrees(lat_rad)
    return (lat_deg, lon_deg)


def fetch_tile_terrarium(z: int, x: int, y: int) -> np.ndarray:
    """
    Fetches a single AWS Terrarium Terrain-RGB tile and decodes elevation in meters.
    Equation: elevation = (R * 256.0 + G + B / 256.0) - 32768.0
    """
    url = f"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    }
    req = urllib.request.Request(url, headers=headers)

    with urllib.request.urlopen(req, timeout=12.0) as resp:
        if resp.status != 200:
            raise urllib.error.HTTPError(url, resp.status, f"HTTP Error {resp.status}", resp.headers, None)
        raw_bytes = resp.read()

    img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    rgb = np.asarray(img, dtype=np.float32)

    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]

    # MapLibre / Terrarium 24-bit elevation decoding
    elev = (r * 256.0 + g + b / 256.0) - 32768.0
    return elev


def fetch_satellite_dem(
    lat_min: float = 33.5,
    lat_max: float = 35.5,
    lon_min: float = 75.5,
    lon_max: float = 77.5,
    target_size: int = TARGET_SIZE,
    zoom: int = ZOOM_LEVEL,
    output_npy: Path = OUTPUT_NPY,
    output_bin: Path = OUTPUT_BIN,
) -> tuple[bool, str, np.ndarray | None]:
    """
    Fetches tiles, stitches them, resamples to target_size x target_size,
    validates elevations, and writes both .npy and raw .bin files.
    """
    print(f"[*] Calculating slippy tile coordinates at Zoom {zoom}...")
    x_min, y_min = deg2num(lat_max, lon_min, zoom)
    x_max, y_max = deg2num(lat_min, lon_max, zoom)

    x_tiles = list(range(x_min, x_max + 1))
    y_tiles = list(range(y_min, y_max + 1))
    n_tiles = len(x_tiles) * len(y_tiles)

    print(f"[*] Bounding Box: Lat [{lat_min}°, {lat_max}°], Lon [{lon_min}°, {lon_max}°]")
    print(f"[*] Tile grid: X=[{x_min}..{x_max}], Y=[{y_min}..{y_max}] ({n_tiles} tiles total).")

    tile_cache: dict[tuple[int, int], np.ndarray] = {}
    fetched_count = 0

    for yt in y_tiles:
        for xt in x_tiles:
            fetched_count += 1
            print(f"    -> [{fetched_count}/{n_tiles}] Fetching tile z={zoom}, x={xt}, y={yt}...")
            try:
                elev_tile = fetch_tile_terrarium(zoom, xt, yt)
                tile_cache[(xt, yt)] = elev_tile
            except Exception as e:
                err_msg = (
                    f"CRITICAL: Failed to download AWS Terrarium tile (z={zoom}, x={xt}, y={yt}): {e}\n"
                    "Network unreachable or AWS tile server refused connection."
                )
                print(f"[-] {err_msg}", file=sys.stderr)
                return False, err_msg, None

    # Stitch into a composite raster
    tile_h, tile_w = next(iter(tile_cache.values())).shape
    full_h = len(y_tiles) * tile_h
    full_w = len(x_tiles) * tile_w
    stitched = np.zeros((full_h, full_w), dtype=np.float32)

    for r_idx, yt in enumerate(y_tiles):
        for c_idx, xt in enumerate(x_tiles):
            stitched[
                r_idx * tile_h : (r_idx + 1) * tile_h,
                c_idx * tile_w : (c_idx + 1) * tile_w,
            ] = tile_cache[(xt, yt)]

    # Compute outer coordinate bounds of the stitched matrix
    nw_lat, nw_lon = num2deg(x_min, y_min, zoom)
    se_lat, se_lon = num2deg(x_max + 1, y_max + 1, zoom)

    stitched_lats = np.linspace(nw_lat, se_lat, full_h)  # descending from North to South
    stitched_lons = np.linspace(nw_lon, se_lon, full_w)  # ascending from West to East

    lat_ascending = stitched_lats[::-1]
    elev_ascending = np.flipud(stitched)

    interpolator = RegularGridInterpolator(
        (lat_ascending, stitched_lons),
        elev_ascending,
        method="linear",
        bounds_error=False,
        fill_value=None,
    )

    # Sample into target grid (Row 0: North lat_max, Row target_size-1: South lat_min)
    target_lats = np.linspace(lat_max, lat_min, target_size)
    target_lons = np.linspace(lon_min, lon_max, target_size)
    mesh_lats, mesh_lons = np.meshgrid(target_lats, target_lons, indexing="ij")

    eval_pts = np.column_stack((mesh_lats.ravel(), mesh_lons.ravel()))
    dem_512 = interpolator(eval_pts).reshape((target_size, target_size)).astype(np.float32)

    min_elev = float(dem_512.min())
    max_elev = float(dem_512.max())
    mean_elev = float(dem_512.mean())

    print("[*] Elevation Statistics:")
    print(f"    - Min Elevation  : {min_elev:.1f} m MSL")
    print(f"    - Max Elevation  : {max_elev:.1f} m MSL")
    print(f"    - Mean Elevation : {mean_elev:.1f} m MSL")

    if not (2800.0 <= mean_elev <= 5600.0):
        print(f"[!] Warning: Mean elevation ({mean_elev:.1f} m) falls outside expected range [2800m, 5600m].")

    # 1. Save .npy for Python/benchmarks
    output_npy.parent.mkdir(parents=True, exist_ok=True)
    np.save(output_npy, dem_512)

    # 2. Save raw .bin for Vite / WebWorker Float32Array consumption
    output_bin.parent.mkdir(parents=True, exist_ok=True)
    dem_512.tofile(output_bin)

    bin_kb = output_bin.stat().st_size / 1024
    msg = (
        f"Saved successfully:\n"
        f"  - NumPy (.npy) : {output_npy.resolve()}\n"
        f"  - Binary (.bin): {output_bin.resolve()} ({bin_kb:.1f} KB)\n"
        f"Grid: {dem_512.shape} float32 | Range: [{min_elev:.1f}m, {max_elev:.1f}m]"
    )
    print(f"[+] {msg}")
    return True, msg, dem_512


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch real satellite DEM from AWS Terrarium.")
    parser.add_argument("--size", type=int, default=TARGET_SIZE, help="Output resolution (default: 512)")
    parser.add_argument("--zoom", type=int, default=ZOOM_LEVEL, help="Slippy map zoom level (default: 8)")
    parser.add_argument("--radius-km", type=float, default=None, help="Radius around Kargil (km) to automatically compute lat/lon bounds (e.g., 150 for 300km, 200 for 400km)")
    args = parser.parse_args()

    if args.radius_km is not None:
        lat_min, lat_max, lon_min, lon_max = compute_bounds_for_theater(args.radius_km)
    else:
        lat_min, lat_max = 33.5, 35.5
        lon_min, lon_max = 75.5, 77.5

    ok, msg, _ = fetch_satellite_dem(
        lat_min=lat_min,
        lat_max=lat_max,
        lon_min=lon_min,
        lon_max=lon_max,
        target_size=args.size,
        zoom=args.zoom,
    )

    if not ok:
        print(f"\n[FAIL] {msg}", file=sys.stderr)
        return 1

    print("\n[SUCCESS] Satellite DEM is ready for both Python and Vite client-side WebWorker engines.")
    return 0


if __name__ == "__main__":
    sys.exit(main())