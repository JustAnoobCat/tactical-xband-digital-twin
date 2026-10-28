"""
Tactical X-Band Air-to-Ground Network Digital Twin - Link Budget Engine.

Computes atmospheric attenuation (ITU-R P.676), hydrometeor rain loss (ITU-R P.838),
thermal noise floors, and performs adaptive modulation and coding (MODCOD) selection
compliant with DVB-S2X / 3GPP Rel 17 NTN standards.
"""

from dataclasses import dataclass
import math
from typing import List, Tuple

try:
    from core.config import RFConfig, EnvironmentConfig, BOLTZMANN_CONSTANT, SPEED_OF_LIGHT
except ImportError:
    from .config import RFConfig, EnvironmentConfig, BOLTZMANN_CONSTANT, SPEED_OF_LIGHT


@dataclass(frozen=True)
class ModCodEntry:
    """Modulation and Coding scheme threshold entry."""
    name: str
    min_snr_db: float
    spectral_efficiency_bps_hz: float


# DVB-S2X / 3GPP Rel 17 Non-Terrestrial Network (NTN) MODCOD Table
# Ordered descending by SNR requirement for optimal rate matching
MODCOD_TABLE: List[ModCodEntry] = [
    ModCodEntry("64-APSK 5/6", 22.0, 4.95),
    ModCodEntry("32-APSK 3/4", 17.5, 3.70),
    ModCodEntry("16-APSK 4/5", 14.0, 3.16),
    ModCodEntry("16-APSK 2/3", 11.5, 2.64),
    ModCodEntry("8-PSK 3/5", 8.0, 1.78),
    ModCodEntry("QPSK 3/4", 5.5, 1.49),
    ModCodEntry("QPSK 1/2", 2.5, 0.99),
    ModCodEntry("pi/2-BPSK 1/3", -1.5, 0.33),
]


@dataclass
class LinkStatus:
    """
    Comprehensive physical layer telemetry and telemetry report for an RF link.
    """
    node_type: str
    slant_range_m: float
    fspl_db: float
    diffraction_loss_db: float
    gas_loss_db: float
    rain_loss_db: float
    cable_loss_db: float
    implementation_margin_db: float
    total_path_loss_db: float
    p_tx_dbm: float
    tx_gain_dbi: float
    rx_gain_dbi: float
    p_rx_dbm: float
    p_noise_dbm: float
    snr_db: float
    modcod: str
    spectral_efficiency_bps_hz: float
    bitrate_bps: float
    is_outage: bool

    @property
    def bitrate_mbps(self) -> float:
        """Achievable throughput in Megabits per second."""
        return self.bitrate_bps / 1.0e6

    @property
    def modulation(self) -> str:
        """MODCOD scheme designation alias."""
        return self.modcod

    @property
    def snr(self) -> float:
        """Signal-to-Noise Ratio alias in dB."""
        return self.snr_db


