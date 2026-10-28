"""
server/app.py - Simulation Orchestrator + FastAPI/WebSocket Telemetry Server
Tactical X-Band Air-to-Ground Network Digital Twin

Run:   python server/app.py      (or)      uvicorn server.app:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import dataclasses
import io
import json
import math
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
from fastapi import FastAPI, File, UploadFile, WebSocket
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel
from scipy.ndimage import zoom

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.config import ACNFlightConfig, EnvironmentConfig, RFConfig  # noqa: E402
from core.link_budget import LinkBudgetEngine  # noqa: E402
from core.queues import QOS_PROFILES, GroundNodeTrafficSubsystem, Packet  # noqa: E402
from core.scheduler import LegacyStaticScheduler, TerrainAwareDynamicScheduler  # noqa: E402
from core.terrain import TerrainEngine, _procedural_himalayan_elevation  # noqa: E402
from core.trajectory import (  # noqa: E402
    ACNTrajectoryEngine,
    NodeTerrainState,
    PredictiveLookAheadEngine,
    PredictiveState,
)
from scripts.fetch_real_dem import fetch_satellite_dem  # noqa: E402

# ----------------------------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------------------------
FRAME_DT = 0.020                     # 50 Hz superframe (20 ms)
FRAME_MS = 20.0
THEATER_HALF_M = 300_000.0           # 600x600 km domain (+/- 300 km from origin)
ANTENNA_HEIGHT_M = 2.0
NUM_NODES = 16
MCP_ID = 15
ACN_ID = -1                          # Dragging node_id == -1 translates ACN orbit centre
FRESNEL_EVERY_STEPS = 5              # Fresnel cross-section refresh cadence
FRESNEL_SAMPLES = 80
TERRAIN_NODES_PER_TICK = 2           # Ray-march look-ahead nodes refreshed per tick
FULL_REFRESH_MIN_S = 0.25            # Throttle for slider-induced updates
EARTH_RADIUS_M = 6_371_000.0
K_FACTOR = 4.0 / 3.0
C_LIGHT = 299_792_458.0
FRONTEND_DIR = BASE_DIR / "frontend"
CUSTOM_DEM_PATH = BASE_DIR / "data" / "terrain" / "custom_uploaded_dem.npy"

TRAFFIC_ALIASES = {
    "SOS": "SOS", "C2": "SOS", "EMERGENCY": "SOS",
    "VOICE": "VOICE", "PTT": "VOICE",
    "VIDEO": "VIDEO",
    "PHOTO": "PHOTO", "IMAGE": "PHOTO",
}
SCHEDULER_ALIASES = {
    "tac_tad": "tac_tad", "tac": "tac_tad", "dynamic": "tac_tad", "tac-tad": "tac_tad",
    "static": "static", "legacy": "static", "tdma": "static",
}

_CONFIG_BINDINGS: dict[str, tuple[str, str, float, float, float]] = {
    "orbit_a_m": ("flight", "loiter_radius_a_m", 1.0, 3_000.0, 120_000.0),
    "orbit_b_m": ("flight", "loiter_radius_b_m", 1.0, 3_000.0, 120_000.0),
    "orbit_rotation_deg": ("flight", "loiter_rotation_deg", 1.0, -360.0, 360.0),
    "acn_altitude_m": ("flight", "altitude_msl_m", 1.0, 1_000.0, 20_000.0),
    "coverage_radius_km": ("flight", "coverage_radius_km", 1.0, 5.0, 250.0),
    "coverage_radius_m": ("flight", "coverage_radius_km", 0.001, 5_000.0, 250_000.0),
    "carrier_freq_ghz": ("rf", "carrier_frequency_hz", 1e9, 7.0, 12.5),
    "bandwidth_mhz": ("rf", "channel_bandwidth_hz", 1e6, 0.1, 1_000.0),
    "rain_rate_mmh": ("env", "rain_rate_mm_h", 1.0, 0.0, 150.0),
}
_PARAM_ALIASES = {
    "loiter_radius_a_m": "orbit_a_m", "orbit_a": "orbit_a_m", "orbit_a_km": "orbit_a_m",
    "loiter_radius_b_m": "orbit_b_m", "orbit_b": "orbit_b_m", "orbit_b_km": "orbit_b_m",
    "loiter_rotation_deg": "orbit_rotation_deg", "orbit_phi_deg": "orbit_rotation_deg",
    "orbit_phi": "orbit_rotation_deg", "orbit_rotation": "orbit_rotation_deg",
    "altitude_m": "acn_altitude_m", "acn_altitude": "acn_altitude_m", "altitude_msl_m": "acn_altitude_m",
    "altitude_km": "acn_altitude_m",
    "coverage_radius": "coverage_radius_km", "coverage_km": "coverage_radius_km",
    "coverage_radius_km": "coverage_radius_km", "acn_coverage_km": "coverage_radius_km",
    "footprint_km": "coverage_radius_km", "acn_coverage": "coverage_radius_km",
    "coverage_radius_m": "coverage_radius_m", "coverage_m": "coverage_radius_m",
    "acn_coverage_m": "coverage_radius_m", "footprint_m": "coverage_radius_m",
    "carrier_freq": "carrier_freq_ghz", "freq_ghz": "carrier_freq_ghz",
    "bandwidth": "bandwidth_mhz", "channel_bandwidth_mhz": "bandwidth_mhz",
    "rain_rate": "rain_rate_mmh", "rain_rate_mm_h": "rain_rate_mmh",
}
_KM_PARAMS = {"orbit_a_km", "orbit_b_km", "altitude_km"}


# ----------------------------------------------------------------------------------------
# Generic helpers
# ----------------------------------------------------------------------------------------
def _f(v: Any, default: float = 0.0, nd: Optional[int] = None) -> float:
    """Strict JSON-safe float: converts non-finite values to clean numbers."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(x):
        return default
    return round(x, nd) if nd is not None else x


def _count(x: Any) -> int:
    if x is None:
        return 0
    if isinstance(x, (int, float, np.integer)):
        return int(x)
    try:
        return len(x)
    except TypeError:
        return 0


def _json_safe(obj: Any) -> Any:
    """Recursive RFC 8259 sanitiser (replaces NaN/Inf with 0 or 999.0)."""
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        x = float(obj)
        if math.isinf(x):
            return 999.0 if x > 0 else -999.0
        return x if math.isfinite(x) else 0.0
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return _json_safe(obj.tolist())
    return obj


def _default_pred() -> PredictiveState:
    return PredictiveState(
        current_state=NodeTerrainState.NORMAL_LOS,
        time_to_occlusion_s=float("inf"),
        time_to_emergence_s=0.0,
        fresnel_clearance_m=0.0,
        fresnel_rate_of_change_mps=0.0,
        predicted_outage_duration_s=0.0,
        apparent_doppler_hz=0.0,
        shadow_duration_s=0.0,
    )


_EMPTY_REPORT = {
    "goodput_bits": 0.0, "wasted_bits": 0.0, "dropped_pkts": 0,
    "util_pct": 0.0, "allocations": []
}


def natural_valley_elevation(x: Any, y: Any) -> Any:
    """
    Evaluates terrain elevation MSL (m) using authentic Ladakh geomorphology.
    Directly delegates to core.terrain._procedural_himalayan_elevation.
    """
    return _procedural_himalayan_elevation(x, y)


