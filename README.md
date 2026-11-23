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

### 2.5 Scientific Visual Instrumentation & Lattice Obsidian C2 Console
- **Lattice Obsidian C2 Console & 1-Click Direct-Manipulation Toolbox (`UI-01`–`UI-05`):** Unified Keysight PathWave × Ansys STK × Anduril Lattice industrial aerospace styling, zero-emoji military compliance, and on-map direct manipulation tools (Ruler, Probe, Area, 3D Obstacles).
- **Live High-Fidelity Physics Switches (`V2-01`):** Runtime toggleable ITU-R P.526 knife-edge/cylinder diffraction, P.676 atmospheric absorption, P.838 rain attenuation, and body-fixed quad-sector pattern fidelity.
- **Publication-Grade $N=30$ Benchmark Dossier (`V2-02`):** Automated multi-seed Monte Carlo engine with Student-t confidence intervals, Welch's unequal-variance t-tests, and IEEE Transactions LaTeX export (`npm run benchmark:ts`).
- **2D Canvas Label De-Confliction & URL Security (`V2-03`):** Sub-microsecond screen-space AABB collision resolver (`radarLabelLayout.ts`) eliminating tactical callout overlap, paired with hardened DOM/XSS protocol sanitization (`domSafety.ts`).
- **Bounded Parallel CI & Playwright UX Gate (`V2-04`):** Async child-process worker pool cutting verification runtime to $\sim 95\text{–}120\text{s}$, backed by multi-viewport Playwright Chromium testing and explicit `httpx` dependencies in CI.
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
│   ├── core/                       # Authoritative Domain Models & Physics Engines
│   │   ├── antennaArray.ts         # QuadSectorAntennaEngine (ITU-R F.1336, 4 quadrants)
│   │   ├── aoSwathScannerEngine.ts # CAD/QGIS-grade area-of-operations swath scanner
│   │   ├── config.ts               # RFConfig, EnvironmentConfig, ACNFlightConfig
│   │   ├── cursorProbeEngine.ts    # STK-grade precision cursor RF link probe
│   │   ├── geodesy.ts              # Canonical WGS-84 / ECEF / ENU geodetic transforms
│   │   ├── geodeticRulerEngine.ts  # Precision geodetic line-of-sight ruler engine
│   │   ├── kinematicPathSmoother.ts# Kinematic Dubins path smoothing & turn envelope
│   │   ├── linkBudget.ts           # LinkBudgetEngine (FSPL, P.676, P.838, P.618, DVB-S2X)
│   │   ├── macPhyFeedback.ts       # AMC with OLLA, HARQ Chase Combining, dynamic guard
│   │   ├── pduDissector.ts         # Wire-format Layer-1/Layer-2 MAC PDU dissector
│   │   ├── qosSlaEngine.ts         # 3GPP 5QI SLA compliance & Raj Jain fairness index
│   │   ├── queues.ts               # FQ-CoDel queue & 3GPP 5QI packet priority profiles
│   │   ├── rfPropagationMath.ts    # Unified ITU-R propagation & diffraction math
│   │   ├── scheduler.ts            # Static, Reactive M-LWDF, and Tac-TAD Schedulers
│   │   ├── tacticalAiPathfinder.ts # Edge-AI NLoS link-recovery pathfinder & squad self-healing
│   │   ├── tdmaConfig.ts           # TdmaFrameConfig superframe parameters
│   │   ├── terrain.ts              # TerrainEngine (P.834, P.526-15 Bullington / Deygout, SRTM DEM)
│   │   ├── trajectory.ts           # ACNTrajectory, Waypoints, PredictiveLookAheadEngine
│   │   ├── viewshedEngine.ts       # Polar X-band SINR viewshed & relay advisor
│   │   └── vsaConstellationEngine.ts# DVB-S2X I/Q constellation & EVM analyzer
│   ├── worker/                     # Authoritative Discrete-Event Web Worker
│   │   ├── aiCopilotCoordinator.ts # Worker Edge-AI copilot & autonomous repositioning
│   │   ├── nodeLifecycleManager.ts # Dynamic node addition, movement & lifecycle state
│   │   ├── simWorker.ts            # SimulationWorkerManager (50 Hz authoritative loop)
│   │   ├── telemetrySerializer.ts  # Binary/typed telemetry serialization & caching
│   │   └── terrainMeshGenerator.ts # Multi-resolution 3D DEM mesh generator
│   ├── ui/                         # UI Presentation & Visualization Coordinators
│   │   ├── accessibilityEncoding.ts# WCAG 2.1 accessible status palettes & pattern fills
│   │   ├── canvasTheme.ts          # Lattice Obsidian & CVD theme tokens for 2D/3D canvases
│   │   ├── domSafety.ts            # Reusable XSS neutralization & trusted HTML helpers
│   │   ├── mapController.ts        # 2D Tactical radar canvas & MapLibre GL controller
│   │   ├── networkTrafficInventory.ts# Authentic ground-relay-ground flow inventory
│   │   ├── scientificScopesRenderer.ts# HiDPI scopes (Polar, Waterfall, ECDF, Constellation)
│   │   ├── soldierEudRenderer.ts   # ATAK tactical soldier handheld EUD interface
│   │   ├── spatialSnapshotBuffer.ts# 3,000-frame bit-packed ring buffer
│   │   ├── threeFoundation.ts      # Three.js 3D scene & alpine rendering
│   │   └── timelineCoordinator.ts  # Timeline playback & scrubbing coordinator
│   └── shared/                     # Shared IPC Contracts & Protocols
│       ├── constants.ts            # Physical constants (c, FRAME_DT = 0.020s, 8 GHz)
│       └── workerProtocol.ts       # Typed WorkerInboundCommand & WorkerOutboundMessage
├── scripts/
│   ├── run_all_verifications.mjs   # Bounded parallel 102-suite verification runner (--concurrency=N, --serial)
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
git clone https://github.com/JustAnoobCat/tactical-xband-digital-twin.git
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

