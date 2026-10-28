"""
Tactical X-Band Air-to-Ground Network Digital Twin - Module 3: Dual-Scheduler Engine.

Compares Legacy Static TDMA against the Terrain-Aware Dynamic Scheduler (Tac-TAD)
featuring exact-fit dynamic slot sizing, proportional fairness, and predictive
cross-layer queue evacuation prior to mountain occlusion.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import math
from typing import Dict, List, Optional
import numpy as np

try:
    from core.queues import GroundNodeTrafficSubsystem, QOS_PROFILES
    from core.trajectory import NodeTerrainState, PredictiveState
    from core.link_budget import LinkStatus
except ImportError:
    from .queues import GroundNodeTrafficSubsystem, QOS_PROFILES
    from .trajectory import NodeTerrainState, PredictiveState
    from .link_budget import LinkStatus


# Superframe Structure Parameters
T_FRAME_S: float = 0.020  # 20 ms superframe period
TAU_GUARD_S: float = 12e-6  # 12 microseconds guard band with closed-loop TA
TAU_MIN_S: float = 200e-6  # 200 microseconds minimum allocatable slot
T_CTRL_S: float = 0.001  # 1 ms control / BSR channel
T_DL_MIN_S: float = 0.003  # 3 ms minimum DL broadcast
T_DL_MAX_S: float = 0.007  # 7 ms maximum DL breathing duration
T_UL_NOMINAL_S: float = 0.016  # 16 ms nominal UL data allocation


@dataclass
class SlotAllocation:
    """Uplink TDMA slot assignment for an individual ground terminal."""
    node_id: int
    slot_start_s: float
    duration_s: float
    timing_advance_s: float
    modcod_name: str
    spectral_efficiency: float
    allocated_capacity_bits: int
    is_pre_occlusion_flush: bool


@dataclass
class FrameScheduleReport:
    """Comprehensive performance telemetry for a single scheduled superframe."""
    frame_index: int
    timestamp_s: float
    scheduler_name: str
    allocations: List[SlotAllocation]
    total_ul_utilization_pct: float
    total_bits_transmitted: int
    total_bits_wasted_on_outage: int
    packets_dropped_delay: int
    packets_dropped_overflow: int


class BaseScheduler(ABC):
    """Abstract base class for tactical air-to-ground MAC frame schedulers."""

    @abstractmethod
    def schedule_frame(
        self,
        frame_index: int,
        current_time: float,
        nodes: List[GroundNodeTrafficSubsystem],
        link_statuses: Dict[int, LinkStatus],
        predictive_states: Dict[int, PredictiveState],
        dl_backlog_bytes: int = 0,
    ) -> FrameScheduleReport:
        """Schedule uplink transmissions for all nodes in the superframe."""
        pass


class LegacyStaticScheduler(BaseScheduler):
    """
    Legacy Static Equal-Slot TDMA Scheduler.
    
    Divides uplink data time equally among all registered terminals:
      tau_slot = (T_UL_nominal - N * tau_guard) / N
    Assigns fixed slots regardless of channel SNR, queue backlogs, or terrain occlusion.
    If a node is occluded in HARD_SHADOW_CUTOFF (rate = 0), transmitted bits are wasted.
    """

    def __init__(
        self,
        t_frame_s: float = T_FRAME_S,
        t_ctrl_s: float = T_CTRL_S,
        t_dl_nominal_s: float = T_DL_MIN_S,
        tau_guard_s: float = TAU_GUARD_S,
        tau_min_s: float = TAU_MIN_S,
    ) -> None:
        self.t_frame_s = t_frame_s
        self.t_ctrl_s = t_ctrl_s
        self.t_dl_nominal_s = t_dl_nominal_s
        self.tau_guard_s = tau_guard_s
        self.tau_min_s = tau_min_s
        self.scheduler_name = "Legacy_Static_TDMA"

    def schedule_frame(
        self,
        frame_index: int,
        current_time: float,
        nodes: List[GroundNodeTrafficSubsystem],
        link_statuses: Dict[int, LinkStatus],
        predictive_states: Dict[int, PredictiveState],
        dl_backlog_bytes: int = 0,
    ) -> FrameScheduleReport:
        n_nodes = len(nodes)
        t_ul_available = self.t_frame_s - self.t_ctrl_s - self.t_dl_nominal_s
        tau_slot = (t_ul_available - n_nodes * self.tau_guard_s) / n_nodes

        allocations: List[SlotAllocation] = []
        total_bits_tx: int = 0
        total_bits_wasted: int = 0
        used_time_s: float = 0.0

        slot_start_s = current_time + self.t_ctrl_s + self.t_dl_nominal_s

        for node in nodes:
            ls = link_statuses[node.node_id]
            ps = predictive_states[node.node_id]

            # Blind TDMA assigns nominal rate based on standard modulation (e.g. 4.95 Mbps)
            rate = ls.bitrate_bps if ls.bitrate_bps > 0 else 4.95e6
            cap_bits = int(tau_slot * rate)
            cap_bytes = cap_bits // 8

            spec_eff = getattr(ls, "spectral_efficiency_bps_hz", getattr(ls, "spectral_efficiency", 0.0))

            alloc = SlotAllocation(
                node_id=node.node_id,
                slot_start_s=slot_start_s,
                duration_s=tau_slot,
                timing_advance_s=0.001,
                modcod_name=ls.modcod,
                spectral_efficiency=spec_eff,
                allocated_capacity_bits=cap_bits,
                is_pre_occlusion_flush=False,
            )
            allocations.append(alloc)
            used_time_s += tau_slot + self.tau_guard_s
            slot_start_s += tau_slot + self.tau_guard_s

            # Terminal dequeues packets into allocated grant
            served_pkts = node.queue.dequeue(cap_bytes, current_time)
            bits_served = sum(p.size_bits for p in served_pkts)

            # In HARD_SHADOW_CUTOFF or outage, transmissions into severed channel fail completely
            if ps.current_state == NodeTerrainState.HARD_SHADOW_CUTOFF or ls.is_outage:
                total_bits_wasted += bits_served
            else:
                total_bits_tx += bits_served

        total_delay_drops = sum(n.queue.dropped_delay_count for n in nodes)
        total_overflow_drops = sum(n.queue.dropped_overflow_count for n in nodes)
        util_pct = (used_time_s / t_ul_available) * 100.0

        return FrameScheduleReport(
            frame_index=frame_index,
            timestamp_s=current_time,
            scheduler_name=self.scheduler_name,
            allocations=allocations,
            total_ul_utilization_pct=util_pct,
            total_bits_transmitted=total_bits_tx,
            total_bits_wasted_on_outage=total_bits_wasted,
            packets_dropped_delay=total_delay_drops,
            packets_dropped_overflow=total_overflow_drops,
        )


class TerrainAwareDynamicScheduler(BaseScheduler):
    """
    Terrain-Aware Dynamic Scheduler (Tac-TAD).
    
    Innovations:
      1. Zero-Allocation Outage Reclamation: Reclaims 100% of airtime from occluded nodes.
      2. Priority-Weighted Urgency Metric (Psi_i) protecting GBR Mission-Critical C2 and Voice.
      3. Exact-Fit Dynamic Slot Sizing: Allocates precisely tau_req = Q_total / R_inst.
      4. Pre-Occlusion Predictive Evacuation: Expands slots to available frame slack
         during PRE_OCCLUSION_FLUSH to flush queues before mountain shadow hits.
    """

    def __init__(
        self,
        t_frame_s: float = T_FRAME_S,
        t_ctrl_s: float = T_CTRL_S,
        t_dl_min_s: float = T_DL_MIN_S,
        t_dl_max_s: float = T_DL_MAX_S,
        tau_guard_s: float = TAU_GUARD_S,
        tau_min_s: float = TAU_MIN_S,
        tau_max_normal_s: float = 0.008,
    ) -> None:
        self.t_frame_s = t_frame_s
        self.t_ctrl_s = t_ctrl_s
        self.t_dl_min_s = t_dl_min_s
        self.t_dl_max_s = t_dl_max_s
        self.tau_guard_s = tau_guard_s
        self.tau_min_s = tau_min_s
        self.tau_max_normal_s = tau_max_normal_s
        self.scheduler_name = "Tac_TAD"

        self.r_avg: Dict[int, float] = {}
        self.alpha_pf: float = 0.05
        # High urgency weights protecting 5QI 69 (40ms PDB) and 5QI 65 (75ms PDB) from starvation
        self.weights: Dict[int, float] = {69: 200.0, 65: 50.0, 67: 2.0, 70: 1.0}

    def schedule_frame(
        self,
        frame_index: int,
        current_time: float,
        nodes: List[GroundNodeTrafficSubsystem],
        link_statuses: Dict[int, LinkStatus],
        predictive_states: Dict[int, PredictiveState],
        dl_backlog_bytes: int = 0,
    ) -> FrameScheduleReport:
        # Dynamic TDD breathing: adjust T_DL based on ACN broadcast queue
        if dl_backlog_bytes > 5000:
            t_dl = min(self.t_dl_max_s, self.t_dl_min_s + 0.002)
        else:
            t_dl = self.t_dl_min_s

        t_ul_available = self.t_frame_s - self.t_ctrl_s - t_dl
        allocations: List[SlotAllocation] = []
        total_bits_tx: int = 0
        used_time_s: float = 0.0

        # Step 1: Filter out nodes in HARD_SHADOW_CUTOFF (diffraction outage)
        candidate_nodes: List[GroundNodeTrafficSubsystem] = []
        for node in nodes:
            ps = predictive_states[node.node_id]
            ls = link_statuses[node.node_id]

            # 100% time reclamation on severed links
            if ps.current_state == NodeTerrainState.HARD_SHADOW_CUTOFF or ls.bitrate_bps <= 0:
                continue

            # Only candidate if backlog exists or entering pre-occlusion flush
            if node.queue.get_total_backlog_bits() == 0 and ps.current_state != NodeTerrainState.PRE_OCCLUSION_FLUSH:
                continue

            candidate_nodes.append(node)

        # Step 2: Compute Dynamic Priority Metric Psi_i
        candidate_metrics: List[tuple[float, GroundNodeTrafficSubsystem]] = []
        for node in candidate_nodes:
            nid = node.node_id
            ps = predictive_states[nid]
            ls = link_statuses[nid]
            q = node.queue
            q_total_bits = q.get_total_backlog_bits()

            # Base Urgency: sum over classes [ weight_c * exp(HOL_delay / PDB) ]
            urgency = 0.0
            for qid, weight in self.weights.items():
                if q.get_class_backlog_bytes(qid) > 0:
                    hol = q.get_hol_delay_s(qid, current_time)
                    pdb = float(QOS_PROFILES[qid]["pdb_s"])
                    urgency += weight * math.exp(min(8.0, hol / pdb))
            if urgency == 0.0:
                urgency = 0.1

            # Proportional Fairness Term: R_inst / R_avg
            r_inst = ls.bitrate_bps
            r_prev = self.r_avg.get(nid, 100000.0)
            pf_term = r_inst / max(1000.0, r_prev)

            # Lower-bounded backlog utility prevents small C2 packets from being starved
            backlog_utility = max(1.0, math.log2(1.0 + q_total_bits / 8000.0))

            # Predictive Evacuation Boost (Phi_evac)
            if ps.current_state == NodeTerrainState.PRE_OCCLUSION_FLUSH:
                warning_threshold = 3.0
                t_occ = ps.time_to_occlusion_s
                evac_ratio = max(0.0, (warning_threshold - t_occ) / warning_threshold)
                phi_evac = 1.0 + 5.0 * evac_ratio * min(1.0, q_total_bits / 20000.0)
            elif ps.current_state == NodeTerrainState.RE_EMERGENCE_BURST:
                phi_evac = 4.0
            else:
                phi_evac = 1.0

            psi_i = phi_evac * urgency * pf_term * backlog_utility
            candidate_metrics.append((psi_i, node))

        # Sort candidate nodes in descending order of priority metric Psi_i
        candidate_metrics.sort(key=lambda x: x[0], reverse=True)

        # Step 3: Exact-Fit Slot Sizing
        remaining_ul_time_s = t_ul_available
        slot_start_s = current_time + self.t_ctrl_s + t_dl
        scheduled_node_ids = set()

        for psi_i, node in candidate_metrics:
            if remaining_ul_time_s < self.tau_min_s:
                break

            nid = node.node_id
            ps = predictive_states[nid]
            ls = link_statuses[nid]
            r_inst = ls.bitrate_bps
            q_total_bits = node.queue.get_total_backlog_bits()

            if q_total_bits == 0:
                continue

            tau_req = q_total_bits / r_inst

            # In PRE_OCCLUSION_FLUSH: allow slot to expand to entire available frame slack!
            if ps.current_state == NodeTerrainState.PRE_OCCLUSION_FLUSH:
                tau_slot = min(remaining_ul_time_s - self.tau_guard_s, max(tau_req, self.tau_min_s))
                is_flush = True
            else:
                tau_slot = min(tau_req, self.tau_max_normal_s, remaining_ul_time_s - self.tau_guard_s)
                is_flush = False

            if tau_slot < self.tau_min_s:
                continue

            cap_bits = int(tau_slot * r_inst)
            cap_bytes = cap_bits // 8

            spec_eff = getattr(ls, "spectral_efficiency_bps_hz", getattr(ls, "spectral_efficiency", 0.0))

            alloc = SlotAllocation(
                node_id=nid,
                slot_start_s=slot_start_s,
                duration_s=tau_slot,
                timing_advance_s=0.001,
                modcod_name=ls.modcod,
                spectral_efficiency=spec_eff,
                allocated_capacity_bits=cap_bits,
                is_pre_occlusion_flush=is_flush,
            )
            allocations.append(alloc)
            scheduled_node_ids.add(nid)

            served_pkts = node.queue.dequeue(cap_bytes, current_time)
            bits_served = sum(p.size_bits for p in served_pkts)
            total_bits_tx += bits_served

            # Update exponential moving average throughput
            r_achieved = bits_served / self.t_frame_s
            r_prev = self.r_avg.get(nid, 100000.0)
            self.r_avg[nid] = (1.0 - self.alpha_pf) * r_prev + self.alpha_pf * r_achieved

            time_consumed = tau_slot + self.tau_guard_s
            used_time_s += time_consumed
            slot_start_s += time_consumed
            remaining_ul_time_s -= time_consumed

        # Decay PF throughput for unscheduled candidate nodes
        for node in nodes:
            if node.node_id not in scheduled_node_ids:
                r_prev = self.r_avg.get(node.node_id, 100000.0)
                self.r_avg[node.node_id] = (1.0 - self.alpha_pf) * r_prev

        total_delay_drops = sum(n.queue.dropped_delay_count for n in nodes)
        total_overflow_drops = sum(n.queue.dropped_overflow_count for n in nodes)
        util_pct = (used_time_s / t_ul_available) * 100.0

        return FrameScheduleReport(
            frame_index=frame_index,
            timestamp_s=current_time,
            scheduler_name=self.scheduler_name,
            allocations=allocations,
            total_ul_utilization_pct=util_pct,
            total_bits_transmitted=total_bits_tx,
            total_bits_wasted_on_outage=0,  # Zero bits wasted on severed links
            packets_dropped_delay=total_delay_drops,
            packets_dropped_overflow=total_overflow_drops,
        )