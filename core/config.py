"""
Tactical X-Band Air-to-Ground Network Digital Twin - Core Configuration Module.

Provides strongly typed, runtime-configurable dataclasses for RF payloads,
propagation environments (ITU-R P.834 / P.676 / P.838), and Aerial Communication
Node (ACN) orbital flight kinematics over high-relief topography.
"""

from dataclasses import dataclass, field
import math
from typing import Optional, Tuple


SPEED_OF_LIGHT: float = 299792458.0  # Exact SI constant in m/s
BOLTZMANN_CONSTANT: float = 1.380649e-23  # Exact SI constant in J/K


@dataclass(frozen=True)
class RFConfig:
    """
    Tactical RF parameters for X-band air-to-ground waveform and transceiver hardware.
    
    Defaults reflect high-altitude tactical relays communicating with dismounted
    infantry manpacks and armored command posts.
    """
    carrier_frequency_hz: float = 8.0e9  # 8.0 GHz Tactical X-band
    channel_bandwidth_hz: float = 1.0e6  # 1.0 MHz shared channel bandwidth
    
    # Aerial Communication Node (ACN) Transceiver
    acn_tx_power_dbm: float = 40.0  # 10 W RF power amplifier
    acn_antenna_gain_dbi: float = 15.0  # Airborne steerable planar patch / conformal array
    acn_noise_figure_db: float = 5.0  # Low-noise receiver front-end NF
    
    # Dismounted Soldier Node (4W Manpack)
    soldier_tx_power_dbm: float = 36.0  # 4.0 W PA
    soldier_antenna_gain_dbi: float = 3.0  # Hemispheric omni whip antenna
    
    # Main Command Post (MCP, 20W Dish)
    mcp_tx_power_dbm: float = 43.0  # 20.0 W high-power vehicular transmitter
    mcp_antenna_gain_dbi: float = 20.0  # High-gain directional parabolic tracking dish
    
    # Hardware Losses & Margin
    implementation_margin_db: float = 2.5  # Filter ripple, ADC quantization, phase jitter
    cable_loss_db: float = 1.5  # RF feedline insertion loss and connector degradation
    speed_of_light: float = SPEED_OF_LIGHT

    @property
    def wavelength_m(self) -> float:
        """Carrier wavelength in meters."""
        return self.speed_of_light / self.carrier_frequency_hz

    def get_transmitter_params(self, node_type: str) -> Tuple[float, float]:
        """
        Retrieve transmitter RF power (dBm) and antenna gain (dBi) for a node type.
        
        Args:
            node_type: Identifier string ('soldier', 'mcp', 'acn')
            
        Returns:
            Tuple of (tx_power_dbm, antenna_gain_dbi)
        """
        normalized = node_type.strip().lower()
        if normalized in ("soldier", "manpack", "infantry"):
            return self.soldier_tx_power_dbm, self.soldier_antenna_gain_dbi
        if normalized in ("mcp", "command_post", "main_command_post", "vehicular"):
            return self.mcp_tx_power_dbm, self.mcp_antenna_gain_dbi
        if normalized in ("acn", "airborne", "relay"):
            return self.acn_tx_power_dbm, self.acn_antenna_gain_dbi
        raise ValueError(
            f"Unrecognized node_type: '{node_type}'. Expected 'soldier', 'mcp', or 'acn'."
        )


@dataclass(frozen=True)
class EnvironmentConfig:
    """
    Environmental, tropospheric, and planetary geometry parameters.
    
    Adheres to ITU-R recommendations P.834, P.676, and P.838.
    """
    effective_earth_radius_factor: float = 4.0 / 3.0  # ITU-R P.834 standard k-factor
    true_earth_radius_m: float = 6371000.0  # WGS-84 volumetric mean Earth radius
    rain_rate_mm_h: float = 0.0  # Precipitation rate: 0=clear, 15=moderate, 50=monsoon
    rain_cell_length_km: float = 10.0  # Effective horizontal convective cell extent
    atmospheric_temperature_k: float = 290.0  # Standard reference noise temperature

    @property
    def effective_earth_radius_m(self) -> float:
        """Effective Earth radius (R_eff = k * R_true) in meters (~8494.67 km)."""
        return self.true_earth_radius_m * self.effective_earth_radius_factor


