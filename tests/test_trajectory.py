"""
tests/test_trajectory.py - Verification Suite for Orbit Kinematics & Predictive Look-Ahead
Tactical X-Band Air-to-Ground Network Digital Twin
"""

import math
import numpy as np
import pytest

from core.config import ACNFlightConfig, EnvironmentConfig, RFConfig
from core.link_budget import LinkBudgetEngine
from core.terrain import TerrainEngine
from core.trajectory import (
    ACNTrajectoryEngine,
    NodeTerrainState,
    PredictiveLookAheadEngine,
)


def test_orbit_kinematics():
    """
    Verifies that tangential airspeed magnitude sqrt(vx^2 + vy^2) remains constant
    at loiter_speed_mps = 60.0 m/s (+/- 1.5 m/s) across both circular and rotated elliptical orbits.
    """
    # 1. Circular Orbit (a = 20 km, b = 20 km)
    cfg_circ = ACNFlightConfig(
        altitude_msl_m=5000.0,
        loiter_radius_a_m=20000.0,
        loiter_radius_b_m=20000.0,
        loiter_rotation_deg=0.0,
        loiter_speed_mps=60.0,
    )
    engine_circ = ACNTrajectoryEngine(cfg_circ)

    for t in [0.0, 50.0, 150.0, 300.0]:
        vx, vy, vz = engine_circ.get_acn_velocity(t)
        speed = math.hypot(vx, vy)
        assert abs(speed - 60.0) <= 1.0, f"Circular speed {speed:.2f} m/s deviated at t={t}"

    # 2. Production Rotated Elliptical Orbit (a = 20 km, b = 10 km, phi = 35 deg)
    cfg_ellipse = ACNFlightConfig(
        altitude_msl_m=5000.0,
        loiter_radius_a_m=20000.0,
        loiter_radius_b_m=10000.0,
        loiter_rotation_deg=35.0,
        loiter_speed_mps=60.0,
    )
    engine_ellipse = ACNTrajectoryEngine(cfg_ellipse)

    for t in [0.0, 100.0, 500.0, 1000.0]:
        vx, vy, vz = engine_ellipse.get_acn_velocity(t)
        speed = math.hypot(vx, vy)
        assert abs(speed - 60.0) <= 1.0, f"Elliptical tangent speed {speed:.2f} m/s deviated at t={t}"

        # Numerical displacement cross-check (Delta r / Delta t)
        dt = 0.5
        p1 = engine_ellipse.get_acn_position(t)
        p2 = engine_ellipse.get_acn_position(t + dt)
        num_speed = math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / dt
        assert abs(num_speed - 60.0) <= 1.5, f"Numerical speed {num_speed:.2f} m/s deviated at t={t}"


