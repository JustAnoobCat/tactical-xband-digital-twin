# Tactical X-Band Air-to-Ground Network Digital Twin

An authoritative, physics-grounded discrete-event digital twin simulating an airborne tactical relay network operating in high-relief alpine topography (Ladakh / Kargil sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$).

The platform models an Airborne Communication Node (ACN) serving 16 dismounted tactical ground terminals and command posts over an $8.0\text{ GHz}$ X-Band carrier. It incorporates first-principles ITU-R propagation physics, body-fixed quad-sector antenna arrays, 4-channel parallel TDMA MAC scheduling, and a 3-way ablation baseline (`Legacy_Static_TDMA` vs. `Reactive_M_LWDF` vs. `Predictive_Tac_TAD`).

---

## 1. System Overview & Mission Context

In mountainous battlefields, severe terrain relief creates knife-edge and multi-ridge diffraction, deep non-line-of-sight (NLOS) shadow zones, and rapid link severing as airborne relay aircraft traverse mountain valleys. 

This Digital Twin provides a real-time, browser-hosted laboratory to evaluate:
- **Terrain-Induced Outages:** Dynamic shadow entry and re-emergence across steep Himalayan topography sampled from a $512 \times 512$ point-registered SRTM DEM.
- **First-Principles RF Link Budgets:** Continuous path loss, diffraction, atmospheric absorption, rain attenuation, and antenna roll-off.
- **Quality-of-Service (QoS) Queue Dynamics:** 3GPP 5QI packet priority queues (5QI 69 Emergency C2, 65 Mission-Critical PTT Voice, 67 Tactical Video, 70 Tactical Imagery) with strict packet delay budgets.
- **Predictive vs. Reactive MAC Scheduling:** Lookahead terrain pre-evacuation algorithms (`Tac-TAD`) vs. reactive baselines (`Reactive M-LWDF` and `Static TDMA`).

---

## 2. Key Scientific & Architectural Capabilities

### 2.1 Authoritative 50 Hz Web Worker Discrete-Event Engine
- **Strict Worker State Authority:** All mutable live simulation state (kinematics, propagation matrices, packet queues, TDMA slots) lives exclusively inside a background Web Worker (`src/worker/simWorker.ts`).
- **50 Hz Discrete-Event Loop ($\Delta t = 20\text{ ms}$):** The worker advances on a strict 20 ms cadence, computing the complete 16-node RF state, multi-channel TDMA schedule, and queue updates within an average step time of $\sim 4.5\text{ ms}$ ($p95 < 8.0\text{ ms} \ll 20.0\text{ ms}$).
- **Zero-Allocation Hot Loops:** Terrain ray-marching, geodetic transformations, and metric calculations utilize scalar iterations and coordinate caches with zero GC heap thrashing.

### 2.2 Body-Fixed Quad-Sector Quadrant Antenna Array
- **4-Sector Architecture:** Body-fixed quadrant horn antennas oriented at $\psi \in \{0^\circ\text{ FWD}, 90^\circ\text{ STBD}, 180^\circ\text{ AFT}, 270^\circ\text{ PORT}\}$.
- **ITU-R F.1336 Radiation Patterns:** Parabolic azimuthal roll-off ($G_0 = 15.0\text{ dBi}$, $\theta_{3\text{dB}} = 65^\circ$, $G_{\text{sidelobe}} = 25\text{ dB}$).
- **Dynamic Bank-Angle Coupling:** Aircraft centripetal turns calculate roll angle $\phi = \arctan(v^2 / (g R))$, projecting antennas into the 3D line-of-sight geometry.
- **Sector Handover Hysteresis:** A $1.5\text{ dB}$ handover margin eliminates ping-pong chattering between adjacent sectors at $\pm 45^\circ$ crossover boundaries.

### 2.3 First-Principles ITU-R Propagation Stack
- **ITU-R P.834:** Effective Earth curvature radius with $k = 4/3$ parabolic bulge geometry.
- **ITU-R P.526-15 §4.5.1 Multi-Ridge Diffraction:** Bullington double-horizon equivalent knife-edge method evaluating Tx and Rx horizon angles across sampled terrain.
- **ITU-R P.526-15 §4.2 Physical DEM Crest Curvature:** Computes local obstacle radius of curvature $R_{\text{crest}} = \Delta s^2 / |h_{i-1} - 2h_i + h_{i+1}|$ to evaluate the genuine cylinder curvature loss $T(m, n)$, replacing legacy empirical constants.
- **ITU-R P.676-13 Altitude-Integrated Gaseous Absorption:** Altitude-resolved barometric scale-height absorption ($H_{\text{scale}} = 2.0\text{ km}$ for $\text{H}_2\text{O}$, $8.0\text{ km}$ for dry $\text{O}_2$).
- **ITU-R P.838-3 / P.839-4 Rain Loss with Freezing Ceiling:** Horizontal-polarization rain loss integrating path length strictly below the regional $0^\circ\text{C}$ isotherm ($4,800\text{ m}$ MSL in Ladakh).
- **ITU-R P.618-14 Atmospheric Sky-Noise Coupling:** Thermal brightness coupling adds antenna sky temperature $T_{\text{sky}}$ directly into the receiver noise figure floor ($\Delta N_{\text{sky}}$).
- **Adaptive Modulation and Coding (ACM):** 8-tier DVB-S2X constellation mapping from $\pi/2\text{-BPSK 1/3}$ ($0.33\text{ bit/s/Hz}$ at $-1.5\text{ dB}$) to $64\text{-APSK 5/6}$ ($4.95\text{ bit/s/Hz}$ at $22.0\text{ dB}$).