### Automated Verification Pipeline & Quality Gates
The repository enforces a comprehensive automated verification matrix ensuring 100% adherence to physics and architectural invariants:
- **`102` TypeScript verification suites (`npm run verify:all` — bounded parallel runner with `--concurrency=N` and `--serial` fallback)**
- **`27` Python `pytest` suites (`pytest -v`)**
- **`4`-viewport Playwright Chromium UX gate (`node scripts/verify-browser-ux.mjs` enforced in CI)**
- **CI / GitHub Pages Quality Gates (`.github/workflows/ci.yml` & `.github/workflows/deploy-pages.yml`)**

```bash
# Run all 102 TypeScript verification suites (bounded parallel runner)
npm run verify:all

# Run with custom concurrency or serial fallback
npm run verify:all -- --concurrency=4
npm run verify:all -- --serial

# Run 27 Python pytest suites
pytest -v

# Run 4-viewport Playwright browser UX verification (1440x900, 1366x768, 1024x768, 780x840)
node scripts/verify-browser-ux.mjs

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
  url = {https://github.com/JustAnoobCat/tactical-xband-digital-twin}
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
- [`SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH.md`](docs/specs/SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH.md): Active Two-Hop Decode-and-Forward (DF) Tactical Mesh Relay engine, harmonic capacity formula $R_{\text{DF}} = (R_1 R_2) / (R_1 + R_2)$, terrain-occluded valley terminal rescue, and live 2-hop mesh topology radar visualization.
- [`SPEC-3GPP-NTN-RICIAN-FADING-AND-CQI-AGING.md`](docs/specs/SPEC-3GPP-NTN-RICIAN-FADING-AND-CQI-AGING.md): 3GPP TR 38.811 elevation-dependent Rician small-scale multipath fading, deterministic Clarke/Jakes Doppler-coherent sum-of-sinusoids synthesis, and CQI feedback aging ($\tau_{\text{CQI}}$) with predictive Outer-Loop Link Adaptation (OLLA) margin protection.
- [`SPEC-3D-VOLUMETRIC-BEAMS-AND-SENSITIVITY-SWEEP.md`](docs/specs/SPEC-3D-VOLUMETRIC-BEAMS-AND-SENSITIVITY-SWEEP.md): 3D WebGL volumetric body-fixed sector cones with $-15^\circ$ downtilt, 3D `[MCP-OPT]` Decode-and-Forward relay mast and backhaul links, 3D EW jammer emitter and interference vector, and multi-point continuous parametric sensitivity sweep analyzer (`#sensitivity-sweep-canvas`).
- [`SPEC-UI-UX-MAKEOVER-MAPLIBRE-ANIM-AND-3D-PERF.md`](docs/specs/SPEC-UI-UX-MAKEOVER-MAPLIBRE-ANIM-AND-3D-PERF.md): Obsidian Aerospace UI/UX makeover (Anduril Lattice × Ansys STK), MapLibre 60 FPS projected kinetic overlay (`projectEnuToContainerPoint`), 3D WebGPU hardware pipeline, 3.5 km sector cone overdraw elimination, dynamic orbit pixelRatio scaling, and zero-lag 3D terrain rendering.
- [`SPEC-3D-MAPLIBRE-FIX-AND-TOOLBOX-DEEP-UPGRADE.md`](docs/specs/SPEC-3D-MAPLIBRE-FIX-AND-TOOLBOX-DEEP-UPGRADE.md): 3D mode zero-lag fix (`fast128` 32k-triangle mesh, unlit `MeshBasicMaterial`, zero `.computeLineDistances()`, 8 Hz timeline throttling), scheduler-synchronized MapLibre kinetic animations (Gantt-driven 5QI pulses, TX slot badges, `[WASTED TX]` outage flashes), and best-in-class deep upgrade of `#terrain-toolbox` (CloudRF/Google Earth Pro Transect Fresnel & bulge, Ansys STK Probe link & terminal spawn, QGIS Region Zonal Summit & LoS %, and Excalidraw Obstacle Authoring with undo/redo).
- [`SPEC-FLIGHT-PLANNER-QGROUNDCONTROL-UPGRADE.md`](docs/specs/SPEC-FLIGHT-PLANNER-QGROUNDCONTROL-UPGRADE.md): QGroundControl / ArduPilot / ForeFlight mission planner upgrade, interactive vertical terrain clearance profile canvas (`#fp-vertical-profile-canvas`), 4 aerospace pattern generators (elliptical orbit, racetrack holding, figure-8 cross-valley, Kargil canyon corridor transit), coordinated-turn aerodynamic envelope analysis ($R_{\min} = V^2 / (g \tan\phi)$), and route LoS coverage profiling.
- [`SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR.md`](docs/specs/SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR.md): Saleae Logic 2 microsecond timing cursor & hit-testing, speed-of-light Timing Advance guard strips, and Wireshark Layer-1/Layer-2 X-Band MAC PDU frame dissector with 5QI multiplexing and deterministic hex header dump.
- [`SPEC-PATH-PROFILE-BULLINGTON-REFRACTIVITY-UPGRADE.md`](docs/specs/SPEC-PATH-PROFILE-BULLINGTON-REFRACTIVITY-UPGRADE.md): ITU-R P.834-9 vertical atmospheric refractivity gradient ($\frac{dN}{dh}$) and $K$-factor effective Earth radius scaling, ITU-R P.526-15 Bullington double-horizon tangent ray intersection and virtual apex construction, multi-order Fresnel zones ($F_1, F_2, F_3$), and interactive SPLAT! / Radio Mobile crosshair inspector.
- [`SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE.md`](docs/specs/SPEC-DVBS2X-IQ-CONSTELLATION-VSA-UPGRADE.md): Keysight 89600 & Rohde & Schwarz VSE DVB-S2X Baseband I/Q Constellation, EVM & LDPC BLER Analyzer, canonical unit-energy constellations (QPSK, 8-PSK, 16-QAM/APSK, 32-APSK, 64-QAM/APSK), and interactive HiDPI scope inside `#tab-terminal`.
- [`SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE.md`](docs/specs/SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE.md): 3GPP TS 23.501 5QI Bearer SLA Compliance & Jain's Fairness Analyzer, Cisco ThousandEyes / iPerf3 telemetry dashboard, Head-of-Line sojourn tracking, and interactive 4-bearer scope inside `#tab-network`.
- [`SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE.md`](docs/specs/SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE.md): 3GPP Rel-17 NTN 4-Step RACH, Timing Advance Acquisition ($T_A$ index), C-RNTI allocation, and Event A3 Inter-Sector Handover Call-Flow Sequence Ladder Analyzer inside `#tab-registration`.
- [`SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE.md`](docs/specs/SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE.md): MATLAB / Simulink Real-Time 50 Hz Web Worker step latency profiler, 8-bin execution histogram, RFC 3550 pacing jitter, deadline headroom %, and publication-ready IEEE LaTeX / Markdown reproducible research dossier exporter inside `#tab-diagnostics`.
- [`SPEC-PRECISION-GEODETIC-LOS-RULER-TOOL1.md`](docs/specs/SPEC-PRECISION-GEODETIC-LOS-RULER-TOOL1.md): CAD/GIS-Grade Precision Geodetic & RF Line-of-Sight Ruler upgrade for Tool #1 (DEM Transect), 15px magnetic snapping to nodes/relays/jammers/ACN, live protractor angle arc with True North reference line, Shift-key 15° snapping, real-time split-color LoS/shadow ray-marching with blocking peak marker, and interactive draggable handles with ridge relay spawning.
- [`SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2.md`](docs/specs/SPEC-PRECISION-CURSOR-RF-PROBE-AND-UNIT-SPAWNER-TOOL2.md): CAD/STK-Grade Precision Cursor RF Link Probe, 360° Horizon Mask Analyzer & Unit Spawner upgrade for Tool #2 (Probe), real-time split-color LoS/shadow ray to ACN, 16-azimuth 360° polar horizon mask skyline ring, click-to-pin [P1] differential comparison, and 2 km polar-grid SINR peak finder.
- [`SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3.md`](docs/specs/SPEC-PRECISION-AO-SWATH-AND-DEADZONE-SCANNER-TOOL3.md): CAD/QGIS-Grade Precision Area-of-Operations (AO) Swath, Dead-Zone Matrix Scanner & Tactical Squad Auto-Deployer upgrade for Tool #3 (Region), CAD dimensions with Shift-lock square constraint, 64-cell RF SINR and outage matrix overlay, summit peak / valley floor / worst dead-zone pins, draggable corner handles, and 4-node squad auto-deployment.
- [`SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4.md`](docs/specs/SPEC-PRECISION-CAD-OBSTACLE-LINK-SLICER-TOOL4.md): Excalidraw / CAD-Grade Interactive Barrier Extruder & Real-Time 3D Link-Slice Previewer upgrade for Tool #4 (3D Obstacles), live 2D/3D link-ray intersection scanning, on-canvas intersection reticles (⊗) with slicing vs overflying badges, Excalidraw draggable handles ([V1], [V2], [✥]), one-click perpendicular link slicer, and auto-height matcher.
- [`SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH.md`](docs/specs/SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH.md): Intuitive human-friendly naming for the 4 Terrain Toolbox tools, spacious right-hand panel inspector docking inside `.detail-viewport` with unobstructed map canvas, toggleable scale division ticks on demand (`#btn-toggle-ruler-ticks`), dynamic step-by-step guidance banner (`#tb-step-guide-banner`), universal Escape key tool exit, and streamlined 2-line HUD callouts.
- [`SPEC-COMPREHENSIVE-51-POINT-UX-POLISH.md`](docs/specs/SPEC-COMPREHENSIVE-51-POINT-UX-POLISH.md): Comprehensive 51-point tactical digital twin UX polish, cross-tab node selection synchronization (`syncNodeDropdowns` + `ntn-node-select`), radar canvas pointer mutual exclusion, 12px toolbox typography, dynamic play/pause and live-return button states, interactive health tallies, and human-first 5QI labels.
- [`SPEC-TACTICAL-AI-NLOS-PATHFINDER-AND-AUTO-REPOSITION.md`](docs/specs/SPEC-TACTICAL-AI-NLOS-PATHFINDER-AND-AUTO-REPOSITION.md): 100% Local, Ultra-Lightweight (<16 KB RAM, <0.25 ms execution) Edge-AI NLoS Link-Recovery Pathfinder & Autonomous Self-Healing Engine featuring DEM Topographic Gradient Pre-Pruning ($\nabla z$), Online Tabular Q-Learning (`Float32Array(256)`), Tobler's Hiking Function biomechanics, on-canvas AI Guidance Vectors with glowing `[★ AI-SAFE]` beacons, and worker-authoritative autonomous squad self-healing.
- [`SPEC-WALKABLE-TERRAIN-PATHFINDER-AND-OBSTACLE-AVOIDANCE.md`](docs/specs/SPEC-WALKABLE-TERRAIN-PATHFINDER-AND-OBSTACLE-AVOIDANCE.md): Edge-AI 100% Step-by-Step Intermediate Terrain Walkability ($\Delta s \le 30\text{ m}$), Unit-Specific Incline Limits ($30^\circ$ Soldier, $18^\circ$ Wheeled MCP), 3D Barrier Footprint Collision Detection, and Multi-Waypoint 2-Segment Lateral Dogleg Detour Routing.
- [`SPEC-TACTICAL-EDGE-AI-COPILOT-AND-SOLDIER-PHONE-UI.md`](docs/specs/SPEC-TACTICAL-EDGE-AI-COPILOT-AND-SOLDIER-PHONE-UI.md): 5 Local Edge-AI Capabilities (Buddy-Relay Mesh, EW Defilade Terrain-Shield, Sky-Shepherd UAV Loiter Shift, LPI/LPD Stealth Power Control, 15s Blackout Countdown) and ATAK Soldier Handheld Phone UI with Turn-by-Turn Compass.
- [`SPEC-AI-PHYSICS-TRUTH-AND-CLOSED-LOOP-EXECUTION.md`](docs/specs/SPEC-AI-PHYSICS-TRUTH-AND-CLOSED-LOOP-EXECUTION.md): Ground Truth Coupling & Authoritative Closed-Loop Edge-AI (Exact Link Budget Parity, 3D Barrier Sky-Ray Blocking, Future-Orbit Arrival Scoring, Worker Closed-Loop Buddy-Relay Packet Delivery, Sky-Shepherd Physical UAV Repositioning, and LPI/LPD Stealth TX Power Control).
- [`SPEC-MASTER-MATHEMATICAL-RIGOR-AUDIT.md`](docs/specs/SPEC-MASTER-MATHEMATICAL-RIGOR-AUDIT.md): Master mathematical, physical, and geodetic rigor audit across all 16 core engines, curved-Earth bulge coordinate invariance, 3D body-frame Euler orientation alignment, ITU-R P.526-15 $T(m,n)$ boundary continuity, and 10-domain verification suite.
- [`SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md`](docs/specs/SPEC-SOFTWARE-ENGINEERING-MODULARITY-AND-DRY-REFACTOR.md): Software Engineering Modularity, DRY Physics Unification (`rfPropagationMath.ts`), Web Worker Separation of Concerns (`aiCopilotCoordinator.ts`), and TypeScript Static Type-Checked UI Scope Renderers (`scientificScopesRenderer.ts` & `soldierEudRenderer.ts`).
- [`METRICS_PATCH_NOTES.md`](docs/specs/METRICS_PATCH_NOTES.md): Symmetric airtime, throughput accounting, drop classifications, and benchmark provenance logging.

