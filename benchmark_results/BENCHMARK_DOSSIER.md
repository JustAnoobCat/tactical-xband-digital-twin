# HISTORICAL BENCHMARK DOSSIER: TACTICAL X-BAND TDMA DIGITAL TWIN (LEGACY PYTHON ENGINE)
Classification: Deterministic Simulation Evaluation (Ladakh Sector Scenario)

---

### BENCHMARK PROVENANCE & HOST SYSTEM METADATA
- **Execution Timestamp (UTC):** `2026-10-22 17:06:33 UTC` to `2026-10-22 17:11:23 UTC`
- **Wall-Clock Execution Time:** `289.76 seconds` (Achieved simulation rate: `17.3 fps`)
- **Simulated Mission Duration:** `100.0 seconds` (`5,000` superframes at 50 Hz cadence)
- **Host Operating System:** `Linux-7.2.9-201.fc44.x86_64-x86_64-with-glibc2.43`
- **Python Runtime:** `3.14.8` (Architecture: `x86_64`, CPU: `Generic Processor`)
- **Deterministic Random Seed:** `42`
- **Channel Prediction Cadence:** `10 Hz (100 ms step)` decoupled from `50 Hz (20 ms)` TDMA slot allocation

---

### 1. EXECUTIVE SUMMARY & SYSTEM OVERVIEW

**Evidence status:** historical legacy-Python run; seed 42; current TypeScript parity not established. Treat all values below as provisional until the current engine reproduces them from raw run outputs.
This archived benchmark dossier records a historical comparative evaluation from the **legacy Python engine** of the **Terrain-Aware Dynamic Scheduler (Tac-TAD)** versus **Legacy Static TDMA** for an Aerial Communication Node (ACN / UAV) operating at **8.0 GHz (Tactical X-Band)** over high-relief Himalayan topography (Ladakh / Kargil Sector).

Under identical multi-class tactical traffic generation across 16 ground terminals, **Tac-TAD achieves a +7.78x Goodput Advantage**, reduces concluded packet drop rates from **52.7% down to 13.9%**, and completely eliminates the **6.3% slot-time allocation waste** caused by Legacy Static TDMA assigning transmission slots to nodes occluded by mountain rock.

---

### 2. METHODOLOGY & SCOPE BOUNDARIES

This research benchmark is a deterministic comparative simulation using project-defined approximations inspired by ITU-R P.526, ITU-R P.834, 3GPP 5QI, and DVB-S2X parameters. The models operate under the following explicit scope specifications:

- **Geometry**: 4/3 spherical Earth mean-radius curvature approximation ($R_{\text{eff}} = 8,494.67\,\text{km}$, ITU-R P.834).
- **Diffraction**: Single-dominant-obstacle knife-edge diffraction with First Fresnel Zone clearance and an empirical 12 dB rounded-crest Fock penalty (ITU-R P.526-15).
- **Queues**: 3GPP MCX multi-class strict-priority queue with CoDel sojourn deadline pruning and bounded C2 capacity.
- **Trajectory**: Constant true airspeed ($60\,\text{m/s}$) along an arc-length parameterized ellipse ($a = 20\,\text{km}, b = 10\,\text{km}, \phi = 35^\circ$).
- **Terrain**: Calibrated deterministic Himalayan geomorphic model.
- **Cadence**: Configured for a 20 ms superframe timestep (50 Hz simulation interval) with 10 Hz trajectory lookahead decimation.

| Subsystem Component | Specification / Value | Standard / Mathematical Model |
| :--- | :--- | :--- |
| **Carrier Frequency** | `8.0 GHz` (X-Band) | Tactical Shared Air-to-Ground Carrier |
| **Shared RF Channel Bandwidth** | `1.0 MHz` | Single Carrier Dynamic TDD/TDMA |
| **ACN Transceiver PA / Antenna** | `40.0 dBm` (10 W) / `15.0 dBi` | Planar Conformal Phased Array |
| **Soldier Terminal PA / Antenna** | `36.0 dBm` (4 W) / `3.0 dBi` | Hemispheric Omni Whip Manpack |
| **Main Command Post PA / Antenna**| `43.0 dBm` (20 W) / `20.0 dBi` | Directional Tracking Parabolic Dish |
| **Tropospheric Refraction** | $k = 4/3$ ($R_{\text{eff}} = 8,494.67\,\text{km}$) | ITU-R P.834 Mean-Radius Spherical Earth |
| **Obstacle Diffraction Regime** | Knife-Edge + Fock Curvature (+12 dB) | ITU-R P.526-15 Rounded-Crest Dominant Obstacle |
| **Atmospheric Specific Attenuation**| `0.012 dB/km` (Clean Alpine Air) | ITU-R P.676 Gaseous Absorption |
| **ACN Flight Trajectory** | Constant Speed ($60\,\text{m/s}$) on Ellipse ($a=20\text{km}, b=10\text{km}$) | Arc-Length Parameterized Numerical Integration |
| **Superframe Structure** | $20.0\,\text{ms}$ (50 Hz frame rate) | 1ms CTRL + 3ms DL BCAST + 16ms Uplink |
| **Closed-Loop Timing Advance** | $\tau_{\text{guard}} = 12.0\,\mu\text{s}$ | $TA = 2 \cdot d_{3D} / c$ Closed-Loop Alignment |
| **Active Deployed Nodes** | 16 Terminals (15 Soldiers + 1 MCP) | Deterministic Ladakh valley deployment |