def test_predictive_occlusion_transition():
    """
    Verifies that the line-of-sight ray from the ACN to the ground node directly sweeps through
    the mountain obstacle between t = 0 and t = 15 seconds of the production elliptical flight path,
    cleanly experiencing:
        1. NORMAL_LOS (initially clear)
        2. PRE_OCCLUSION_FLUSH (clearance drops with 0 < T_occ <= 5.0s)
        3. HARD_SHADOW_CUTOFF (ray intersects peak, is_outage = True, T_em is finite < 30s)
        4. RE_EMERGENCE_BURST (ray emerges as the ACN continues its orbit)
    """
    rf_cfg = RFConfig()
    env_cfg = EnvironmentConfig()
    flight_cfg = ACNFlightConfig(
        altitude_msl_m=5000.0,
        loiter_radius_a_m=20000.0,
        loiter_radius_b_m=10000.0,
        loiter_rotation_deg=35.0,
        loiter_speed_mps=60.0,
    )
    traj_engine = ACNTrajectoryEngine(flight_cfg)
    link_engine = LinkBudgetEngine()

    # Ground node location in valley
    node_pos = (0.0, 0.0, 1000.0)

    # Position mountain peak obstacle at the ray midpoint for t = 8.5s
    p_acn_target = traj_engine.get_acn_position(8.5)
    obs_x = (node_pos[0] + p_acn_target[0]) * 0.5
    obs_y = (node_pos[1] + p_acn_target[1]) * 0.5
    obs_radius = 90.0  # 90m radius creates a ~6s occlusion duration as ray sweeps at ~30m/s

    def obstacle_terrain(x, y):
        x_arr = np.asarray(x, dtype=float)
        y_arr = np.asarray(y, dtype=float)
        d_obs = np.hypot(x_arr - obs_x, y_arr - obs_y)
        # Peak reaches 4500m MSL (well above the 3000m line-of-sight chord)
        elev = np.where(d_obs < obs_radius, 4500.0, 200.0)
        if np.isscalar(x) and np.isscalar(y):
            return float(elev)
        return elev

    terrain = TerrainEngine(custom_elevation_fn=obstacle_terrain)
    lookahead = PredictiveLookAheadEngine(
        terrain_engine=terrain,
        link_budget_engine=link_engine,
        rf_config=rf_cfg,
        env_config=env_cfg,
        flight_config=flight_cfg,
        trajectory_engine=traj_engine,
        lookahead_horizon_s=30.0,
        step_dt_s=0.25,
        flush_threshold_s=5.0,
        burst_duration_s=2.0,
    )

    seen_states = set()
    flush_detected = False
    cutoff_detected = False
    finite_emergence_in_cutoff = False
    burst_detected = False

    # Dynamic temporal scan from t = 0.0s to t = 15.0s in 0.5s increments
    for step_i in range(31):
        t_s = step_i * 0.5
        ps = lookahead.evaluate_predictive_state(node_pos, current_time_s=t_s)
        state = ps.current_state
        seen_states.add(state)

        if state == NodeTerrainState.PRE_OCCLUSION_FLUSH:
            if 0.0 < ps.time_to_occlusion_s <= 5.0:
                flush_detected = True

        elif state == NodeTerrainState.HARD_SHADOW_CUTOFF:
            cutoff_detected = True
            if math.isfinite(ps.time_to_emergence_s) and ps.time_to_emergence_s < 30.0:
                finite_emergence_in_cutoff = True

            # Verify physical link budget clamps to outage
            acn_pos = traj_engine.get_acn_position(t_s)
            dx = acn_pos[0] - node_pos[0]
            dy = acn_pos[1] - node_pos[1]
            dz = acn_pos[2] - node_pos[2]
            slant = math.hypot(math.hypot(dx, dy), dz)
            _, _, diff_db, _ = terrain.evaluate_terrain_obstruction(node_pos, acn_pos, rf_cfg, env_cfg)
            ls = link_engine.evaluate_link("soldier", slant, diff_db, rf_cfg, env_cfg)
            assert ls.is_outage is True, "Link must report is_outage = True when line-of-sight is severed."

        elif state == NodeTerrainState.RE_EMERGENCE_BURST:
            burst_detected = True

    # Assert that all 4 states were experienced sequentially between t = 0 and t = 15s
    assert NodeTerrainState.NORMAL_LOS in seen_states, "NORMAL_LOS was not achieved (expected initially clear at t=0s)."
    assert flush_detected, "PRE_OCCLUSION_FLUSH was not achieved with 0 < T_occ <= 5.0s."
    assert cutoff_detected, "HARD_SHADOW_CUTOFF was not achieved when ray intersected the peak."
    assert finite_emergence_in_cutoff, "Cutoff failed to provide a finite time_to_emergence_s < 30.0s."
    assert burst_detected, "RE_EMERGENCE_BURST was not achieved upon emerging from mountain shadow."


def test_re_emergence_prediction():
    """
    Verifies that during HARD_SHADOW_CUTOFF, the lookahead engine reliably predicts
    a finite, positive time-to-emergence (< 30.0s) against the production ellipse.
    """
    rf_cfg = RFConfig()
    env_cfg = EnvironmentConfig()
    flight_cfg = ACNFlightConfig(
        altitude_msl_m=5000.0,
        loiter_radius_a_m=20000.0,
        loiter_radius_b_m=10000.0,
        loiter_rotation_deg=35.0,
        loiter_speed_mps=60.0,
    )
    traj_engine = ACNTrajectoryEngine(flight_cfg)
    link_engine = LinkBudgetEngine()

    node_pos = (0.0, 0.0, 1000.0)
    p_acn_target = traj_engine.get_acn_position(8.5)
    obs_x = (node_pos[0] + p_acn_target[0]) * 0.5
    obs_y = (node_pos[1] + p_acn_target[1]) * 0.5
    obs_radius = 90.0

    def peak_terrain(x, y):
        x_arr = np.asarray(x, dtype=float)
        y_arr = np.asarray(y, dtype=float)
        d_obs = np.hypot(x_arr - obs_x, y_arr - obs_y)
        elev = np.where(d_obs < obs_radius, 4500.0, 200.0)
        if np.isscalar(x) and np.isscalar(y):
            return float(elev)
        return elev

    terrain = TerrainEngine(custom_elevation_fn=peak_terrain)
    lookahead = PredictiveLookAheadEngine(
        terrain_engine=terrain,
        link_budget_engine=link_engine,
        rf_config=rf_cfg,
        env_config=env_cfg,
        flight_config=flight_cfg,
        trajectory_engine=traj_engine,
        lookahead_horizon_s=30.0,
        step_dt_s=0.25,
        flush_threshold_s=5.0,
        burst_duration_s=2.0,
    )

    # Evaluate at t = 8.5s when the ray directly intersects the obstacle summit
    ps_cutoff = lookahead.evaluate_predictive_state(node_pos, current_time_s=8.5)
    assert ps_cutoff.current_state == NodeTerrainState.HARD_SHADOW_CUTOFF
    assert 0.0 < ps_cutoff.time_to_emergence_s < 30.0, (
        f"Expected finite emergence time < 30.0s, got {ps_cutoff.time_to_emergence_s}"
    )
    assert math.isfinite(ps_cutoff.time_to_emergence_s)