### Work Packages & Lattice Obsidian Foundation (`docs/specs/`)
- [`wp01-ci-quality-gate.md`](docs/specs/wp01-ci-quality-gate.md): WP-01 Continuous Integration & Deployment Quality Gate (`ci.yml` & `deploy-pages.yml`).
- [`wp02-backend-electron-hardening.md`](docs/specs/wp02-backend-electron-hardening.md): WP-02 Backend Security, Concurrency Hardening & Electron Desktop Containment.
- [`wp03-wgs84-ecef-enu-geodesy.md`](docs/specs/wp03-wgs84-ecef-enu-geodesy.md): WP-03 Canonical WGS-84 ECEF / ENU / Vincenty Geodetic Coordinate Engine.
- [`wp04-itur526-multiedge-diffraction.md`](docs/specs/wp04-itur526-multiedge-diffraction.md): WP-04 ITU-R P.526-15 Multi-Edge Diffraction Engine (Bullington & Cascaded Deygout).
- [`wp05-airframe-attitude-and-channel-dynamics.md`](docs/specs/wp05-airframe-attitude-and-channel-dynamics.md): WP-05 Airframe Attitude Dynamics, 3D Coordinate Transforms, Fuselage Shadowing & Time-Correlated Rician-Jakes Fading.
- [`wp06-mac-phy-feedback-dynamics.md`](docs/specs/wp06-mac-phy-feedback-dynamics.md): WP-06 MAC/PHY Feedback Dynamics — Delayed-CQI AMC with OLLA, RTT-Delayed HARQ Chase Combining & Incremental Redundancy, Dynamic TDMA Guard Overhead.
- [`wp07-kinematic-dubins-pathfinder.md`](docs/specs/wp07-kinematic-dubins-pathfinder.md): WP-07 Kinematic Dubins Path Smoothing & 3D Flight Feasibility Engine.
- [`wp08-worker-transferables-and-bounded-replay.md`](docs/specs/wp08-worker-transferables-and-bounded-replay.md): WP-08 Web Worker Zero-Copy Transferables & Bounded Adaptive Replay Buffer Engine.
- [`wp09-dom-xss-safety-and-modular-extraction.md`](docs/specs/wp09-dom-xss-safety-and-modular-extraction.md): WP-09 Reusable DOM/XSS Safety Layer and Pure Worker Modular Decomposition.
- [`wp10-viewshed-parity-and-accessibility-encoding.md`](docs/specs/wp10-viewshed-parity-and-accessibility-encoding.md): WP-10 Viewshed-vs-Live Link Parity Engine & WCAG 2.1 Accessible Status Encoding.
- [`wp11-scientific-benchmarking-rigor.md`](docs/specs/wp11-scientific-benchmarking-rigor.md): WP-11 Scientific Benchmarking Rigor — Deterministic Multi-Seed Monte Carlo, Student-t Confidence Intervals, Welch's t-Test & ITU-R Reference Cross-Validation.
- [`ui01-tactical-workbench-architecture.md`](docs/specs/ui01-tactical-workbench-architecture.md): UI-01 Forensic DOM Contract Audit & Tactical Obsidian Design System Foundation across all 9 workspaces.
- [`ui02-lattice-obsidian-cutover.md`](docs/specs/ui02-lattice-obsidian-cutover.md): UI-02 Atomic Lattice Obsidian C2 Console UI Cutover, Stitch Removal, Zero-Emoji Purge, and MIL-STD Soldier EUD Rebuild.
- [`ui03-canvas-theme-and-stitch-cleanup.md`](docs/specs/ui03-canvas-theme-and-stitch-cleanup.md): UI-03 Unified Canvas Obsidian/CVD Theme, Live Playwright CVD/Air-Gap Checks & Dead Stitch Artifact Cleanup.
- [`ui05-direct-manipulation-toolbox.md`](docs/specs/ui05-direct-manipulation-toolbox.md): UI-05 Frontier 1-Click Direct-Manipulation Terrain Toolbox (Ruler, Probe, Area, Obstacles).