@dataclass
class ACNFlightConfig:
    """
    Kinematics, fully parametric rotated elliptical loiter orbit configuration,
    and RF coverage footprint for the Aerial Communication Node (ACN).
    """
    altitude_msl_m: float = 5000.0
    loiter_radius_a_m: float = 20000.0   # Semi-major axis (20 km)
    loiter_radius_b_m: float = 10000.0   # Semi-minor axis (10 km)
    loiter_rotation_deg: float = 35.0    # Ellipse tilt / inclination angle
    loiter_speed_mps: float = 60.0       # 216 km/h loiter true airspeed
    center_x_m: float = 0.0              # Orbit origin Easting (m)
    center_y_m: float = 0.0              # Orbit origin Northing (m)
    coverage_radius_km: float = 35.0     # Dynamic ACN RF coverage footprint radius (km)

    def __init__(
        self,
        altitude_msl_m: float = 5000.0,
        loiter_radius_a_m: float = 20000.0,
        loiter_radius_b_m: float = 10000.0,
        loiter_rotation_deg: float = 35.0,
        loiter_speed_mps: float = 60.0,
        center_x_m: float = 0.0,
        center_y_m: float = 0.0,
        loiter_radius_m: Optional[float] = None,
        coverage_radius_km: float = 35.0,
        coverage_radius_m: Optional[float] = None,
        **kwargs
    ) -> None:
        self.altitude_msl_m = float(altitude_msl_m)
        if loiter_radius_m is not None:
            # Legacy circular initialization fallback
            self.loiter_radius_a_m = float(loiter_radius_m)
            self.loiter_radius_b_m = float(loiter_radius_m)
            self.loiter_rotation_deg = 0.0
        else:
            self.loiter_radius_a_m = float(loiter_radius_a_m)
            self.loiter_radius_b_m = float(loiter_radius_b_m)
            self.loiter_rotation_deg = float(loiter_rotation_deg)
        self.loiter_speed_mps = float(loiter_speed_mps)
        self.center_x_m = float(center_x_m)
        self.center_y_m = float(center_y_m)
        if coverage_radius_m is not None:
            self.coverage_radius_km = float(coverage_radius_m) / 1000.0
        else:
            self.coverage_radius_km = float(coverage_radius_km)

    @property
    def loiter_radius_m(self) -> float:
        """Backwards compatibility alias for older modules expecting loiter_radius_m."""
        return self.loiter_radius_a_m

    @loiter_radius_m.setter
    def loiter_radius_m(self, value: float) -> None:
        self.loiter_radius_a_m = float(value)
        self.loiter_radius_b_m = float(value)
        self.loiter_rotation_deg = 0.0

    @property
    def coverage_radius_m(self) -> float:
        """Dynamic ACN RF coverage footprint radius in meters."""
        return self.coverage_radius_km * 1000.0

    @coverage_radius_m.setter
    def coverage_radius_m(self, value: float) -> None:
        self.coverage_radius_km = float(value) / 1000.0

    def get_position(self, time_s: float) -> Tuple[float, float, float]:
        """
        Compute ACN 3D Cartesian coordinates (x, y, z) at time t along rotated ellipse.
        
        Uses Ramanujan's formula for the elliptical perimeter to compute the orbital period.
        """
        a = self.loiter_radius_a_m
        b = self.loiter_radius_b_m
        if (a + b) <= 0.0:
            return (self.center_x_m, self.center_y_m, self.altitude_msl_m)

        h_param = ((a - b) ** 2) / ((a + b) ** 2)
        denom = 10.0 + math.sqrt(max(0.0, 4.0 - 3.0 * h_param))
        perimeter = math.pi * (a + b) * (1.0 + (3.0 * h_param) / denom)
        orbit_period_s = perimeter / max(0.1, self.loiter_speed_mps)
        omega = (2.0 * math.pi) / orbit_period_s

        phi = math.radians(self.loiter_rotation_deg)
        x_raw = a * math.cos(omega * time_s)
        y_raw = b * math.sin(omega * time_s)

        x = self.center_x_m + x_raw * math.cos(phi) - y_raw * math.sin(phi)
        y = self.center_y_m + x_raw * math.sin(phi) + y_raw * math.cos(phi)
        z = self.altitude_msl_m
        return (x, y, z)