---

### 3. CONSOLIDATED MAC PERFORMANCE MATRIX

| Performance KPI Metric | Legacy Static TDMA | Tac-TAD (Dynamic Ours) | Operational Delta / Gain |
| :--- | :---: | :---: | :---: |
| **Total Delivered Goodput** | **27.72 Mb** | **215.78 Mb** | **+7.78x Throughput Gain** |
| **Median Superframe Goodput (P50)**| **0.13 Mbps** | **2.11 Mbps** | **+1.98 Mbps** |
| **Peak Superframe Goodput (P95)** | **0.96 Mbps** | **3.49 Mbps** | **+2.53 Mbps** |
| **Concluded Packet Drop Rate** | **52.68%** | **13.93%** | **-38.75% Drops Slashed** |
| **Pending In-Flight Rate (at Termination)** | `0.08%` (39 pkts) | `0.00%` (2 pkts) | `-0.07%` In-Flight |
| **Total Non-Delivery Rate (Drops + Pending)** | **52.71%** | **13.93%** | **-38.78% Deficit Reduced** |
| **Hard-Shadow Slot-Time Allocation Waste (Fraction of frame time assigned to severed links)** | **6.31%** | **0.00%** | **-6.31% Slot Waste Eliminated** |
| **Severed-Link Payload Waste (Bits dequeued into severed links)** | `6.02 Mb (17.9%)` | `0.00 Mb (0.0%)` | `-6.02 Mb` Saved |
| **Total Concluded Packets Dropped** | `27,088` | `7,168` | `-19,920` Packets Saved |

> **Clarification Note on Allocation Waste:** The 0.00% figure represents zero payload slot allocation to severed links. It does not imply zero protocol overhead or zero unallocated frame slack.

> **Clarification Note on Pending In-Flight Packets:** Packets remaining in queue at simulation termination ($T+100.0\text{s}$) without exceeding their deadline are classified as `PENDING_AT_TERMINATION` and are reported separately from the Concluded Packet Drop Rate.

---

### 4. 3GPP 5QI QUALITY-OF-SERVICE & LATENCY BENCHMARKS

| QoS Class Identifier & Traffic Profile | Static Drop Rate | Tac-TAD Drop Rate | Static Pending | Tac-TAD Pending | Static Mean Latency | Tac-TAD Mean Latency | Tac-TAD P95 Latency | PDB Delay Budget |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **5QI 69: Emergency C2 / SOS** | 7.92% | **4.63%** | 0.0% | 0.0% | 0.0 ms | **232.5 ms** | **0.0 ms** | `60 s (Persistent)` |
| **5QI 65: MC-PTT Voice** | 25.70% | **25.73%** | 0.0% | 0.0% | 0.0 ms | **0.1 ms** | **0.0 ms** | `75 ms` |
| **5QI 67: Tactical Video Feed** | 100.00% | **12.37%** | 0.2% | 0.0% | 0.0 ms | **6.4 ms** | **40.0 ms** | `150 ms` |
| **5QI 70: High-Res Recon Photo** | 100.00% | **1.15%** | 0.0% | 0.0% | 0.0 ms | **132.7 ms** | **340.0 ms** | `500 ms` |

> **Clarification Note on 5QI 69 (Emergency C2):** Class 69 implements bounded-memory protection (capped buffer). Under sustained overload, the oldest packets are evicted to preserve memory bounds.

---

### 5. TECHNICAL NARRATIVE & PROPAGATION PHYSICS ANALYSIS