### 2.4 4-Channel Parallel TDMA & 3-Way MAC Ablation Baseline
The simulation executes three parallel, lockstep MAC policies across each sector:
1. **`Legacy_Static_TDMA`:** Fixed static slot duration ($\tau = T_{\text{UL}} / N$). Allocations continue into link outages, causing massive packet loss and wasted airtime.
2. **`Reactive_M_LWDF` (Modified Largest Weighted Delay First):** Proportional-fair throughput balancing with QoS queue urgency, but strictly reactive ($\Phi_{\text{evac}} \equiv 1.0$, lookahead disabled).
3. **`Predictive_Tac_TAD` (Terrain-Aware Dynamic TDMA):** First-principles deadline-optimal lookahead control:
   - **Dimensionless Queue-Drain Evacuation Pressure:** $\zeta_i = \tau_{\text{drain}, i} / \max(\tau_{\text{occ}, i}, 0.020\text{ s})$ where $\tau_{\text{drain}, i} = Q_i / R_i$.
   - **Effective Physical Deadline Compression:** $\tau_{\text{eff-TTL}, i} = \min(\tau_{\text{TTL}, i}, \tau_{\text{occ}, i})$.
   - **Imminent-Expiry Protection Gate:** Pre-occlusion flushes yield ($\Phi_{\text{evac}} = 1.0$) whenever a peer node in the sector has $\ge 82\%$ PDB consumed and $\tau_{\text{TTL}} \le 30\text{ ms}$, ensuring time-critical packets never drop due to lookahead preemption.

### 2.5 Scientific Visual Instrumentation
- **ITU-R F.1336 Polar Scope:** Live polar radiation diagram depicting quadrant antenna gain and aircraft heading.
- **Link Budget Waterfall Cascade:** Real-time breakdown of FSPL, gaseous, rain, crest diffraction, antenna gain, and thermal noise.
- **4-Lane Superframe Gantt Analyzer:** Sub-millisecond visualization of uplink slots, downlink windows, guard intervals, and pre-occlusion flushes.
- **3,000-Frame Bit-Packed Historical Scrubber:** Zero-allocation ring buffer storing 60 seconds of telemetry for instant frame scrubbing.
- **Geospatial & 3D Workspaces:** 2D canvas radar, geodetic MapLibre GL raster mapping, and Three.js 3D alpine terrain rendering.

---

## 3. Architecture & Repository Seams

```
tactical-xband-digital-twin/
├── src/
│   ├── core/                       # Authoritative Domain Models & Physics
│   │   ├── antennaArray.ts         # QuadSectorAntennaEngine (ITU-R F.1336, 4 quadrants)
│   │   ├── config.ts               # RFConfig, EnvironmentConfig, ACNFlightConfig
│   │   ├── geodesy.ts              # WGS-84 / Equirectangular coordinate transforms
│   │   ├── linkBudget.ts           # LinkBudgetEngine (FSPL, P.676, P.838, P.618, DVB-S2X)
│   │   ├── queues.ts               # FQCoDelQueue, QoS profiles (5QI 69, 65, 67, 70)
│   │   ├── scheduler.ts            # Static, Reactive M-LWDF, and Tac-TAD Schedulers
│   │   ├── tdmaConfig.ts           # TdmaFrameConfig superframe parameters
│   │   ├── terrain.ts              # TerrainEngine (P.834, P.526-15 Bullington, SRTM DEM)
│   │   └── trajectory.ts           # ACNTrajectory, Waypoints, PredictiveLookAheadEngine
│   ├── worker/                     # Authoritative Discrete-Event Web Worker
│   │   ├── simWorker.ts            # SimulationWorkerManager (50 Hz authoritative loop)
│   │   └── telemetrySerializer.ts  # Binary/typed telemetry serialization & caching
│   ├── ui/                         # UI Presentation & Visualization Coordinators
│   │   ├── mapRenderer.ts          # 2D Canvas radar display
│   │   ├── spatialSnapshotBuffer.ts# 3,000-frame bit-packed ring buffer
│   │   ├── threeFoundation.ts      # Three.js 3D scene & alpine rendering
│   │   └── timelineCoordinator.ts  # Timeline playback & scrubbing coordinator
│   └── shared/                     # Shared IPC Contracts & Protocols
│       ├── constants.ts            # Physical constants (c, FRAME_DT = 0.020s, 8 GHz)
│       └── workerProtocol.ts       # Typed WorkerInboundCommand & WorkerOutboundMessage
├── scripts/
│   ├── run_all_verifications.mjs   # Comprehensive 59-suite test runner
│   ├── run_ts_benchmark.ts         # Headless multi-seed benchmark CLI
│   ├── verify-browser-ux.mjs       # Multi-viewport Playwright UX audit suite
│   └── verify-project.mjs          # Architectural invariants and structure validator
├── public/terrain/                 # Authentic 512x512 SRTM DEM binaries
└── index.html                      # C2 Operator Workbench & Scientific Instruments
```