### Frontier Milestones V2-01–V2-04 Specifications (`docs/specs/`)
- [`SPEC-ITU-FIRST-PRINCIPLES-RF-AND-TERRAIN.md`](docs/specs/SPEC-ITU-FIRST-PRINCIPLES-RF-AND-TERRAIN.md) (`V2-01`): Live High-Fidelity Physics switches, curved-Earth geometry ($k = 4/3$), atmospheric gas absorption, and ITU-R P.526 multi-ridge diffraction controls.
- [`wp11-scientific-benchmarking-rigor.md`](docs/specs/wp11-scientific-benchmarking-rigor.md) (`V2-02`): Publication-Grade $N=30$ Monte Carlo benchmark dossier, Welch's t-test hypothesis rejection, and IEEE LaTeX table export (`npm run benchmark:ts`).
- [`wp09-dom-xss-safety-and-modular-extraction.md`](docs/specs/wp09-dom-xss-safety-and-modular-extraction.md) (`V2-03`): 2D Canvas label de-confliction collision-avoidance layout (`radarLabelLayout.ts`), sub-microsecond DOM/XSS safety layer, and URL security protocol filtering.
- [`v2-04-parallel-ci-and-release-polish.md`](docs/specs/v2-04-parallel-ci-and-release-polish.md) (`V2-04`): 4× faster bounded parallel verification runner (`run_all_verifications.mjs`), bulletproof CI with explicit `httpx` in `python-verify`, and dedicated 4-viewport Playwright Chromium UX gate.