#### 1. The Physics of Blind Static TDMA Failure
In conventional static TDMA architectures, the 16 ms uplink frame is divided symmetrically into rigid 1.0 ms slots per ground terminal. When a ground terminal (e.g., Recon Node 4) passes behind an alpine ridge feature (such as Mt. Kargil-I at 4,150 m MSL), the slant line-of-sight is severed. In standard systems, the ACN continues blindly assigning transmission slots to that severed terminal. 
- Transmissions into severed rock walls produce **zero received bits** at the airborne receiver.
- This creates **6.3% slot-time allocation waste** and burns **6.02 Mb of payload data**, simultaneously depriving heavily backlogged command posts (MCP Node 15) of necessary throughput, resulting in buffer overflow drops.

#### 2. The Predictive Look-Ahead Machine (`T_occ <= 3.0s`)
Tac-TAD resolves this via orbital trajectory propagation and a 4-state predictive machine:
1. `NORMAL_LOS`: Ground terminal has clear first Fresnel zone clearance. Normal rate-adaptive modulation.
2. `PRE_OCCLUSION_FLUSH`: When the look-ahead engine predicts optical occlusion within $T_{\text{occ}} \le 3.0\,\text{s}$, Tac-TAD urgently expands that terminal's superframe allocation, dumping the local queue onto the link before optical severing occurs.
3. `HARD_SHADOW_CUTOFF`: Upon line-of-sight severing, transmission allocations are immediately reduced to $0.0\,\text{ms}$ (100% time reclaimed). Cross-layer radio backoff prevents packet drops while queue generation pauses.
4. `RE_EMERGENCE_BURST`: As the terminal emerges from the mountain shadow, Tac-TAD pre-allocates zero-contention recovery capacity to drain accumulated C2 buffers instantly.

#### 3. Closed-Loop Timing Advance Efficiency
With accurate closed-loop timing advance ($TA = 2 \cdot d_{3D} / c$), guard intervals between TDMA bursts are safely collapsed to $\tau_{\text{guard}} = 12\,\mu\text{s}$. This limits guard overhead to under $1.0\%$ of the total frame, dedicating $>90\%$ of frame time to useful payload transmission.

---

### 6. GENERATED PUBLICATION ARTIFACTS
The following scientific figures have been generated and saved to `benchmark_results`:
- **`fig1_goodput_cdf.png`**: Instantaneous goodput (Mbps) empirical CDF comparing Static TDMA vs. Tac-TAD with median and 95th percentile markers.
- **`fig2_latency_cdf_5qi.png`**: 4-panel latency distribution comparing packet sojourn delays against strict 3GPP PDB deadlines.
- **`fig3_drop_rate_vs_terrain.png`**: Concluded drop rate percentage grouped by geomorphic occlusion states, verifying near-zero transition drops.
- **`fig4_spectral_efficiency_breakdown.png`**: Superframe time utilization stacked breakdown, contrasting 0.0% allocation waste in Tac-TAD against static TDMA.
- **`summary_metrics.csv`**: Raw structured scalar KPI export for downstream CI/CD regression verification.

---

### 7. DATA-QUALITY REVIEW AND REQUIRED FOLLOW-UP

1. **Execution cadence:** the source records 5,000 frames over 289.76 seconds of wall time (17.3 frames/s), while the configured simulated cadence is 50 frames/s. These are different quantities. The current engine's wall-clock performance must be benchmarked separately; the legacy report should not imply that the run executed in real time.
2. **Latency distribution integrity:** several rows in the QoS table report a positive mean latency alongside a P95 of 0.0 ms. This is not a credible percentile summary without a documented explanation and must be treated as a metric aggregation defect or unresolved data-quality issue until raw packet-level samples are inspected.
3. **Reproduction on migrated engine:** run identical scenario configuration and seeds against the TypeScript engine and legacy baseline. Compare packet-level outcomes where feasible, and document expected numerical differences.
4. **Statistical coverage:** one deterministic seed is insufficient for broad performance claims. Add paired multi-seed Monte Carlo runs, confidence intervals, scenario sensitivity analysis, and transparent exclusions.
5. **Artifact provenance:** retain the exact source revision, environment, configuration, terrain checksum, raw metrics, logs, and script versions used to generate each figure and table.

Until these actions are complete, use the tables as **historical benchmark evidence**, not as proof of current TypeScript performance or operational readiness.

---
*Historical report compiled by Tactical X-Band Digital Twin Benchmark Suite v4.4. Current-engine replication and metric audit pending.*