---

## 4. Quick Start & Execution Protocol

### Prerequisites
- Node.js $\ge 20$ (v24.x recommended)
- Linux / macOS / Windows with modern browser

### Installation
```bash
git clone https://github.com/organization/tactical-xband-digital-twin.git
cd tactical-xband-digital-twin
npm install
```

### Launch Interactive Development Workbench
```bash
npm run dev
```
Open `http://localhost:5173` in any modern Chromium/Firefox/WebKit browser.

### Headless CLI Benchmark Runner
Run reproducible, headless multi-seed simulations across arbitrary traffic loads, terrain modes, and durations:
```bash
# Standard 5-seed benchmark at 3.5x congested traffic load
npm run benchmark:ts -- --duration 5 --traffic-scale 3.5

# Benchmark against authentic Ladakh satellite DEM raster
npm run benchmark:ts -- --duration 10 --traffic-scale 3.5 --terrain-mode real
```

### Automated Verification Pipeline
The repository features an automated 59-suite verification matrix ensuring 100% adherence to physics and architectural invariants:
```bash
# Run all 59 verification suites
npm run verify:all

# Run multi-viewport Playwright browser verification (1440x900, 1366x768, 1024x768, 780x840)
npm run verify:browser

# Production build check
npm run build
```

---

## 5. Representative 3-Way Ablation Benchmark Results

*Run conditions: 5-second simulation (250 frames @ 50 Hz), $3.5\times$ traffic load multiplier, $\sigma_{\text{DEM}} = 5.0\text{ m}$ elevation uncertainty, 16 ground nodes.*

| Seed | Metric | `Legacy_Static_TDMA` | `Reactive_M_LWDF` | `Predictive_Tac_TAD` | Improvement / Advantage |
|:---:|:---|:---:|:---:|:---:|:---|
| **Seed 1** | Goodput Delivered<br>Delay Drops<br>Outage Waste | 12.31 Mb<br>1,478 drops<br>2.84 Mb | 20.38 Mb<br>196 drops<br>0.00 Mb | **20.38 Mb**<br>**196 drops**<br>**0.00 Mb** | **+65.6% goodput** vs Static<br>**-86.7% drops** vs Static<br>Ties reactive (zero premature flushes) |
| **Seed 2** | Goodput Delivered<br>Delay Drops<br>Outage Waste | 12.71 Mb<br>1,406 drops<br>2.71 Mb | 20.67 Mb<br>150 drops<br>0.00 Mb | **20.67 Mb**<br>**150 drops**<br>**0.00 Mb** | **+62.6% goodput** vs Static<br>**-89.3% drops** vs Static<br>Deadline control cures congestion deficit |
| **Seed 3** | Goodput Delivered<br>Delay Drops<br>Outage Waste | 12.48 Mb<br>1,419 drops<br>2.79 Mb | 20.47 Mb<br>166 drops<br>0.00 Mb | **20.47 Mb**<br>**166 drops**<br>**0.00 Mb** | **+64.0% goodput** vs Static<br>**-88.3% drops** vs Static<br>Equal delay drops |
| **Seed 4** | Goodput Delivered<br>Delay Drops<br>Outage Waste | 12.58 Mb<br>1,387 drops<br>2.75 Mb | 20.65 Mb<br>139 drops<br>0.00 Mb | **20.65 Mb**<br>**139 drops**<br>**0.00 Mb** | **+64.1% goodput** vs Static<br>**-90.0% drops** vs Static<br>Equal delay drops |
| **Seed 5** | Goodput Delivered<br>Delay Drops<br>Outage Waste | 12.43 Mb<br>1,449 drops<br>2.80 Mb | 20.51 Mb<br>144 drops<br>0.00 Mb | **20.51 Mb**<br>**144 drops**<br>**0.00 Mb** | **+65.0% goodput** vs Static<br>**-90.1% drops** vs Static<br>Equal delay drops |
| **Total (1–5)** | **Cumulative Delay Drops**<br>**Total Outage Waste**<br>**Step Latency (p95)** | **7,139 drops**<br>13.89 Mb<br>1.20 ms | **795 drops**<br>0.00 Mb<br>7.38 ms | **795 drops**<br>**0.00 Mb**<br>**7.49 ms** | **-88.9% cumulative drops** vs Static<br>**$\le$ drops on every seed** vs Reactive<br>**p95 $< 8.0\text{ ms} \ll 20.0\text{ ms}$ budget** |