# ----------------------------------------------------------------------------------------
# Tactical Node with Cross-Layer Radio Backoff
# ----------------------------------------------------------------------------------------
class TacticalNode(GroundNodeTrafficSubsystem):
    """Adapter around GroundNodeTrafficSubsystem for per-class byte accounting & traffic injection."""

    def __init__(self, node_id: int, name: str, x_m: float, y_m: float, z_m: float,
                 node_type: str, seed: int, **traffic_kw: Any) -> None:
        super().__init__(node_id=node_id, node_type=node_type, position=(x_m, y_m, z_m),
                         seed=seed, **traffic_kw)
        self.name = name
        self.x_m, self.y_m, self.z_m = x_m, y_m, z_m
        self.last_served = {69: 0, 65: 0, 67: 0, 70: 0}
        self.is_in_shadow = False
        self._video_until: Optional[float] = None
        self._video_restore: Optional[tuple[bool, float]] = None
        self._photo_left = 0
        orig = self.queue.dequeue

        def recording_dequeue(bytes_capacity: int, current_time_s: float):
            pkts = orig(bytes_capacity, current_time_s)
            for p in pkts:
                self.last_served[p.qos_5qi] += p.size_bytes
            return pkts

        self.queue.dequeue = recording_dequeue  # type: ignore[method-assign]

    def reset_served(self) -> None:
        for k in self.last_served:
            self.last_served[k] = 0

    def set_position(self, x: float, y: float, z: float) -> None:
        self.x_m, self.y_m, self.z_m = x, y, z
        self.position = (x, y, z)

    def get_backlog_counts(self) -> dict[str, int]:
        q = self.queue.subqueues
        return {"c2": len(q[69]), "voice": len(q[65]), "video": len(q[67]), "photo": len(q[70])}

    def total_backlog_bytes(self) -> int:
        return int(self.queue.get_total_backlog_bytes())

    def _enqueue(self, qos: int, t: float, size: Optional[int] = None,
                 deadline_s: Optional[float] = None,
                 size_bytes: Optional[int] = None) -> Packet:
        if size is not None and size_bytes is not None:
            raise ValueError("Specify either size or size_bytes, not both")
        packet_size = size_bytes if size_bytes is not None else size
        GroundNodeTrafficSubsystem._global_packet_id_counter += 1
        prof = QOS_PROFILES[qos]
        pkt = Packet(
            packet_id=GroundNodeTrafficSubsystem._global_packet_id_counter,
            node_id=self.node_id, qos_5qi=qos,
            size_bytes=int(packet_size if packet_size is not None else prof["default_bytes"]),
            arrival_time_s=t,
            deadline_s=t + (deadline_s if deadline_s is not None else float(prof["pdb_s"])),
            sojourn_time_s=0.0)
        self.queue.enqueue(pkt)
        return pkt

    def generate_traffic(self, current_time_s: float, frame_duration_s: float = 0.020):
        orig_video = self.has_video
        if self.is_in_shadow:
            self.has_video = False

        if self._video_until is not None and current_time_s > self._video_until:
            if self._video_restore is not None:
                orig_video, self.video_mean_pkts_per_frame = self._video_restore
            self._video_until, self._video_restore = None, None

        out = super().generate_traffic(current_time_s, frame_duration_s)
        self.has_video = orig_video

        room = 120 - len(self.queue.subqueues[70])
        while self._photo_left > 0 and room > 0:
            sz = min(1400, self._photo_left)
            out.append(self._enqueue(70, current_time_s, sz, deadline_s=10.0))
            self._photo_left -= sz
            room -= 1
        return out

    def inject_traffic(self, traffic_type: str, t: float) -> int:
        kind = traffic_type.upper()
        n = 0
        if kind == "SOS":
            for _ in range(8):
                self._enqueue(69, t)
                n += 1
        elif kind == "VOICE":
            self.has_voice, self.voice_start_s, self.voice_end_s = True, t, t + 5.0
            n += 1
        elif kind == "VIDEO":
            if self._video_restore is None:
                self._video_restore = (self.has_video, self.video_mean_pkts_per_frame)
            self.has_video, self.video_mean_pkts_per_frame, self._video_until = True, 3.0, t + 3.0
            n += 5
        elif kind == "PHOTO":
            self._photo_left += 2_000_000
            n += 1
        return n


def _traffic_profile(i: int) -> dict[str, Any]:
    """Calibrated tactical load configuration."""
    kw: dict[str, Any] = {}
    if i == MCP_ID:
        kw.update(has_voice=True, has_video=True, video_mean_pkts_per_frame=2.5)
    elif i == 4:
        kw.update(has_photo=True, photo_trigger_time_s=1.8, photo_size_bytes=240_000,
                  has_voice=True, voice_start_s=1.0, voice_end_s=3.8)
    elif i in (1, 2):
        kw.update(has_voice=True, voice_start_s=0.0, voice_end_s=1.0e6)
    elif i in (3, 6, 9):
        kw.update(has_video=True, video_mean_pkts_per_frame=0.8)
    return kw


@dataclasses.dataclass
class RunningMetrics:
    static_goodput_bits: float = 0.0
    tac_goodput_bits: float = 0.0
    static_wasted_bits: float = 0.0
    tac_wasted_bits: float = 0.0
    static_dropped_pkts: int = 0
    tac_dropped_pkts: int = 0
    static_enqueued_pkts: int = 0
    tac_enqueued_pkts: int = 0
    node4_pre_shadow_backlog_kb: float = 0.0
    static_node4_pre_shadow_backlog_kb: float = 0.0
    last_static_util_pct: float = 0.0
    last_tac_util_pct: float = 0.0


