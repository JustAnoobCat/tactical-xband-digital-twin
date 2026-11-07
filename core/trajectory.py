"""
core/trajectory.py - Kinematics & Predictive Look-Ahead Trajectory Engine
Tactical X-Band Air-to-Ground Network Digital Twin

Implements constant tangential airspeed integration (60 m/s +/- 1 m/s) along rotated
elliptical orbits and orbital predictive look-ahead state classification.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
import math
from typing import Any, Optional, Tuple

import numpy as np

try:
    from core.config import ACNFlightConfig, EnvironmentConfig, RFConfig, SPEED_OF_LIGHT
except ImportError:
    from .config import ACNFlightConfig, EnvironmentConfig, RFConfig, SPEED_OF_LIGHT


# ----------------------------------------------------------------------------------------
# 4-State Predictive Occlusion Machine
# ----------------------------------------------------------------------------------------
class NodeTerrainState(IntEnum):
    NORMAL_LOS = 0
    PRE_OCCLUSION_FLUSH = 1
    HARD_SHADOW_CUTOFF = 2
    RE_EMERGENCE_BURST = 3


@dataclass
class PredictiveState:
    current_state: NodeTerrainState
    time_to_occlusion_s: float
    time_to_emergence_s: float
    fresnel_clearance_m: float
    fresnel_rate_of_change_mps: float = 0.0
    predicted_outage_duration_s: float = 0.0
    apparent_doppler_hz: float = 0.0
    shadow_duration_s: float = 0.0


# ----------------------------------------------------------------------------------------
# Constant-Airspeed Rotated Elliptical Kinematics Engine
# ----------------------------------------------------------------------------------------
class ACNTrajectoryEngine:
    """
    Calculates 3D coordinates and tangential velocity vectors for an ACN loitering along
    a rotated ellipse at a constant true airspeed (v = 60.0 m/s +/- 1.0 m/s).
    
    Uses arc-length parameterized numerical integration to map time t -> parametric angle theta:
        ds/dtheta = sqrt((a * sin(theta))^2 + (b * cos(theta))^2)
        dtheta/dt = loiter_speed_mps / ds_dtheta
    """

    def __init__(self, flight_config: ACNFlightConfig, num_lut_samples: int = 16384) -> None:
        self.flight_config = flight_config
        self.num_lut_samples = num_lut_samples
        self._build_arc_length_lut()

    def _build_arc_length_lut(self) -> None:
        a = float(self.flight_config.loiter_radius_a_m)
        b = float(self.flight_config.loiter_radius_b_m)
        v0 = float(self.flight_config.loiter_speed_mps)

        self.theta_lut = np.linspace(0.0, 2.0 * np.pi, self.num_lut_samples)
        ds_dtheta = np.sqrt((a * np.sin(self.theta_lut)) ** 2 + (b * np.cos(self.theta_lut)) ** 2)

        d_theta = self.theta_lut[1] - self.theta_lut[0]
        s_cumulative = np.zeros(self.num_lut_samples, dtype=float)
        s_cumulative[1:] = np.cumsum(0.5 * (ds_dtheta[:-1] + ds_dtheta[1:]) * d_theta)

        self.s_lut = s_cumulative
        self.total_perimeter_m = float(self.s_lut[-1])

        if self.total_perimeter_m <= 0.0 or v0 <= 0.0:
            self.orbit_period_s = 1.0
        else:
            self.orbit_period_s = self.total_perimeter_m / v0

    def get_orbital_period(self) -> float:
        return self.orbit_period_s

    def _get_theta_at_time(self, t_s: float) -> float:
        if self.total_perimeter_m <= 0.0 or self.orbit_period_s <= 0.0:
            return 0.0
        v0 = float(self.flight_config.loiter_speed_mps)
        distance_along_orbit = (v0 * t_s) % self.total_perimeter_m
        theta = float(np.interp(distance_along_orbit, self.s_lut, self.theta_lut))
        return theta

    def get_acn_position(self, t_s: float) -> Tuple[float, float, float]:
        """Calculates 3D Cartesian coordinates (x, y, z) at time t along rotated ellipse."""
        a = float(self.flight_config.loiter_radius_a_m)
        b = float(self.flight_config.loiter_radius_b_m)
        phi = math.radians(float(self.flight_config.loiter_rotation_deg))
        cx = float(self.flight_config.center_x_m)
        cy = float(self.flight_config.center_y_m)
        cz = float(self.flight_config.altitude_msl_m)

        theta = self._get_theta_at_time(t_s)
        x_raw = a * math.cos(theta)
        y_raw = b * math.sin(theta)

        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)
        x = cx + x_raw * cos_phi - y_raw * sin_phi
        y = cy + x_raw * sin_phi + y_raw * cos_phi
        z = cz
        return (x, y, z)

    def get_acn_velocity(self, t_s: float) -> Tuple[float, float, float]:
        """
        Calculates tangent velocity vector (vx, vy, vz).
        Guarantees tangential magnitude sqrt(vx^2 + vy^2) == loiter_speed_mps (60.0 m/s).
        """
        a = float(self.flight_config.loiter_radius_a_m)
        b = float(self.flight_config.loiter_radius_b_m)
        v0 = float(self.flight_config.loiter_speed_mps)
        phi = math.radians(float(self.flight_config.loiter_rotation_deg))

        theta = self._get_theta_at_time(t_s)

        ds_dtheta = math.sqrt((a * math.sin(theta)) ** 2 + (b * math.cos(theta)) ** 2)
        if ds_dtheta < 1e-9:
            return (0.0, 0.0, 0.0)

        dtheta_dt = v0 / ds_dtheta
        vx_raw = -a * math.sin(theta) * dtheta_dt
        vy_raw = b * math.cos(theta) * dtheta_dt

        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)
        vx = vx_raw * cos_phi - vy_raw * sin_phi
        vy = vx_raw * sin_phi + vy_raw * cos_phi
        vz = 0.0
        return (vx, vy, vz)


# ----------------------------------------------------------------------------------------
# Orbital Predictive Look-Ahead Machine
# ----------------------------------------------------------------------------------------
class PredictiveLookAheadEngine:
    """
    Evaluates current and upcoming Fresnel zone clearances by forward-propagating
    the ACN orbit across the digital elevation model.
    """

    def __init__(
        self,
        terrain_engine: Any,
        link_budget_engine: Any,
        rf_config: RFConfig,
        env_config: EnvironmentConfig,
        flight_config: ACNFlightConfig,
        trajectory_engine: ACNTrajectoryEngine,
        lookahead_horizon_s: float = 12.0,
        step_dt_s: float = 0.25,
        flush_threshold_s: float = 3.0,
        burst_duration_s: float = 2.0,
    ) -> None:
        self.terrain_engine = terrain_engine
        self.link_budget_engine = link_budget_engine
        self.rf_config = rf_config
        self.env_config = env_config
        self.flight_config = flight_config
        self.trajectory_engine = trajectory_engine
        self.lookahead_horizon_s = lookahead_horizon_s
        self.step_dt_s = step_dt_s
        self.flush_threshold_s = flush_threshold_s
        self.burst_duration_s = burst_duration_s

    def evaluate_predictive_state(
        self,
        node_pos: Tuple[float, float, float],
        current_time_s: float,
    ) -> PredictiveState:
        """
        Classifies node link into:
            NORMAL_LOS -> PRE_OCCLUSION_FLUSH (T_occ <= 3.0s) -> HARD_SHADOW_CUTOFF (is_outage=True)
            -> RE_EMERGENCE_BURST (time_since_emergence <= 2.0s) -> NORMAL_LOS.
        """
        acn_pos = self.trajectory_engine.get_acn_position(current_time_s)
        acn_vel = self.trajectory_engine.get_acn_velocity(current_time_s)

        min_clear_m, fresnel_r_m, diff_loss_db, is_los_now = (
            self.terrain_engine.evaluate_terrain_obstruction(
                node_pos, acn_pos, self.rf_config, self.env_config
            )
        )

        # 1. Apparent Doppler shift calculation
        dx = node_pos[0] - acn_pos[0]
        dy = node_pos[1] - acn_pos[1]
        dz = node_pos[2] - acn_pos[2]
        dist = max(math.sqrt(dx * dx + dy * dy + dz * dz), 1.0)
        v_radial = (acn_vel[0] * dx + acn_vel[1] * dy + acn_vel[2] * dz) / dist
        fc = self.rf_config.carrier_frequency_hz
        doppler_hz = (v_radial / SPEED_OF_LIGHT) * fc

        # 2. Clearance rate of change (dC/dt)
        next_acn_pos = self.trajectory_engine.get_acn_position(current_time_s + self.step_dt_s)
        next_clear_m, _, _, _ = self.terrain_engine.evaluate_terrain_obstruction(
            node_pos, next_acn_pos, self.rf_config, self.env_config
        )
        clearance_rate_mps = (next_clear_m - min_clear_m) / self.step_dt_s

        # --------------------------------------------------------------------------------
        # Regime A: Currently in Mountain Shadow (Severed Line-of-Sight)
        # --------------------------------------------------------------------------------
        if not is_los_now:
            time_to_emergence = float("inf")
            steps = int(self.lookahead_horizon_s / self.step_dt_s)
            for step in range(1, steps + 1):
                future_t = current_time_s + step * self.step_dt_s
                future_acn = self.trajectory_engine.get_acn_position(future_t)
                _, _, _, future_is_los = self.terrain_engine.evaluate_terrain_obstruction(
                    node_pos, future_acn, self.rf_config, self.env_config
                )
                if future_is_los:
                    time_to_emergence = step * self.step_dt_s
                    break

            outage_dur = time_to_emergence if math.isfinite(time_to_emergence) else 0.0

            return PredictiveState(
                current_state=NodeTerrainState.HARD_SHADOW_CUTOFF,
                time_to_occlusion_s=0.0,
                time_to_emergence_s=time_to_emergence,
                fresnel_clearance_m=min_clear_m,
                fresnel_rate_of_change_mps=clearance_rate_mps,
                predicted_outage_duration_s=outage_dur,
                apparent_doppler_hz=doppler_hz,
                shadow_duration_s=outage_dur,
            )

        # --------------------------------------------------------------------------------
        # Regime B: Line-of-Sight Currently Clear
        # --------------------------------------------------------------------------------
        # 1. Check if node recently emerged from shadow (Re-emergence Burst window)
        just_emerged = False
        past_steps = int(self.burst_duration_s / self.step_dt_s)
        for step in range(1, past_steps + 1):
            past_t = current_time_s - step * self.step_dt_s
            if past_t < 0.0:
                break
            past_acn = self.trajectory_engine.get_acn_position(past_t)
            _, _, _, past_is_los = self.terrain_engine.evaluate_terrain_obstruction(
                node_pos, past_acn, self.rf_config, self.env_config
            )
            if not past_is_los:
                just_emerged = True
                break

        if just_emerged:
            return PredictiveState(
                current_state=NodeTerrainState.RE_EMERGENCE_BURST,
                time_to_occlusion_s=float("inf"),
                time_to_emergence_s=0.0,
                fresnel_clearance_m=min_clear_m,
                fresnel_rate_of_change_mps=clearance_rate_mps,
                predicted_outage_duration_s=0.0,
                apparent_doppler_hz=doppler_hz,
                shadow_duration_s=0.0,
            )

        # 2. Check upcoming occlusion within lookahead horizon
        time_to_occlusion = float("inf")
        predicted_outage_duration = 0.0
        steps = int(self.lookahead_horizon_s / self.step_dt_s)
        occlusion_step: Optional[int] = None

        for step in range(1, steps + 1):
            future_t = current_time_s + step * self.step_dt_s
            future_acn = self.trajectory_engine.get_acn_position(future_t)
            _, _, _, future_is_los = self.terrain_engine.evaluate_terrain_obstruction(
                node_pos, future_acn, self.rf_config, self.env_config
            )
            if not future_is_los:
                time_to_occlusion = step * self.step_dt_s
                occlusion_step = step
                break

        # If upcoming occlusion detected, forward-trace duration of that future shadow
        if occlusion_step is not None:
            emergence_found = False
            for step in range(occlusion_step + 1, steps + 1):
                future_t = current_time_s + step * self.step_dt_s
                future_acn = self.trajectory_engine.get_acn_position(future_t)
                _, _, _, future_is_los = self.terrain_engine.evaluate_terrain_obstruction(
                    node_pos, future_acn, self.rf_config, self.env_config
                )
                if future_is_los:
                    predicted_outage_duration = (step - occlusion_step) * self.step_dt_s
                    emergence_found = True
                    break
            if not emergence_found:
                predicted_outage_duration = (steps - occlusion_step) * self.step_dt_s

        if time_to_occlusion <= self.flush_threshold_s:
            curr_state = NodeTerrainState.PRE_OCCLUSION_FLUSH
        else:
            curr_state = NodeTerrainState.NORMAL_LOS

        return PredictiveState(
            current_state=curr_state,
            time_to_occlusion_s=time_to_occlusion,
            time_to_emergence_s=0.0,
            fresnel_clearance_m=min_clear_m,
            fresnel_rate_of_change_mps=clearance_rate_mps,
            predicted_outage_duration_s=predicted_outage_duration,
            apparent_doppler_hz=doppler_hz,
            shadow_duration_s=predicted_outage_duration,
        )