class LinkBudgetEngine:
    """
    Deterministic Link Budget & Adaptive Modulation Engine.
    """

    @staticmethod
    def compute_gaseous_attenuation(d_3d_m: float) -> float:
        """
        ITU-R P.676 Gaseous Absorption for 8.0 GHz Tactical X-band.
        
        Specific attenuation gamma_g = 0.012 dB/km.
        """
        return 0.012 * (d_3d_m / 1000.0)

    @staticmethod
    def compute_rain_attenuation(
        d_3d_m: float,
        env_config: EnvironmentConfig
    ) -> float:
        """
        ITU-R P.838 Hydrometeor Rain Attenuation for 8.0 GHz (Horizontal polarization).
        
        k_H = 0.00411, alpha_H = 1.390
        gamma_R = k_H * (rain_rate ^ alpha_H) dB/km
        Effective rain cell length capped by env_config.rain_cell_length_km.
        """
        if env_config.rain_rate_mm_h <= 0.0:
            return 0.0
        
        k_h = 0.00411
        alpha_h = 1.390
        gamma_r = k_h * (env_config.rain_rate_mm_h ** alpha_h)
        rain_path_km = min(d_3d_m / 1000.0, env_config.rain_cell_length_km)
        return gamma_r * rain_path_km

    @staticmethod
    def compute_thermal_noise_floor_dbm(
        bandwidth_hz: float,
        noise_figure_db: float,
        temperature_k: float = 290.0,
    ) -> Tuple[float, float]:
        """
        Compute thermal receiver noise floor power.
        
        P_noise_w = k_B * T * B * 10^(NF / 10)
        P_noise_dbm = 10 * log10(P_noise_w * 1000)
        
        Returns:
            Tuple of (p_noise_w, p_noise_dbm)
        """
        noise_factor = 10.0 ** (noise_figure_db / 10.0)
        p_noise_w = BOLTZMANN_CONSTANT * temperature_k * bandwidth_hz * noise_factor
        p_noise_dbm = 10.0 * math.log10(p_noise_w * 1000.0)
        return (p_noise_w, p_noise_dbm)

    @classmethod
    def select_modcod(cls, snr_db: float) -> Tuple[str, float]:
        """
        Select highest order operational DVB-S2X / 3GPP Rel 17 MODCOD.
        
        Args:
            snr_db: Received SNR in dB.
            
        Returns:
            Tuple of (modcod_name, spectral_efficiency_bps_hz)
        """
        for entry in MODCOD_TABLE:
            if snr_db >= entry.min_snr_db:
                return entry.name, entry.spectral_efficiency_bps_hz
        return "LINK_OUTAGE", 0.0

    def evaluate_link(
        self,
        node_type: str,
        slant_range_m: float,
        diffraction_loss_db: float,
        rf_config: RFConfig,
        env_config: EnvironmentConfig,
    ) -> LinkStatus:
        """
        Predict full RF link performance, received power, and achievable throughput.
        
        Computes FSPL, gaseous attenuation, precipitation loss, thermal noise,
        net SNR, and assigns optimal MODCOD.
        
        Args:
            node_type: 'soldier' or 'mcp'
            slant_range_m: 3D Euclidean distance in meters.
            diffraction_loss_db: Terrain obstruction loss in dB.
            rf_config: Transmitter and receiver configurations.
            env_config: Tropospheric environment parameters.
            
        Returns:
            Structured LinkStatus telemetry record.
        """
        if slant_range_m <= 0.0:
            raise ValueError(f"Slant range must be positive, got {slant_range_m} m.")

        # Free Space Path Loss (FSPL): 20*log10(d) + 20*log10(fc) + 20*log10(4*pi/c)
        fc = rf_config.carrier_frequency_hz
        c = rf_config.speed_of_light
        fspl_db = (
            20.0 * math.log10(slant_range_m)
            + 20.0 * math.log10(fc)
            + 20.0 * math.log10(4.0 * math.pi / c)
        )

        # Atmospheric attenuation
        gas_loss_db = self.compute_gaseous_attenuation(slant_range_m)
        rain_loss_db = self.compute_rain_attenuation(slant_range_m, env_config)

        # Total channel loss summation
        cable_loss_db = rf_config.cable_loss_db
        impl_margin_db = rf_config.implementation_margin_db
        total_path_loss_db = (
            fspl_db
            + diffraction_loss_db
            + gas_loss_db
            + rain_loss_db
            + cable_loss_db
            + impl_margin_db
        )

        # Transmitter and receiver front-end setup
        p_tx_dbm, tx_gain_dbi = rf_config.get_transmitter_params(node_type)
        rx_gain_dbi = rf_config.acn_antenna_gain_dbi

        # Received power at ACN LNA input
        p_rx_dbm = p_tx_dbm + tx_gain_dbi + rx_gain_dbi - total_path_loss_db

        # Thermal noise floor
        _, p_noise_dbm = self.compute_thermal_noise_floor_dbm(
            bandwidth_hz=rf_config.channel_bandwidth_hz,
            noise_figure_db=rf_config.acn_noise_figure_db,
            temperature_k=env_config.atmospheric_temperature_k,
        )

        # Net Signal-to-Noise Ratio (SNR)
        snr_db = p_rx_dbm - p_noise_dbm

        # Dynamic MODCOD selection & bitrate calculation
        modcod_name, spectral_eff = self.select_modcod(snr_db)
        bitrate_bps = spectral_eff * rf_config.channel_bandwidth_hz
        is_outage = modcod_name == "LINK_OUTAGE"

        return LinkStatus(
            node_type=node_type,
            slant_range_m=slant_range_m,
            fspl_db=fspl_db,
            diffraction_loss_db=diffraction_loss_db,
            gas_loss_db=gas_loss_db,
            rain_loss_db=rain_loss_db,
            cable_loss_db=cable_loss_db,
            implementation_margin_db=impl_margin_db,
            total_path_loss_db=total_path_loss_db,
            p_tx_dbm=p_tx_dbm,
            tx_gain_dbi=tx_gain_dbi,
            rx_gain_dbi=rx_gain_dbi,
            p_rx_dbm=p_rx_dbm,
            p_noise_dbm=p_noise_dbm,
            snr_db=snr_db,
            modcod=modcod_name,
            spectral_efficiency_bps_hz=spectral_eff,
            bitrate_bps=bitrate_bps,
            is_outage=is_outage,
        )