"""
core/queues.py - Multi-Class QoS Queues & Traffic Subsystems
Tactical X-Band Air-to-Ground Network Digital Twin

Implements Bounded Strict-Priority Multi-Class Queue with CoDel-inspired sojourn delay tracking and deadline pruning,
dual byte/bit accessors, drop counter property aliases, Head-of-Line (HOL) delay telemetry,
ingress packet counters, overflow eviction tracking with 2-tuple return, and bounded-memory
protection with oldest-packet eviction under sustained C2 overload.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
import random
from typing import Any, Dict, List, Optional, Tuple

# ----------------------------------------------------------------------------------------
# Project-defined tactical QoS classes inspired by 3GPP MCX 5QI profiles
# ----------------------------------------------------------------------------------------
QOS_PROFILES: Dict[int, Dict[str, Any]] = {
    69: {
        "name": "Emergency C2 / Mission-Critical Signaling",
        "priority": 1,
        "pdb_s": 60.0,  # 60.0s deadline (persists across mountain shadows)
        "default_bytes": 128,
        "strict_priority": True,
    },
    65: {
        "name": "Mission-Critical PTT Voice",
        "priority": 2,
        "pdb_s": 0.075,  # 75 ms Packet Delay Budget
        "default_bytes": 160,
        "strict_priority": False,
    },
    67: {
        "name": "Mission-Critical Video",
        "priority": 3,
        "pdb_s": 0.150,  # 150 ms Packet Delay Budget
        "default_bytes": 1200,
        "strict_priority": False,
    },
    70: {
        "name": "High-Resolution Tactical Imagery / Photo",
        "priority": 4,
        "pdb_s": 0.500,  # 500 ms Packet Delay Budget
        "default_bytes": 1400,
        "strict_priority": False,
    },
}


@dataclass
class Packet:
    packet_id: int
    node_id: int
    qos_5qi: int
    size_bytes: int
    arrival_time_s: float
    deadline_s: float
    sojourn_time_s: float = 0.0

    @property
    def size_bits(self) -> int:
        """Returns packet payload size in bits."""
        return self.size_bytes * 8


class EnqueueResult(tuple):
    """2-tuple (admitted_bool, evicted_packets_list) maintaining boolean truthiness."""

    def __bool__(self) -> bool:
        return bool(self[0])


# ----------------------------------------------------------------------------------------
# Bounded Strict-Priority Multi-Class Queue with Eviction Tracking
# ----------------------------------------------------------------------------------------
class FQCoDelQueue:
    """
    Bounded Strict-Priority Multi-Class Queue with CoDel-inspired sojourn delay tracking and deadline pruning.

    Manages per-5QI subqueues with strict priority scheduling, bounded memory guarantees,
    tail-drop prioritization, dual byte/bit telemetry accessors, Head-of-Line (HOL) delay metrics,
    total enqueue counters, drop counter property aliases, and bounded-memory protection with
    oldest-packet eviction under sustained C2 overload.
    """

    def __init__(self, max_buffer_packets: int = 400, max_c2_packets: int = 120) -> None:
        self.max_buffer_packets = max_buffer_packets
        self.max_c2_packets = max_c2_packets
        self.total_enqueued: int = 0
        self.last_evicted_packets: List[Packet] = []
        self.subqueues: Dict[int, deque[Packet]] = {
            69: deque(),  # Emergency C2 (Persistent, bounded at 120 pkts)
            65: deque(),  # MC-PTT Voice
            67: deque(),  # MC-Video
            70: deque(),  # Tactical Photo
        }
        self.total_dropped_overflow: int = 0
        self.total_dropped_deadline: int = 0

    # ------------------------------------------------------------------------------------
    # Drop Counter Property Aliases for Cross-Module Compatibility
    # ------------------------------------------------------------------------------------
    @property
    def dropped_delay_count(self) -> int:
        """Alias for total_dropped_deadline expected by core/scheduler.py."""
        return getattr(self, "total_dropped_deadline", 0)

    @dropped_delay_count.setter
    def dropped_delay_count(self, val: int) -> None:
        self.total_dropped_deadline = val

    @property
    def dropped_overflow_count(self) -> int:
        """Alias for total_dropped_overflow expected by core/scheduler.py."""
        return getattr(self, "total_dropped_overflow", 0)

    @dropped_overflow_count.setter
    def dropped_overflow_count(self, val: int) -> None:
        self.total_dropped_overflow = val

    # ------------------------------------------------------------------------------------
    # Backlog Telemetry Accessors (Bytes & Bits)
    # ------------------------------------------------------------------------------------
    def get_total_packets(self) -> int:
        """Returns total aggregate packet count across all subqueues."""
        return sum(len(q) for q in self.subqueues.values())

    @property
    def total_packets(self) -> int:
        return self.get_total_packets()

    def get_total_backlog_bytes(self) -> int:
        """Returns total aggregate backlog across all subqueues in bytes."""
        return sum(sum(p.size_bytes for p in q) for q in self.subqueues.values())

    @property
    def total_backlog_bytes(self) -> int:
        return self.get_total_backlog_bytes()

    def get_total_backlog_bits(self) -> int:
        """Returns total aggregate backlog across all subqueues in bits."""
        return self.get_total_backlog_bytes() * 8

    @property
    def total_backlog_bits(self) -> int:
        return self.get_total_backlog_bits()

    def get_class_backlog_bytes(self, qos_5qi: int) -> int:
        """Returns backlog for a specific 5QI class in bytes."""
        subq = self.subqueues.get(qos_5qi)
        if not subq:
            return 0
        return sum(p.size_bytes for p in subq)

    def get_class_backlog_bits(self, qos_5qi: int) -> int:
        """Returns backlog for a specific 5QI class in bits."""
        return self.get_class_backlog_bytes(qos_5qi) * 8

    def get_class_packet_count(self, qos_5qi: int) -> int:
        """Returns the number of queued packets for the given 5QI class."""
        subq = self.subqueues.get(qos_5qi)
        return len(subq) if subq else 0

    def get_class_packets(self, qos_5qi: int) -> int:
        """Alias for get_class_packet_count for RL environment compatibility."""
        return self.get_class_packet_count(qos_5qi)

    def get_packet_counts(self) -> Dict[int, int]:
        """Returns dictionary mapping each 5QI class to its queued packet count."""
        return {qos: len(subq) for qos, subq in self.subqueues.items()}

    # ------------------------------------------------------------------------------------
    # Head-of-Line (HOL) Delay Telemetry
    # ------------------------------------------------------------------------------------
    def get_hol_delay_s(self, qos_5qi: int, current_time_s: float) -> float:
        """
        Returns the Head-of-Line (HOL) sojourn delay in seconds for the given 5QI class.
        If the subqueue is empty, returns 0.0s.
        """
        subq = self.subqueues.get(qos_5qi)
        if subq:
            return max(0.0, current_time_s - subq[0].arrival_time_s)
        return 0.0

    def get_max_hol_delay_s(self, current_time_s: float) -> float:
        """Returns the peak Head-of-Line (HOL) delay across all 5QI classes."""
        delays = [self.get_hol_delay_s(qos, current_time_s) for qos in self.subqueues]
        return max(delays) if delays else 0.0

    # ------------------------------------------------------------------------------------
    # Queue Mutators & Eviction Tracking
    # ------------------------------------------------------------------------------------
    def enqueue(self, packet: Packet) -> Tuple[bool, List[Packet]]:
        """
        Enqueues packet into corresponding 5QI subqueue with bounded memory policy:
        - Increments self.total_enqueued counter upon packet reception.
        - If buffer >= 400, evicts from lowest priority class (70, then 67, then 65).
        - If buffer is full of Class 69, enforces a hard ceiling of 120 packets
          (drops oldest C2 packet to maintain bounded memory).
        - Class 69 is never dropped to accommodate lower-priority traffic.
        Returns a 2-tuple: (success_bool, evicted_packets_list).
        """
        self.total_enqueued += 1
        qos = packet.qos_5qi
        evicted_packets: List[Packet] = []

        if qos == 69:
            # Enforce hard bounded memory ceiling on Class 69
            if len(self.subqueues[69]) >= self.max_c2_packets:
                evicted = self.subqueues[69].popleft()
                evicted_packets.append(evicted)
            elif self.get_total_packets() >= self.max_buffer_packets:
                # Evict lowest-priority traffic to make room for C2
                dropped = False
                for drop_qos in [70, 67, 65]:
                    if len(self.subqueues[drop_qos]) > 0:
                        evicted = self.subqueues[drop_qos].popleft()
                        evicted_packets.append(evicted)
                        dropped = True
                        break
                if not dropped:
                    # Buffer completely filled with C2; drop oldest C2
                    evicted = self.subqueues[69].popleft()
                    evicted_packets.append(evicted)

            self.subqueues[69].append(packet)
            self.total_dropped_overflow += len(evicted_packets)
            self.last_evicted_packets = evicted_packets
            return EnqueueResult((True, evicted_packets))

        # Non-C2 traffic (65, 67, 70)
        if self.get_total_packets() >= self.max_buffer_packets:
            dropped = False
            for drop_qos in [70, 67, 65]:
                if len(self.subqueues[drop_qos]) > 0:
                    evicted = self.subqueues[drop_qos].popleft()
                    evicted_packets.append(evicted)
                    dropped = True
                    break

            if not dropped:
                # Buffer has only C2; cannot evict C2 for lower priority
                evicted_packets.append(packet)
                self.total_dropped_overflow += len(evicted_packets)
                self.last_evicted_packets = evicted_packets
                return EnqueueResult((False, evicted_packets))

        self.subqueues[qos].append(packet)
        self.total_dropped_overflow += len(evicted_packets)
        self.last_evicted_packets = evicted_packets
        return EnqueueResult((True, evicted_packets))

    def prune_expired_packets(self, current_time_s: float) -> int:
        """
        Prunes packets reaching or exceeding their Packet Delay Budget.
        CRITICAL: Class 69 (Emergency C2) is completely excluded from deadline pruning.
        """
        pruned_count = 0
        for qos in [65, 67, 70]:
            subq = self.subqueues[qos]
            n = len(subq)
            for _ in range(n):
                pkt = subq.popleft()
                if current_time_s >= pkt.deadline_s:
                    pruned_count += 1
                    self.total_dropped_deadline += 1
                else:
                    subq.append(pkt)
        return pruned_count

    def dequeue(self, bytes_capacity: int, current_time_s: float) -> List[Packet]:
        """
        Strict priority dequeue: 69 (Emergency C2) -> 65 (Voice) -> 67 (Video) -> 70 (Photo).
        Head-of-line expired packets for non-C2 traffic reaching or exceeding deadline are pruned during dequeue.
        Updates sojourn_time_s upon departure.
        """
        served: List[Packet] = []
        rem_bytes = bytes_capacity

        for qos in [69, 65, 67, 70]:
            subq = self.subqueues[qos]
            while subq:
                pkt = subq[0]

                # Head-of-line expiration check for non-C2 flows
                if qos != 69 and current_time_s >= pkt.deadline_s:
                    subq.popleft()
                    self.total_dropped_deadline += 1
                    continue

                if pkt.size_bytes <= rem_bytes:
                    subq.popleft()
                    pkt.sojourn_time_s = max(0.0, current_time_s - pkt.arrival_time_s)
                    served.append(pkt)
                    rem_bytes -= pkt.size_bytes
                else:
                    break

            if rem_bytes <= 0:
                break

        return served


# ----------------------------------------------------------------------------------------
# Tactical Ground Node Traffic Subsystem
# ----------------------------------------------------------------------------------------
class GroundNodeTrafficSubsystem:
    """
    Simulates tactical traffic generation (voice calls, video feeds, photo transmissions,
    and periodic C2 telemetry) for a single dismounted soldier or command post.
    """

    _global_packet_id_counter: int = 0

    def __init__(
        self,
        node_id: int,
        node_type: str,
        position: Tuple[float, float, float],
        seed: int = 42,
        has_voice: bool = False,
        voice_start_s: float = 0.0,
        voice_end_s: float = 0.0,
        has_video: bool = False,
        video_mean_pkts_per_frame: float = 1.0,
        has_photo: bool = False,
        photo_trigger_time_s: float = 0.0,
        photo_size_bytes: int = 0,
        **kwargs: Any,
    ) -> None:
        self.node_id = node_id
        self.node_type = node_type
        self.position = position
        self.rng = random.Random(seed)
        self.queue = FQCoDelQueue(max_buffer_packets=400, max_c2_packets=120)

        self.has_voice = has_voice
        self.voice_start_s = voice_start_s
        self.voice_end_s = voice_end_s

        self.has_video = has_video
        self.video_mean_pkts_per_frame = video_mean_pkts_per_frame

        self.has_photo = has_photo
        self.photo_trigger_time_s = photo_trigger_time_s
        self.photo_size_bytes = photo_size_bytes
        self.photo_bytes_remaining = photo_size_bytes if has_photo else 0

        self.c2_interval_s = 0.100  # 10 Hz C2 heartbeat
        self.last_c2_time_s = -1.0

    # ------------------------------------------------------------------------------------
    # Direct Delegation Helpers for RL Observation Space
    # ------------------------------------------------------------------------------------
    def get_hol_delay_s(self, qos_5qi: int, current_time_s: float) -> float:
        """Delegates HOL delay query to the internal queue."""
        return self.queue.get_hol_delay_s(qos_5qi, current_time_s)

    def get_class_packet_count(self, qos_5qi: int) -> int:
        """Delegates packet count query to the internal queue."""
        return self.queue.get_class_packet_count(qos_5qi)

    def get_class_packets(self, qos_5qi: int) -> int:
        """Alias for get_class_packet_count."""
        return self.queue.get_class_packets(qos_5qi)

    def _poisson_draw(self, lam: float) -> int:
        if lam <= 0.0:
            return 0
        limit = math.exp(-lam)
        count = 0
        p = 1.0
        while p > limit:
            count += 1
            p *= self.rng.random()
        return max(0, count - 1)

    def _enqueue(
        self,
        qos: int,
        current_time_s: float,
        size_bytes: Optional[int] = None,
        deadline_s: Optional[float] = None,
    ) -> Packet:
        GroundNodeTrafficSubsystem._global_packet_id_counter += 1
        prof = QOS_PROFILES[qos]
        sz = int(size_bytes if size_bytes is not None else prof["default_bytes"])
        dl = deadline_s if deadline_s is not None else (current_time_s + float(prof["pdb_s"]))

        pkt = Packet(
            packet_id=GroundNodeTrafficSubsystem._global_packet_id_counter,
            node_id=self.node_id,
            qos_5qi=qos,
            size_bytes=sz,
            arrival_time_s=current_time_s,
            deadline_s=dl,
            sojourn_time_s=0.0,
        )
        self.queue.enqueue(pkt)
        return pkt

    def generate_traffic(
        self,
        current_time_s: float,
        frame_duration_s: float = 0.020,
    ) -> List[Packet]:
        """Generates real-time packet arrivals across active traffic profiles."""
        generated: List[Packet] = []

        # 1. 5QI 69: Periodic C2 Health & Status Signaling
        if self.last_c2_time_s < 0.0 or (current_time_s - self.last_c2_time_s) >= self.c2_interval_s:
            generated.append(self._enqueue(69, current_time_s))
            self.last_c2_time_s = current_time_s

        # 2. 5QI 65: Mission-Critical PTT Voice
        if self.has_voice and (self.voice_start_s <= current_time_s <= self.voice_end_s):
            # 20ms audio frame codec packet
            generated.append(self._enqueue(65, current_time_s))

        # 3. 5QI 67: Tactical Mission-Critical Video
        if self.has_video:
            num_video = self._poisson_draw(self.video_mean_pkts_per_frame)
            for _ in range(num_video):
                generated.append(self._enqueue(67, current_time_s))

        # 4. 5QI 70: Tactical High-Resolution Imagery
        if self.has_photo and (current_time_s >= self.photo_trigger_time_s) and (self.photo_bytes_remaining > 0):
            slices = min(2, math.ceil(self.photo_bytes_remaining / 1400))
            for _ in range(slices):
                chunk = min(1400, self.photo_bytes_remaining)
                generated.append(self._enqueue(70, current_time_s, size_bytes=chunk))
                self.photo_bytes_remaining -= chunk

        return generated

    def inject_traffic(self, traffic_type: str, current_time_s: float) -> int:
        """
        Injects tactical traffic burst.

        Returns:
            int: Number of immediate packets enqueued (for SOS) or units of traffic burst activated (for voice/video/photo).
        """
        kind = traffic_type.strip().upper()
        count = 0
        if kind in ("SOS", "C2", "EMERGENCY"):
            for _ in range(8):
                self._enqueue(69, current_time_s)
                count += 1
        elif kind in ("VOICE", "PTT"):
            self.has_voice = True
            self.voice_start_s = current_time_s
            self.voice_end_s = current_time_s + 5.0
            count += 1
        elif kind in ("VIDEO", "BURST"):
            self.has_video = True
            self.video_mean_pkts_per_frame = 3.0
            count += 5
        elif kind in ("PHOTO", "IMAGE"):
            self.has_photo = True
            self.photo_trigger_time_s = current_time_s
            self.photo_bytes_remaining += 2_000_000
            count += 1
        return count


# ----------------------------------------------------------------------------------------
# Explicit Class Alias for Semantic Clarity
# ----------------------------------------------------------------------------------------
BoundedStrictPriorityQueue = FQCoDelQueue