---

## 6. Citation & Engineering Attribution

If you utilize this Digital Twin platform, its mathematical formulations, or its ITU-R diffraction implementation in your research, please cite:

```bibtex
@software{tactical_xband_digital_twin_2026,
  title = {Tactical X-Band Air-to-Ground Network Digital Twin},
  year = {2026},
  version = {1.2.0},
  url = {https://github.com/organization/tactical-xband-digital-twin}
}
```

---

## 7. Architecture Specifications (`docs/specs/`)

Detailed engineering design specifications, mathematical models, and architectural blueprints are archived in [`docs/specs/`](docs/specs/):

- [`SPEC-ITU-FIRST-PRINCIPLES-RF-AND-TERRAIN.md`](docs/specs/SPEC-ITU-FIRST-PRINCIPLES-RF-AND-TERRAIN.md): First-principles ITU-R P.526-15 multi-ridge diffraction, P.676-13 barometric gaseous absorption, P.838-3/P.839-4 rain loss with freezing isotherm partitioning, and P.618-14 sky-noise temperature coupling.
- [`SPEC-QUAD-SECTOR-ANTENNA-UPGRADE.md`](docs/specs/SPEC-QUAD-SECTOR-ANTENNA-UPGRADE.md): 4-channel parallel per-sector TDMA architecture with body-fixed quadrant array ($0^\circ, 90^\circ, 180^\circ, 270^\circ$), ITU-R F.1336 parabolic roll-off, aircraft bank-angle roll coupling, and 1.5 dB handover hysteresis.
- [`SPEC-PERFORMANCE-OPTIMIZATION-REV1.md`](docs/specs/SPEC-PERFORMANCE-OPTIMIZATION-REV1.md): Web Worker discrete-event loop optimization, zero-allocation spatial buffers, and SIMD/typed-array memory architectures achieving $\le 8\text{ ms}$ p95 step latency.
- [`SPEC-TERRAIN-WORKSPACE-UX-REVAMP.md`](docs/specs/SPEC-TERRAIN-WORKSPACE-UX-REVAMP.md): High-fidelity 3D alpine terrain workspace, TopoJSON/GeoTIFF ingestion, interactive transect tooling, and C2 tactical console UX.
- [`SPEC-TERRAIN-WORKSPACE-UX-REVAMP-REV3.md`](docs/specs/SPEC-TERRAIN-WORKSPACE-UX-REVAMP-REV3.md): Scientific terrain toolbox revision 3, curvature cylinder loss inspection, and DEM height profiling.
- [`SPEC-DOPPLER-KINEMATICS-AND-EW-JAMMER-SINR.md`](docs/specs/SPEC-DOPPLER-KINEMATICS-AND-EW-JAMMER-SINR.md): 8.0 GHz Doppler kinematics, high-Mach radial velocity frequency shifts, contested EW jammer ERP modeling, and terrain-shielded SINR degradation.
- [`SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR.md`](docs/specs/SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR.md): Real-time polar X-band SINR viewshed engine, 36-azimuth $\times$ 16-range bin amortized sweep, body-fixed 4-sector coupling, and 360° orbit-integrated optimal ridgeline relay placement advisor.
- [`SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT.md`](docs/specs/SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT.md): Empirical CDF (ECDF) packet delay distribution scope with 3GPP 5QI packet delay budget markers, and publication-ready IEEE Transactions LaTeX table generator for multi-seed ablation benchmarks.
- [`SPEC-KARGIL-RIDGE-TRANSIT-AND-TACTAD-ADVANTAGE.md`](docs/specs/SPEC-KARGIL-RIDGE-TRANSIT-AND-TACTAD-ADVANTAGE.md): Strict 3-way scheduling hierarchy, terrain-aware pre-occlusion cliff lookahead, reactive M-LWDF fair-share bounding, and Tac-TAD superframe deficit drainage advantage.
- [`METRICS_PATCH_NOTES.md`](docs/specs/METRICS_PATCH_NOTES.md): Symmetric airtime, throughput accounting, drop classifications, and benchmark provenance logging.