# ----------------------------------------------------------------------------------------
# Simulation Manager
# ----------------------------------------------------------------------------------------
class SimulationManager:
    def __init__(self) -> None:
        self._logged: set[str] = set()
        self._terrain_vec: Optional[bool] = None
        self.hillshade_grid: list[list[int]] = []
        self.rf_cfg = RFConfig()
        self.env_cfg = EnvironmentConfig()
        self.flight_cfg = ACNFlightConfig()
        # Initialize dual-mode TerrainEngine over 600x600 km domain
        self.terrain = TerrainEngine(theater_extent_m=THEATER_HALF_M, terrain_mode="real")
        self.generate_hillshade_grid(512)
        self.speed = 1.0
        self._speed_before_pause = 1.0
        self.scheduler_mode = "tac_tad"
        self.selected_node_id = 4
        self.node_transfers: dict[int, dict[str, Any]] = {}
        self._init_runtime()

    def _init_runtime(self) -> None:
        self._rebuild_engines()
        self.static_scheduler = LegacyStaticScheduler()
        self.tac_scheduler = TerrainAwareDynamicScheduler(tau_max_normal_s=0.008)
        self.dynamic_scheduler = self.tac_scheduler

        self.sim_time_s = 0.0
        self.frame_index = 0
        self._step_accum = 0.0
        self.metrics = RunningMetrics()
        self.comparison_stats: dict[str, Any] = {
            "static_goodput_bits": 0.0,
            "tac_goodput_bits": 0.0,
            "static_wasted_bits": 0.0,
            "tac_wasted_bits": 0.0,
            "static_dropped_pkts": 0,
            "tac_dropped_pkts": 0,
        }
        self._node4_frozen = False
        self._flight_path_key: Any = None
        self._flight_path_cache: list[list[float]] = []

        self.node_transfers = {}
        for i in range(NUM_NODES):
            self.node_transfers[i] = {
                "active_type": None,
                "total_bytes": 0,
                "delivered_bytes": 0,
                "dropped_bytes": 0,
                "dropped_packets": 0,
                "status": "IDLE",
                "status_message": "",
                "start_time_s": -1.0,
                "ack_time_s": -1.0,
                "_last_queue_drops": 0,
            }

        self.nodes_static: list[TacticalNode] = []
        self.nodes_tac: list[TacticalNode] = []
        self._build_nodes()

        self.link_status: dict[int, Any] = {}
        self.pred_states: dict[int, PredictiveState] = {}
        self._diff_db: dict[int, float] = {}
        self.fresnel_slice: dict[str, Any] = {}
        self._dirty: set[int] = set()
        self._all_dirty = False
        self._last_full = 0.0
        self._rr = 0
        self._last_static = dict(_EMPTY_REPORT)
        self._last_tac = dict(_EMPTY_REPORT)

        self._update_acn(0.0)
        for nid in range(NUM_NODES):
            self._refresh_terrain_node(nid, 0.0)
        self._update_links()
        self._refresh_fresnel()
        self._track_node4()

    def reset(self) -> None:
        self._init_runtime()

    def _rebuild_engines(self) -> None:
        self.link_engine = LinkBudgetEngine()
        self.trajectory_engine = ACNTrajectoryEngine(self.flight_cfg)
        self.lookahead_engine = PredictiveLookAheadEngine(
            terrain_engine=self.terrain, link_budget_engine=self.link_engine,
            rf_config=self.rf_cfg, env_config=self.env_cfg,
            flight_config=self.flight_cfg, trajectory_engine=self.trajectory_engine)

    def _safe(self, label: str, fn: Callable[..., Any], *a: Any, default: Any = None, **k: Any) -> Any:
        try:
            return fn(*a, **k)
        except Exception:
            if label not in self._logged:
                self._logged.add(label)
                print(f"[SimulationManager] '{label}' warning:", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
            return default

    def _sample_elevation(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        xs = np.asarray(xs, dtype=float)
        ys = np.asarray(ys, dtype=float)
        if self._terrain_vec is not False:
            try:
                out = np.asarray(self.terrain.get_elevation(xs, ys), dtype=float)
                if out.shape == xs.shape:
                    self._terrain_vec = True
                    return np.nan_to_num(out)
                self._terrain_vec = False
            except Exception:
                self._terrain_vec = False
        get = self.terrain.get_elevation
        flat = np.fromiter((float(get(float(x), float(y))) for x, y in zip(xs.ravel(), ys.ravel())),
                           dtype=float, count=xs.size)
        return np.nan_to_num(flat.reshape(xs.shape))

    def _ground_z(self, x: float, y: float) -> float:
        return float(self._sample_elevation(np.array([x]), np.array([y]))[0]) + ANTENNA_HEIGHT_M

    def generate_hillshade_grid(self, grid_size: int = 512) -> list[list[int]]:
        """
        High-definition shaded relief combining directional Lambertian shading with
        natural alpine hypsometric tinting over the expanded 600x600 km domain.
        """
        axis = np.linspace(-THEATER_HALF_M, THEATER_HALF_M, grid_size)
        X, Y = np.meshgrid(axis, axis)
        Z = self._sample_elevation(X, Y)
        cell = float(axis[1] - axis[0])

        dzdx = np.gradient(Z, cell, axis=1) * 1.5
        dzdy = np.gradient(Z, -cell, axis=0) * 1.5
        slope = np.arctan(np.hypot(dzdx, dzdy))
        aspect = np.arctan2(dzdy, -dzdx)

        alt = math.radians(45.0)
        az = math.radians((360.0 - 315.0 + 90.0) % 360.0)
        shaded = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
        shaded = np.nan_to_num(np.clip(shaded, 0.0, 1.0))

        lo, hi = np.percentile(shaded, 2.0), np.percentile(shaded, 98.0)
        norm = np.clip((shaded - lo) / (hi - lo), 0.0, 1.0) if hi - lo > 1e-6 else np.full_like(shaded, 0.5)
        shade_val = 0.40 + 0.60 * (norm ** 1.05)

        t_slope = np.clip((Z - 3150.0) / 1000.0, 0.0, 1.0)
        t_snow = np.clip((Z - 4800.0) / 600.0, 0.0, 1.0)

        # Tactical hypsometric color ramp
        r_base = (1.0 - t_slope) * 24.0 + t_slope * ((1.0 - t_snow) * 65.0 + t_snow * 195.0)
        g_base = (1.0 - t_slope) * 32.0 + t_slope * ((1.0 - t_snow) * 82.0 + t_snow * 215.0)
        b_base = (1.0 - t_slope) * 44.0 + t_slope * ((1.0 - t_snow) * 105.0 + t_snow * 238.0)

        r_final = np.clip(r_base * shade_val * 1.15, 14.0, 245.0).astype(np.int32)
        g_final = np.clip(g_base * shade_val * 1.15, 18.0, 248.0).astype(np.int32)
        b_final = np.clip(b_base * shade_val * 1.15, 26.0, 252.0).astype(np.int32)

        packed = ((r_final << 16) | (g_final << 8) | b_final).tolist()
        self.hillshade_grid = packed
        return self.hillshade_grid

    def compute_flight_path(self, num_points: int = 64) -> list[list[float]]:
        fc = self.flight_cfg
        a, b = _f(fc.loiter_radius_a_m, 20_000.0), _f(fc.loiter_radius_b_m, 10_000.0)
        rot = math.radians(_f(fc.loiter_rotation_deg))
        cx, cy = _f(fc.center_x_m), _f(fc.center_y_m)
        key = (num_points, a, b, rot, cx, cy)
        if key == self._flight_path_key:
            return self._flight_path_cache
        c, s = math.cos(rot), math.sin(rot)
        pts = []
        for i in range(num_points):
            th = 2.0 * math.pi * i / num_points
            ex, ey = a * math.cos(th), b * math.sin(th)
            pts.append([round(cx + ex * c - ey * s, 1), round(cy + ex * s + ey * c, 1)])
        self._flight_path_key, self._flight_path_cache = key, pts
        return pts

    def _build_nodes(self) -> None:
        """
        Dispersed tactical deployment across the 600x600 km Ladakh theater.
        Nodes are realistically separated across valleys, passes, and ridges.
        """
        positions = [
            (-18000.0, -12000.0), # Node 0: Rifleman
            (-8000.0, -5000.0),   # Node 1: Squad Leader
            (15000.0, -20000.0),  # Node 2: Medic
            (-25000.0, 18000.0),  # Node 3: Scout Alpha
            (12000.0, 8000.0),    # Node 4: Recon Patrol (Occlusion Target)
            (28000.0, 32000.0),   # Node 5: Rifleman
            (-32000.0, -25000.0), # Node 6: Scout Bravo
            (-12000.0, 24000.0),  # Node 7: Designated Marksman
            (22000.0, 12000.0),   # Node 8: Support Gunner
            (35000.0, -15000.0),  # Node 9: Scout Charlie
            (42000.0, -28000.0),  # Node 10: Rifleman
            (-40000.0, 5000.0),   # Node 11: Ammo Carrier
            (8000.0, -14000.0),   # Node 12: Forward Observer
            (18000.0, 22000.0),   # Node 13: RTL Relay
            (-5000.0, 15000.0),   # Node 14: Rifleman
            (-20000.0, -30000.0), # Node 15: Main Command Post (MCP 20W Dish)
        ]

        for i, (x, y) in enumerate(positions):
            ntype = "mcp" if i == MCP_ID else "soldier"
            name = "MCP" if i == MCP_ID else f"S{i}"
            z = self._ground_z(x, y)
            for target in (self.nodes_static, self.nodes_tac):
                target.append(TacticalNode(i, name, x, y, z, ntype, seed=1000 + i, **_traffic_profile(i)))

    def _active_nodes(self) -> list[TacticalNode]:
        return self.nodes_tac if self.scheduler_mode == "tac_tad" else self.nodes_static

    def _carrier_hz(self) -> float:
        return float(self.rf_cfg.carrier_frequency_hz)

    def _update_acn(self, t: float) -> None:
        self._acn_pos = tuple(float(v) for v in self.trajectory_engine.get_acn_position(t))
        self._acn_vel = tuple(float(v) for v in self.trajectory_engine.get_acn_velocity(t))

    def _refresh_terrain_node(self, nid: int, t: float) -> None:
        node = self.nodes_tac[nid]
        npos = (float(node.x_m), float(node.y_m), float(node.z_m))
        res = self._safe("terrain-obstruction", self.terrain.evaluate_terrain_obstruction,
                         npos, self._acn_pos, self.rf_cfg, self.env_cfg, default=None)
        self._diff_db[nid] = max(0.0, _f(res[2])) if res else 0.0
        ps = self._safe("lookahead", self.lookahead_engine.evaluate_predictive_state,
                        npos, t, default=None)
        self.pred_states[nid] = ps if ps is not None else _default_pred()

        is_shadow = self.pred_states[nid].current_state == NodeTerrainState.HARD_SHADOW_CUTOFF
        self.nodes_tac[nid].is_in_shadow = is_shadow
        self.nodes_static[nid].is_in_shadow = is_shadow

    def _terrain_maintenance(self, t: float, running: bool) -> bool:
        now = time.monotonic()
        ids: list[int] = []
        if self._all_dirty and now - self._last_full >= FULL_REFRESH_MIN_S:
            ids, self._all_dirty, self._last_full = list(range(NUM_NODES)), False, now
            self._dirty.clear()
        elif self._dirty:
            ids = sorted(self._dirty)
            self._dirty.clear()
        elif running:
            ids = [(self._rr + k) % NUM_NODES for k in range(TERRAIN_NODES_PER_TICK)]
            self._rr = (self._rr + TERRAIN_NODES_PER_TICK) % NUM_NODES
        for nid in ids:
            self._refresh_terrain_node(nid, t)
        return bool(ids)

    def _update_links(self) -> None:
        px, py, pz = self._acn_pos
        for node in self.nodes_tac:
            nid = node.node_id
            slant = max(math.sqrt((px - node.x_m) ** 2 + (py - node.y_m) ** 2 + (pz - node.z_m) ** 2), 1.0)
            ls = self.link_engine.evaluate_link(node.node_type, slant, self._diff_db.get(nid, 0.0),
                                                self.rf_cfg, self.env_cfg)
            ps = self.pred_states.get(nid)
            if ps is not None and ps.current_state == NodeTerrainState.HARD_SHADOW_CUTOFF:
                ls.bitrate_bps, ls.modcod, ls.spectral_efficiency_bps_hz, ls.is_outage = 0.0, "LINK_OUTAGE", 0.0, True
            self.link_status[nid] = ls

    def _age_predictions(self, dt: float) -> None:
        for ps in self.pred_states.values():
            for attr in ("time_to_occlusion_s", "time_to_emergence_s"):
                v = getattr(ps, attr)
                if math.isfinite(v) and v > 0.0:
                    setattr(ps, attr, max(0.0, v - dt))

    def _profile(self, node_xyz: tuple, acn_xyz: tuple, n: int) -> dict[str, Any]:
        nx, ny, nz = node_xyz
        ax, ay, az = acn_xyz
        D = max(math.hypot(ax - nx, ay - ny), 1.0)
        s = np.linspace(0.0, 1.0, n)
        d = D * s
        terrain = self._sample_elevation(nx + (ax - nx) * s, ny + (ay - ny) * s)
        eff = terrain + d * (D - d) / (2.0 * K_FACTOR * EARTH_RADIUS_M)
        los = nz + (az - nz) * s
        lam = C_LIGHT / self._carrier_hz()
        f1 = np.sqrt(np.maximum(lam * d * (D - d) / D, 0.0))
        return {"D": D, "d": d, "terrain": eff, "los": los, "f1": f1}

    def _refresh_fresnel(self) -> None:
        nid = self.selected_node_id
        if not 0 <= nid < len(self.nodes_tac):
            return
        node = self.nodes_tac[nid]
        npos = (float(node.x_m), float(node.y_m), float(node.z_m))
        p = self._profile(npos, self._acn_pos, FRESNEL_SAMPLES)
        terrain, los, f1, d = p["terrain"], p["los"], p["f1"], p["d"]
        lower = los - 0.6 * f1
        pen = terrain > lower
        pen[0] = pen[-1] = False
        blocked = terrain > los
        blocked[0] = blocked[-1] = False

        clearance_vals = los[1:-1] - terrain[1:-1]
        min_clear_m = float(np.min(clearance_vals)) if clearance_vals.size else 0.0

        ps = self.pred_states.get(nid)
        if ps is not None and math.isfinite(ps.fresnel_clearance_m):
            min_clear_m = float(ps.fresnel_clearance_m)

        status_text = "CLEAR 1ST FRESNEL ZONE"
        if bool(np.any(blocked)):
            status_text = "OBSTRUCTED (LINE-OF-SIGHT SEVERED)"
        elif bool(np.any(pen)):
            status_text = "GRAZING 0.6 F1 (DIFFRACTION PENALTY)"

        self.fresnel_slice = {
            "node_id": nid, "node_name": node.name,
            "distance_km": _f(p["D"] / 1000.0, 0.0, 2),
            "clearance_m": _f(min_clear_m, 0.0, 1),
            "status": status_text,
            "obstructed": bool(np.any(blocked)),
            "diffraction_loss_db": _f(self._diff_db.get(nid, 0.0), 0.0, 2),
            "state_name": ps.current_state.name if ps else "NORMAL_LOS",
            "profile_points": [[round(float(d[i]) / 1000.0, 3), round(float(terrain[i]), 1),
                                round(float(los[i]), 1), round(float(lower[i]), 1)] for i in range(len(d))],
        }

    def _parse_report(self, report: Any, t: float, nodes: list[TacticalNode], is_static: bool = False) -> dict[str, Any]:
        allocs = []
        outage_pkts_lost = 0
        for a in report.allocations:
            nid = int(a.node_id)
            served = nodes[nid].last_served if 0 <= nid < len(nodes) else {}
            allocs.append({
                "node_id": nid,
                "start_ms": _f((a.slot_start_s - t) * 1000.0, 0.0, 3),
                "duration_ms": _f(a.duration_s * 1000.0, 0.0, 3),
                "duration_s": _f(a.duration_s, 0.0, 6),
                "slot_start_s": _f(a.slot_start_s, 0.0, 6),
                "c2_bytes": int(served.get(69, 0)),
                "voice_bytes": int(served.get(65, 0)),
                "video_bytes": int(served.get(67, 0)),
                "photo_bytes": int(served.get(70, 0)),
                "is_pre_occlusion_flush": getattr(a, "is_pre_occlusion_flush", False),
            })
            if is_static and 0 <= nid < len(nodes):
                ps = self.pred_states.get(nid)
                if ps and ps.current_state == NodeTerrainState.HARD_SHADOW_CUTOFF:
                    total_bytes = sum(served.values())
                    if total_bytes > 0:
                        outage_pkts_lost += max(1, total_bytes // 300)

        total_drops = int(report.packets_dropped_delay + report.packets_dropped_overflow) + outage_pkts_lost
        return {
            "goodput_bits": _f(report.total_bits_transmitted),
            "wasted_bits": _f(report.total_bits_wasted_on_outage),
            "dropped_pkts": total_drops,
            "util_pct": _f(report.total_ul_utilization_pct),
            "allocations": allocs,
        }

    def _run_scheduler(self, label: str, sched: Any, nodes: list[TacticalNode], t: float) -> dict[str, Any]:
        for n in nodes:
            n.reset_served()

        try:
            report = sched.schedule_frame(self.frame_index, t, nodes, self.link_status, self.pred_states)
        except Exception as exc:
            print(f"[SimulationManager] CRITICAL: Scheduler '{label}' failed at frame {self.frame_index} (t={t:.3f}s): {exc}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return dict(_EMPTY_REPORT)

        is_static = label == "static"
        return self._parse_report(report, t, nodes, is_static=is_static) if report is not None else dict(_EMPTY_REPORT)

    def _step(self) -> None:
        self.sim_time_s += FRAME_DT
        self.frame_index += 1
        t = self.sim_time_s
        m = self.metrics

        for ns, nt in zip(self.nodes_static, self.nodes_tac):
            m.static_enqueued_pkts += _count(self._safe("traffic-static", ns.generate_traffic, t, FRAME_DT, default=0))
            m.tac_enqueued_pkts += _count(self._safe("traffic-tac", nt.generate_traffic, t, FRAME_DT, default=0))
            ns.queue.prune_expired_packets(t)
            nt.queue.prune_expired_packets(t)

        self._update_acn(t)
        self._age_predictions(FRAME_DT)
        self._update_links()
        if self.frame_index % FRESNEL_EVERY_STEPS == 0:
            self._refresh_fresnel()

        rs = self._run_scheduler("static", self.static_scheduler, self.nodes_static, t)
        rt = self._run_scheduler("tac", self.dynamic_scheduler, self.nodes_tac, t)

        m.static_goodput_bits += rs["goodput_bits"]
        m.static_wasted_bits += rs["wasted_bits"]
        m.tac_goodput_bits += rt["goodput_bits"]
        m.tac_wasted_bits += rt["wasted_bits"]
        m.static_dropped_pkts, m.tac_dropped_pkts = rs["dropped_pkts"], rt["dropped_pkts"]
        m.last_static_util_pct, m.last_tac_util_pct = rs["util_pct"], rt["util_pct"]

        self.comparison_stats["static_goodput_bits"] = m.static_goodput_bits
        self.comparison_stats["tac_goodput_bits"] = m.tac_goodput_bits
        self.comparison_stats["static_wasted_bits"] = m.static_wasted_bits
        self.comparison_stats["tac_wasted_bits"] = m.tac_wasted_bits
        self.comparison_stats["static_dropped_pkts"] = m.static_dropped_pkts
        self.comparison_stats["tac_dropped_pkts"] = m.tac_dropped_pkts

        self._last_static, self._last_tac = rs, rt

        # Active Transfer & ACK state machine
        active_nodes = self._active_nodes()
        qos_map = {"SOS": 69, "C2": 69, "EMERGENCY": 69, "VOICE": 65, "PTT": 65, "VIDEO": 67, "PHOTO": 70, "IMAGE": 70}

        for n in active_nodes:
            nid = n.node_id
            trans = self.node_transfers.get(nid)
            if not trans or trans.get("status") in ("IDLE", "ACKNOWLEDGED", "FAILED_DROPPED"):
                continue

            active_t = trans.get("active_type", "SOS")
            target_qos = qos_map.get(active_t, 69)

            ps = self.pred_states.get(nid)
            curr_state = ps.current_state if ps else NodeTerrainState.NORMAL_LOS

            if curr_state == NodeTerrainState.HARD_SHADOW_CUTOFF and trans["status"] == "TRANSMITTING":
                trans["status"] = "BLOCKED_NLOS"
                trans["status_message"] = "TERRAIN OCCLUSION: Link severed by ridge. Uplink paused."
            elif curr_state != NodeTerrainState.HARD_SHADOW_CUTOFF and trans["status"] == "BLOCKED_NLOS":
                trans["status"] = "TRANSMITTING"
                trans["status_message"] = "RE-EMERGED: Resuming uplink transfer."

            curr_q_drops = getattr(n.queue, "total_dropped_deadline", 0) + getattr(n.queue, "total_dropped_overflow", 0)
            last_drops = trans.get("_last_queue_drops", curr_q_drops)
            delta_drops = max(0, curr_q_drops - last_drops)
            trans["_last_queue_drops"] = curr_q_drops

            if delta_drops > 0:
                avg_sz = QOS_PROFILES.get(target_qos, {}).get("default_bytes", 1200)
                trans["dropped_packets"] += delta_drops
                trans["dropped_bytes"] += delta_drops * avg_sz

            ls = self.link_status.get(nid)
            is_outage = ls.is_outage if ls else True

            if not is_outage and trans["status"] == "TRANSMITTING":
                served_bytes = n.last_served.get(target_qos, 0)
                if served_bytes > 0:
                    trans["delivered_bytes"] = min(
                        trans["total_bytes"],
                        trans["delivered_bytes"] + served_bytes
                    )

                    if active_t in ("SOS", "C2", "EMERGENCY"):
                        trans["status"] = "ACKNOWLEDGED"
                        trans["ack_time_s"] = self.sim_time_s
                        trans["status_message"] = f"[✓] SOS ACKNOWLEDGED BY ACN AT T+{self.sim_time_s:.2f}s"
                    elif active_t in ("PHOTO", "VIDEO", "VOICE") and trans["delivered_bytes"] >= trans["total_bytes"]:
                        trans["status"] = "ACKNOWLEDGED"
                        trans["ack_time_s"] = self.sim_time_s
                        trans["status_message"] = f"[✓] {active_t} FULLY DELIVERED & ACKNOWLEDGED AT T+{self.sim_time_s:.2f}s"

            subq_len = len(n.queue.subqueues.get(target_qos, [])) if hasattr(n.queue, "subqueues") else 0
            if trans["status"] in ("TRANSMITTING", "BLOCKED_NLOS"):
                if trans["dropped_packets"] > 0 and subq_len == 0 and trans["delivered_bytes"] < trans["total_bytes"]:
                    trans["status"] = "FAILED_DROPPED"
                    trans["status_message"] = f"[✖] {active_t} FAILED: Packets expired/dropped in mountain shadow!"

        self._track_node4()

    def _node4_state(self) -> Optional[str]:
        ps = self.pred_states.get(4)
        return ps.current_state.name if ps is not None else None

    def _track_node4(self) -> None:
        name = self._node4_state()
        if name is None:
            return
        kb_t = self.nodes_tac[4].total_backlog_bytes() / 1024.0
        kb_s = self.nodes_static[4].total_backlog_bytes() / 1024.0
        m = self.metrics
        if name in ("NORMAL_LOS", "PRE_OCCLUSION_FLUSH"):
            m.node4_pre_shadow_backlog_kb, m.static_node4_pre_shadow_backlog_kb = kb_t, kb_s
            self._node4_frozen = False
        elif name == "HARD_SHADOW_CUTOFF" and not self._node4_frozen:
            m.node4_pre_shadow_backlog_kb, m.static_node4_pre_shadow_backlog_kb = kb_t, kb_s
            self._node4_frozen = True

    def _node4_evac_status(self) -> str:
        name = self._node4_state()
        if name is None:
            return "N/A"
        kb = self.nodes_tac[4].total_backlog_bytes() / 1024.0
        return {
            "NORMAL_LOS": "NOMINAL",
            "PRE_OCCLUSION_FLUSH": f"EVACUATING {kb:.1f} KB",
            "HARD_SHADOW_CUTOFF": "SHADOWED - BUFFERING",
            "RE_EMERGENCE_BURST": "BURST RECOVERY",
        }.get(name, name)

    @staticmethod
    def _times(ps: PredictiveState) -> tuple[float, float]:
        st = ps.current_state
        tto = ps.time_to_occlusion_s if st in (NodeTerrainState.NORMAL_LOS, NodeTerrainState.PRE_OCCLUSION_FLUSH) else -1.0
        tte = ps.time_to_emergence_s if st in (NodeTerrainState.HARD_SHADOW_CUTOFF, NodeTerrainState.RE_EMERGENCE_BURST) else -1.0
        return _f(tto, -1.0, 2), _f(tte, -1.0, 2)

    def _build_frame(self) -> dict[str, Any]:
        px, py, pz = self._acn_pos
        vx, vy = self._acn_vel[0], self._acn_vel[1]
        active = self._active_nodes()

        nodes_tel = []
        flush_node = None
        cutoff_node = None
        burst_node = None

        for node in active:
            ls = self.link_status.get(node.node_id)
            ps = self.pred_states.get(node.node_id) or _default_pred()
            tto, tte = self._times(ps)
            bl = node.get_backlog_counts()

            if ps.current_state == NodeTerrainState.PRE_OCCLUSION_FLUSH and flush_node is None:
                flush_node = (node, ps)
            elif ps.current_state == NodeTerrainState.HARD_SHADOW_CUTOFF and cutoff_node is None:
                cutoff_node = (node, ps)
            elif ps.current_state == NodeTerrainState.RE_EMERGENCE_BURST and burst_node is None:
                burst_node = (node, ps)

            q = node.queue
            c2_b = q.get_class_backlog_bytes(69) if hasattr(q, "get_class_backlog_bytes") else sum(p.size_bytes for p in q.subqueues.get(69, []))
            voice_b = q.get_class_backlog_bytes(65) if hasattr(q, "get_class_backlog_bytes") else sum(p.size_bytes for p in q.subqueues.get(65, []))
            video_b = q.get_class_backlog_bytes(67) if hasattr(q, "get_class_backlog_bytes") else sum(p.size_bytes for p in q.subqueues.get(67, []))
            photo_b = q.get_class_backlog_bytes(70) if hasattr(q, "get_class_backlog_bytes") else sum(p.size_bytes for p in q.subqueues.get(70, []))

            nodes_tel.append({
                "node_id": int(node.node_id), "name": node.name, "node_type": node.node_type,
                "x_m": _f(node.x_m, 0.0, 1), "y_m": _f(node.y_m, 0.0, 1), "z_m": _f(node.z_m, 0.0, 1),
                "slant_range_km": _f(ls.slant_range_m / 1000.0 if ls else 0.0, 0.0, 3),
                "snr_db": _f(ls.snr_db if ls else -99.0, -99.0, 2),
                "modcod_name": str(ls.modcod if ls else "LINK_OUTAGE"),
                "bitrate_bps": _f(ls.bitrate_bps if ls else 0.0, 0.0, 0),
                "bitrate_mbps": _f((ls.bitrate_bps / 1e6) if ls else 0.0, 0.0, 3),
                "state_name": ps.current_state.name,
                "time_to_occlusion_s": tto, "time_to_emergence_s": tte,
                "fresnel_clearance_m": _f(ps.fresnel_clearance_m, 0.0, 1),
                "c2_backlog": bl["c2"], "voice_backlog": bl["voice"],
                "video_backlog": bl["video"], "photo_backlog": bl["photo"],
                "c2_bytes": int(c2_b), "voice_bytes": int(voice_b),
                "video_bytes": int(video_b), "photo_bytes": int(photo_b),
                "total_backlog_bytes": int(node.total_backlog_bytes()),
            })

        if flush_node:
            node_item, ps_item = flush_node
            t_rem = ps_item.time_to_occlusion_s if ps_item.time_to_occlusion_s >= 0 else 0.0
            narrative = f"LOOK-AHEAD EVENT: {node_item.name} predicted to enter mountain shadow in {t_rem:.1f}s. Tac-TAD expanded its slot to evacuate queue backlog before cutoff. Static TDMA takes no predictive action."
        elif cutoff_node:
            node_item, _ = cutoff_node
            narrative = f"TERRAIN OUTAGE: {node_item.name} line-of-sight is severed by mountain ridge. Static TDMA is wasting frame time radiating into rock. Tac-TAD reclaims 100% of the slot for other units."
        elif burst_node:
            node_item, _ = burst_node
            narrative = f"RE-EMERGENCE: {node_item.name} cleared the ridge. Tac-TAD allocated an immediate zero-contention burst to restore tactical comms."
        else:
            narrative = f"NOMINAL PATROL: All terminals in clear Line-of-Sight. ACN coverage bubble tracking along elliptical orbit at FL500 (5,000m). Tac-TAD operating at nominal frame utilization."

        m = self.metrics
        sg, tg = m.static_goodput_bits, m.tac_goodput_bits
        sw, tw = m.static_wasted_bits, m.tac_wasted_bits
        sd, td = m.static_dropped_pkts, m.tac_dropped_pkts
        se, te = max(m.static_enqueued_pkts, 1), max(m.tac_enqueued_pkts, 1)

        active_report = self._last_tac if self.scheduler_mode == "tac_tad" else self._last_static
        kpi = {
            "static_goodput_mb": _f(sg / 1e6, 0.0, 2),
            "tac_goodput_mb": _f(tg / 1e6, 0.0, 2),
            "gain_multiplier": _f(tg / max(sg, 1.0), 1.0, 2),
            "static_waste_pct": _f(sw / (sg + sw) * 100.0 if (sg + sw) > 0 else 0.0, 0.0, 1),
            "tac_waste_pct": _f(tw / (tg + tw) * 100.0 if (tg + tw) > 0 else 0.0, 0.0, 1),
            "static_drops": int(sd),
            "static_drop_pct": _f(sd / se * 100.0, 0.0, 1),
            "tac_drops": int(td),
            "tac_drop_pct": _f(td / te * 100.0, 0.0, 1),
            "ul_utilization_pct": _f(active_report["util_pct"], 0.0, 1),
            "node4_pre_shadow_backlog_kb": _f(m.node4_pre_shadow_backlog_kb, 0.0, 1),
            "static_node4_pre_shadow_backlog_kb": _f(m.static_node4_pre_shadow_backlog_kb, 0.0, 1),
            "node4_evac_status": self._node4_evac_status(),
        }

        transfer = self.node_transfers.get(self.selected_node_id, {})
        tot_b = int(transfer.get("total_bytes", 0))
        deliv_b = int(transfer.get("delivered_bytes", 0))
        drop_b = int(transfer.get("dropped_bytes", 0))
        drop_p = int(transfer.get("dropped_packets", 0))
        progress_pct = round((deliv_b / max(1, tot_b)) * 100.0, 1) if tot_b > 0 else 0.0

        transfer_tel = {
            "node_id": self.selected_node_id,
            "status": transfer.get("status", "IDLE"),
            "status_message": transfer.get("status_message", ""),
            "active_type": transfer.get("active_type", None),
            "total_bytes": tot_b,
            "delivered_bytes": deliv_b,
            "dropped_bytes": drop_b,
            "dropped_packets": drop_p,
            "progress_pct": progress_pct,
            "start_time_s": _f(transfer.get("start_time_s", -1.0), -1.0, 2),
            "ack_time_s": _f(transfer.get("ack_time_s", -1.0), -1.0, 2),
            "photo_total_bytes": tot_b if transfer.get("active_type") == "PHOTO" else 0,
            "photo_delivered_bytes": deliv_b if transfer.get("active_type") == "PHOTO" else 0,
            "photo_progress_pct": progress_pct if transfer.get("active_type") == "PHOTO" else 0.0,
            "sos_sent_time_s": _f(transfer.get("start_time_s", -1.0), -1.0, 2) if transfer.get("active_type") == "SOS" else -1.0,
            "sos_ack_time_s": _f(transfer.get("ack_time_s", -1.0), -1.0, 2) if transfer.get("active_type") == "SOS" else -1.0,
            "sos_is_acked": transfer.get("status") == "ACKNOWLEDGED" and transfer.get("active_type") == "SOS",
        }

        return {
            "frame_index": int(self.frame_index),
            "sim_time_s": _f(self.sim_time_s, 0.0, 3),
            "speed": self.speed,
            "paused": self.speed <= 0.0,
            "scheduler_mode": self.scheduler_mode,
            "selected_node_id": self.selected_node_id,
            "plain_english_narrative": narrative,
            "acn_telemetry": {
                "pos_x": _f(px, 0.0, 1), "pos_y": _f(py, 0.0, 1), "pos_z": _f(pz, 0.0, 1),
                "vel_x": _f(vx, 0.0, 2), "vel_y": _f(vy, 0.0, 2),
                "heading_rad": _f(math.atan2(vy, vx), 0.0, 4),
                "coverage_radius_m": _f(self.flight_cfg.coverage_radius_km * 1000.0, 35000.0, 1),
                "coverage_radius_km": _f(self.flight_cfg.coverage_radius_km, 35.0, 1),
                "flight_path": self.compute_flight_path(64),
            },
            "nodes_telemetry": nodes_tel,
            "active_gantt_allocations": list(active_report["allocations"]),
            "comparative_kpi_dashboard": kpi,
            "selected_node_fresnel": self.fresnel_slice,
            "transfer_telemetry": transfer_tel,
            "terrain_mode": self.terrain.terrain_mode,
        }

    async def tick_simulation(self) -> dict[str, Any]:
        """Advance simulation by 20 ms x speed factor, then return sanitized TelemetryFrame."""
        self._step_accum += self.speed
        whole = int(self._step_accum)
        self._step_accum -= whole
        steps = min(whole, 12)
        did = self._terrain_maintenance(self.sim_time_s, running=steps > 0)
        for _ in range(steps):
            self._step()
        if did:
            if steps == 0:
                self._update_links()
                self._track_node4()
            self._refresh_fresnel()
        frame = self._build_frame()
        await asyncio.sleep(0)
        return _json_safe(frame)

    def _check_node(self, node_id: int) -> int:
        node_id = int(node_id)
        if not 0 <= node_id < NUM_NODES:
            raise ValueError(f"node_id {node_id} out of range")
        return node_id

    def move_node(self, node_id: int, new_x_m: float, new_y_m: float) -> None:
        """Update terminal position in O(1) time without blocking the event loop."""
        x = float(np.clip(_f(new_x_m), -THEATER_HALF_M, THEATER_HALF_M))
        y = float(np.clip(_f(new_y_m), -THEATER_HALF_M, THEATER_HALF_M))
        if int(node_id) == ACN_ID:
            fc = self.flight_cfg
            fc.center_x_m = float(fc.center_x_m) + (x - self._acn_pos[0])
            fc.center_y_m = float(fc.center_y_m) + (y - self._acn_pos[1])
            self._acn_pos = (x, y, self._acn_pos[2])
            self._all_dirty = True
            return
        nid = self._check_node(node_id)
        z = self._ground_z(x, y)
        for nodes in (self.nodes_static, self.nodes_tac):
            nodes[nid].set_position(x, y, z)
        self._dirty.add(nid)

    def _set_cfg_attr(self, group: str, attr: str, value: float) -> None:
        cfg = {"rf": self.rf_cfg, "env": self.env_cfg, "flight": self.flight_cfg}[group]
        try:
            setattr(cfg, attr, value)
        except AttributeError:
            setattr(self, f"{group}_cfg", dataclasses.replace(cfg, **{attr: value}))

    def update_config(self, params: dict[str, Any]) -> dict[str, Any]:
        applied: dict[str, Any] = {}

        # 1. Dynamic Terrain Mode Toggle ('real' or 'synthetic')
        if "terrain_mode" in params:
            target_mode = str(params["terrain_mode"]).lower().strip()
            if target_mode in ("real", "synthetic"):
                active_mode = self.terrain.set_terrain_mode(target_mode)
                applied["terrain_mode"] = active_mode
                self.generate_hillshade_grid(512)
                self._all_dirty = True
                for nodes in (self.nodes_static, self.nodes_tac):
                    for n in nodes:
                        n.z_m = self._ground_z(n.x_m, n.y_m)
                        n.position = (n.x_m, n.y_m, n.z_m)

        # 2. Standard RF, Environmental, and Flight Parameters
        for raw_key, raw_val in (params or {}).items():
            if raw_key == "terrain_mode":
                continue
            key = _PARAM_ALIASES.get(raw_key, raw_key)
            if key not in _CONFIG_BINDINGS:
                continue
            value = _f(raw_val, float("nan"))
            if not math.isfinite(value):
                continue
            if raw_key in _KM_PARAMS:
                value *= 1000.0
            group, attr, scale, lo, hi = _CONFIG_BINDINGS[key]
            value = min(max(value, lo), hi)
            self._set_cfg_attr(group, attr, value * scale)
            applied[key] = value

        if applied:
            self._rebuild_engines()
            self._all_dirty = True
        return applied

    def load_preset(self, preset_id: str) -> dict[str, Any]:
        """Loads and activates a curated tactical storytelling preset scenario."""
        pid = str(preset_id).strip().upper()

        if pid in ("PRESET_OCCLUSION", "OCCLUSION"):
            self.move_node(4, 12000.0, 8000.0)
            self.select_node(4)
            num_pkts = math.ceil(40_000 / 1400)
            for _ in range(num_pkts):
                for target_nodes in (self.nodes_static, self.nodes_tac):
                    target_nodes[4]._enqueue(70, self.sim_time_s, size_bytes=1400, deadline_s=self.sim_time_s + 60.0)
            self.node_transfers[4] = {
                "active_type": "PHOTO",
                "total_bytes": 40_000,
                "delivered_bytes": 0,
                "dropped_bytes": 0,
                "dropped_packets": 0,
                "status": "TRANSMITTING",
                "status_message": "PRESET OCCLUSION: Node 4 stationed on ridge approach with 40 KB imagery backlog.",
                "start_time_s": self.sim_time_s,
                "ack_time_s": -1.0,
                "_last_queue_drops": 0,
            }
            return {"ok": True, "preset": "PRESET_OCCLUSION"}

        elif pid in ("PRESET_AMBUSH", "AMBUSH"):
            self.update_config({"rain_rate_mmh": 0.0})
            self.select_node(1)
            for _ in range(20):
                for target_nodes in (self.nodes_static, self.nodes_tac):
                    target_nodes[1]._enqueue(69, self.sim_time_s, size_bytes=128, deadline_s=self.sim_time_s + 60.0)
            self.node_transfers[1] = {
                "active_type": "SOS",
                "total_bytes": 20 * 128,
                "delivered_bytes": 0,
                "dropped_bytes": 0,
                "dropped_packets": 0,
                "status": "TRANSMITTING",
                "status_message": "PRESET AMBUSH: Ambush triggered! 20 C2 SOS packets broadcast by Squad Leader.",
                "start_time_s": self.sim_time_s,
                "ack_time_s": -1.0,
                "_last_queue_drops": 0,
            }
            for _ in range(35):
                for target_nodes in (self.nodes_static, self.nodes_tac):
                    target_nodes[15]._enqueue(67, self.sim_time_s, size_bytes=1200, deadline_s=self.sim_time_s + 2.0)
            self.node_transfers[15] = {
                "active_type": "VIDEO",
                "total_bytes": 35 * 1200,
                "delivered_bytes": 0,
                "dropped_bytes": 0,
                "dropped_packets": 0,
                "status": "TRANSMITTING",
                "status_message": "PRESET AMBUSH: 35 Video burst packets generating from MCP Command Post.",
                "start_time_s": self.sim_time_s,
                "ack_time_s": -1.0,
                "_last_queue_drops": 0,
            }
            return {"ok": True, "preset": "PRESET_AMBUSH"}

        elif pid in ("PRESET_MONSOON", "MONSOON"):
            self.update_config({"rain_rate_mmh": 35.0})
            return {"ok": True, "preset": "PRESET_MONSOON", "rain_rate_mm_h": 35.0}

        elif pid in ("PRESET_RESET", "RESET"):
            self.reset()
            return {"ok": True, "preset": "PRESET_RESET"}

        return {"ok": False, "error": f"Unknown preset '{preset_id}'"}

    def inject_traffic(self, node_id: int, traffic_type: str) -> int:
        nid = self._check_node(node_id)
        ttype = TRAFFIC_ALIASES.get(str(traffic_type).upper(), str(traffic_type).upper())

        total_b = 2_560
        if ttype == "PHOTO":
            total_b = 2_000_000
        elif ttype == "VIDEO":
            total_b = 42_000
        elif ttype == "VOICE":
            total_b = 8_000

        ps = self.pred_states.get(nid)
        curr_state = ps.current_state if ps else NodeTerrainState.NORMAL_LOS
        if curr_state == NodeTerrainState.HARD_SHADOW_CUTOFF:
            init_status = "BLOCKED_NLOS"
            init_msg = "TERRAIN BLOCKED: Node is in mountain shadow! Packet buffered awaiting re-emergence."
        else:
            init_status = "TRANSMITTING"
            init_msg = "TRANSMITTING: Radio uplink active."

        node_obj = self.nodes_tac[nid] if self.scheduler_mode == "tac_tad" else self.nodes_static[nid]
        curr_drops = getattr(node_obj.queue, "total_dropped_deadline", 0) + getattr(node_obj.queue, "total_dropped_overflow", 0)

        self.node_transfers[nid] = {
            "active_type": ttype,
            "total_bytes": total_b,
            "delivered_bytes": 0,
            "dropped_bytes": 0,
            "dropped_packets": 0,
            "status": init_status,
            "status_message": init_msg,
            "start_time_s": self.sim_time_s,
            "ack_time_s": -1.0,
            "_last_queue_drops": curr_drops,
        }

        ns = self.nodes_static[nid].inject_traffic(ttype, self.sim_time_s)
        nt = self.nodes_tac[nid].inject_traffic(ttype, self.sim_time_s)
        self.metrics.static_enqueued_pkts += ns
        self.metrics.tac_enqueued_pkts += nt
        return nt

    def set_scheduler_mode(self, mode: str) -> str:
        norm = SCHEDULER_ALIASES.get(str(mode).lower())
        if norm is None:
            raise ValueError(f"unknown scheduler mode '{mode}'")
        self.scheduler_mode = norm
        return norm

    def set_simulation_speed(self, speed: float) -> float:
        s = float(np.clip(_f(speed, 1.0), 0.0, 10.0))
        if s > 0.0:
            self._speed_before_pause = s
        self.speed = s
        return s

    def select_node(self, node_id: int) -> None:
        self.selected_node_id = self._check_node(node_id)
        self._refresh_fresnel()

    def clear_transfer(self, node_id: Optional[int] = None) -> None:
        nid = self.selected_node_id if node_id is None else self._check_node(node_id)
        if nid in self.node_transfers:
            self.node_transfers[nid] = {
                "active_type": None,
                "total_bytes": 0,
                "delivered_bytes": 0,
                "dropped_bytes": 0,
                "dropped_packets": 0,
                "status": "IDLE",
                "status_message": "",
                "start_time_s": -1.0,
                "ack_time_s": -1.0,
                "_last_queue_drops": 0,
            }

    def sim_control(self, msg: dict[str, Any]) -> None:
        action = str(msg.get("action", "SET_SPEED")).upper()
        if action == "PAUSE":
            self.set_simulation_speed(0.0)
        elif action == "RESUME":
            self.set_simulation_speed(self._speed_before_pause or 1.0)
        elif action == "RESET":
            self.reset()
        elif action == "STEP":
            self.speed = 0.0
            self._step()
            self._refresh_fresnel()
        elif action in ("LOAD_PRESET", "PRESET"):
            self.load_preset(msg.get("preset_id", ""))
        elif action in ("CLEAR_TRANSFER", "DISMISS_TRANSFER"):
            self.clear_transfer(msg.get("node_id"))
        elif action in ("SET_SPEED", "SPEED"):
            v = msg.get("value", msg.get("speed", 1.0))
            self.set_simulation_speed(1.0 if v is None else v)
        elif action in ("SET_SCHEDULER", "SCHEDULER"):
            self.set_scheduler_mode(msg.get("mode", "tac_tad"))
        elif action == "SELECT_NODE":
            self.select_node(msg.get("node_id", 4))
        else:
            raise ValueError(f"unknown SIM_CONTROL action '{action}'")

    def handle_message(self, msg: dict[str, Any]) -> None:
        mtype = str(msg.get("type", "")).upper()
        if mtype == "NODE_MOVE":
            self.move_node(int(msg["node_id"]), msg.get("x_m", msg.get("new_x_m", 0.0)),
                           msg.get("y_m", msg.get("new_y_m", 0.0)))
        elif mtype in ("CONFIG_UPDATE", "SET_CONFIG"):
            self.update_config(msg.get("params", msg))
        elif mtype == "LOAD_PRESET":
            self.load_preset(msg.get("preset_id", ""))
        elif mtype == "INJECT_TRAFFIC":
            self.inject_traffic(int(msg.get("node_id", self.selected_node_id)), msg.get("traffic_type", "SOS"))
        elif mtype in ("CLEAR_TRANSFER", "DISMISS_TRANSFER"):
            self.clear_transfer(msg.get("node_id"))
        elif mtype == "SIM_CONTROL":
            self.sim_control(msg)
        elif mtype == "SET_SCHEDULER":
            self.set_scheduler_mode(msg.get("mode", "tac_tad"))
        elif mtype == "SELECT_NODE":
            self.select_node(int(msg.get("node_id", 4)))
        else:
            raise ValueError(f"unknown message type '{mtype}'")

    handle_command = handle_message

    def config_snapshot(self) -> dict[str, Any]:
        return {
            "orbit_a_m": _f(self.flight_cfg.loiter_radius_a_m),
            "orbit_b_m": _f(self.flight_cfg.loiter_radius_b_m),
            "orbit_rotation_deg": _f(self.flight_cfg.loiter_rotation_deg),
            "acn_altitude_m": _f(self.flight_cfg.altitude_msl_m),
            "coverage_radius_km": _f(self.flight_cfg.coverage_radius_km),
            "coverage_radius_m": _f(self.flight_cfg.coverage_radius_km * 1000.0),
            "carrier_freq_ghz": _f(self.rf_cfg.carrier_frequency_hz / 1e9),
            "bandwidth_mhz": _f(self.rf_cfg.channel_bandwidth_hz / 1e6),
            "rain_rate_mmh": _f(self.env_cfg.rain_rate_mm_h),
            "scheduler_mode": self.scheduler_mode,
            "speed": self.speed,
            "selected_node_id": self.selected_node_id,
            "terrain_mode": self.terrain.terrain_mode,
        }

    def load_custom_terrain_array(self, elev_grid: np.ndarray, source: str = "custom") -> tuple[float, float]:
        """
        Saves custom or satellite raster to data/terrain/custom_uploaded_dem.npy,
        resamples to 512x512, re-indexes the terrain engine, regenerates the hillshade,
        and recalculates all node ground levels.
        """
        grid = np.asarray(elev_grid, dtype=np.float32)
        if grid.shape != (512, 512):
            zoom_factors = (512.0 / grid.shape[0], 512.0 / grid.shape[1])
            grid = zoom(grid, zoom_factors, order=1).astype(np.float32)

        CUSTOM_DEM_PATH.parent.mkdir(parents=True, exist_ok=True)
        np.save(CUSTOM_DEM_PATH, grid)

        self.terrain.load_custom_dem(str(CUSTOM_DEM_PATH))
        self.generate_hillshade_grid(512)
        self._all_dirty = True

        # Re-ground all active terminals across the 600 km domain
        for nodes in (self.nodes_static, self.nodes_tac):
            for n in nodes:
                n.z_m = self._ground_z(n.x_m, n.y_m)
                n.position = (n.x_m, n.y_m, n.z_m)

        min_alt = float(grid.min())
        max_alt = float(grid.max())
        return min_alt, max_alt


# ----------------------------------------------------------------------------------------
# Broadcast hub: ONE simulation clock shared by every connected client
# ----------------------------------------------------------------------------------------
class TelemetryHub:
    def __init__(self, sim: SimulationManager) -> None:
        self.sim = sim
        self.clients: set[WebSocket] = set()
        self._task: Optional[asyncio.Task] = None

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    @staticmethod
    async def _send(ws: WebSocket, payload: str) -> bool:
        try:
            await asyncio.wait_for(ws.send_text(payload), timeout=1.0)
            return True
        except Exception:
            return False

    async def broadcast(self, msg: dict[str, Any]) -> None:
        """Broadcasts a JSON control or telemetry message to all connected clients."""
        payload = json.dumps(_json_safe(msg), separators=(",", ":"))
        for ws in list(self.clients):
            await self._send(ws, payload)

    async def _run(self) -> None:
        next_tick = time.perf_counter()
        while self.clients:
            try:
                frame = await self.sim.tick_simulation()
                try:
                    payload = json.dumps(frame, allow_nan=False, separators=(",", ":"))
                except (ValueError, TypeError):
                    payload = json.dumps(_json_safe(frame), separators=(",", ":"))
                targets = list(self.clients)
                results = await asyncio.gather(*(self._send(ws, payload) for ws in targets))
                for ws, ok in zip(targets, results):
                    if not ok:
                        self.clients.discard(ws)
            except Exception:
                traceback.print_exc()
            next_tick += FRAME_DT
            delay = next_tick - time.perf_counter()
            if delay > 0:
                await asyncio.sleep(delay)
            else:
                if delay < -0.5:
                    next_tick = time.perf_counter()
                await asyncio.sleep(0)


# ----------------------------------------------------------------------------------------
# FastAPI application & REST endpoints
# ----------------------------------------------------------------------------------------
app = FastAPI(title="Tactical X-Band Air-to-Ground Network Digital Twin")
sim = SimulationManager()
hub = TelemetryHub(sim)

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR), check_dir=False), name="static")


class NodeMoveRequest(BaseModel):
    node_id: int
    x_m: float
    y_m: float


class InjectRequest(BaseModel):
    node_id: int
    traffic_type: str


class ControlRequest(BaseModel):
    action: str = "SET_SPEED"
    speed: Optional[float] = None
    value: Optional[float] = None
    mode: Optional[str] = None
    node_id: Optional[int] = None
    preset_id: Optional[str] = None


class PresetRequest(BaseModel):
    preset_id: str


def _error(exc: Exception, status: int = 400) -> JSONResponse:
    return JSONResponse({"ok": False, "error": str(exc)}, status_code=status)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/api/terrain/hillshade")
@app.get("/api/terrain/hillshade-grid")
async def get_hillshade() -> dict[str, Any]:
    return {
        "grid_size": 512,
        "bounds_km": 300,
        "terrain_mode": sim.terrain.terrain_mode,
        "data": sim.hillshade_grid,
    }


@app.post("/api/terrain/upload")
async def post_terrain_upload(file: UploadFile = File(...)) -> JSONResponse:
    """
    Accepts multipart file upload (.npy, .png, .jpg, .csv), decodes the elevation,
    resamples to 512x512 float32, re-indexes the terrain engine, and broadcasts update.
    """
    try:
        filename = (file.filename or "uploaded").lower()
        contents = await file.read()

        if filename.endswith(".npy"):
            grid = np.load(io.BytesIO(contents)).astype(np.float32)
        elif filename.endswith((".png", ".jpg", ".jpeg")):
            img = Image.open(io.BytesIO(contents)).convert("L")
            arr = np.asarray(img, dtype=np.float32)
            arr_norm = (arr - arr.min()) / max(1e-6, (arr.max() - arr.min()))
            grid = 2500.0 + arr_norm * 3500.0  # Normalized to [2500m, 6000m]
        elif filename.endswith(".csv"):
            grid = np.loadtxt(io.StringIO(contents.decode("utf-8")), delimiter=",").astype(np.float32)
        else:
            return JSONResponse(
                {"status": "error", "message": "Unsupported format. Please upload .npy, .png, .jpg, or .csv"},
                status_code=400,
            )

        min_alt, max_alt = sim.load_custom_terrain_array(grid, source="custom")
        await hub.broadcast({
            "type": "TERRAIN_UPDATED",
            "source": "custom",
            "min_alt_m": min_alt,
            "max_alt_m": max_alt,
        })
        return JSONResponse({
            "status": "success",
            "message": "Custom terrain loaded successfully",
            "min_alt_m": round(min_alt, 1),
            "max_alt_m": round(max_alt, 1),
        })
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=400)


@app.post("/api/terrain/fetch-satellite")
async def post_fetch_satellite() -> JSONResponse:
    """
    Triggers AWS Terrarium real satellite DEM acquisition in a background executor,
    re-generates live relief across the 600 km theater, and broadcasts an update.
    """
    try:
        loop = asyncio.get_event_loop()
        ok, msg, dem_array = await loop.run_in_executor(None, fetch_satellite_dem)
        if not ok or dem_array is None:
            return JSONResponse({"status": "error", "message": msg}, status_code=502)

        min_alt, max_alt = sim.load_custom_terrain_array(dem_array, source="satellite")
        await hub.broadcast({
            "type": "TERRAIN_UPDATED",
            "source": "satellite",
            "min_alt_m": min_alt,
            "max_alt_m": max_alt,
        })
        return JSONResponse({
            "status": "success",
            "message": "Real satellite DEM fetched and bound successfully",
            "min_alt_m": round(min_alt, 1),
            "max_alt_m": round(max_alt, 1),
        })
    except Exception as exc:
        traceback.print_exc()
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=500)


@app.get("/api/config")
async def get_config() -> dict[str, Any]:
    return sim.config_snapshot()


@app.post("/api/config")
async def post_config(params: dict[str, Any]) -> JSONResponse:
    try:
        return JSONResponse({"ok": True, "applied": sim.update_config(params)})
    except Exception as exc:
        traceback.print_exc()
        return _error(exc)


@app.post("/api/preset")
async def post_preset(req: PresetRequest) -> JSONResponse:
    try:
        res = sim.load_preset(req.preset_id)
        return JSONResponse(res)
    except Exception as exc:
        traceback.print_exc()
        return _error(exc)


@app.post("/api/node/move")
async def post_move(req: NodeMoveRequest) -> JSONResponse:
    try:
        sim.move_node(req.node_id, req.x_m, req.y_m)
        return JSONResponse({"ok": True})
    except Exception as exc:
        traceback.print_exc()
        return _error(exc)


@app.post("/api/traffic/inject")
async def post_inject(req: InjectRequest) -> JSONResponse:
    try:
        return JSONResponse({"ok": True, "enqueued_pkts": sim.inject_traffic(req.node_id, req.traffic_type)})
    except Exception as exc:
        traceback.print_exc()
        return _error(exc)


@app.post("/api/control")
async def post_control(req: ControlRequest) -> JSONResponse:
    try:
        data = req.model_dump() if hasattr(req, "model_dump") else req.dict()
        sim.sim_control({k: v for k, v in data.items() if v is not None})
        return JSONResponse({"ok": True, "state": sim.config_snapshot()})
    except Exception as exc:
        traceback.print_exc()
        return _error(exc)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            raw = message.get("text")
            if raw is None and message.get("bytes") is not None:
                raw = message["bytes"].decode("utf-8", errors="replace")
            if not raw:
                continue
            try:
                sim.handle_message(json.loads(raw))
            except Exception:
                traceback.print_exc()
    except Exception:
        traceback.print_exc()
    finally:
        hub.disconnect(ws)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")