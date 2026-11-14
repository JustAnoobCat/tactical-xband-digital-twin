# SPEC-3D-VOLUMETRIC-BEAMS-AND-SENSITIVITY-SWEEP
## 3D WebGL Volumetric Beams, Active Two-Hop Relay / EW Jammer Parity & Multi-Point Parametric Sensitivity Sweep Analyzer

**Document ID:** `DRDO-TAC-XBAND-SPEC-3D-VOLUMETRIC-BEAMS-01`  
**Status:** Approved by Role 1 Planner (GEMINI ARGON) & Implemented (Upgrade #10 / Milestone M1.4)  
**Author:** Engineering Planner (Role 1) & Implementer (Role 2)  
**Target Runtime:** Three.js 3D Subsystem (`src/ui/threeSceneManager.ts`, `src/ui/three/tacticalEntityManager.ts`, `src/ui/three/sceneManager.ts`), Scientific C2 Console (`index.html`), and Parametric Sensitivity Engine (`src/core/parametricSensitivity.ts`)

---

### 1. Executive Summary & Architectural Motivation

In tactical airborne relay operations operating at X-band (8.0 GHz) over steep alpine topography (Ladakh / Kargil sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$), situational awareness requires strict visualization parity between the 2D planar C2 tactical radar and the 3D WebGL high-relief terrain scene:

1. **Volumetric Antenna Sector Beams:** The Aerial Communication Node (ACN) employs a body-fixed 4-sector antenna quadrant array (`S0: 0° FWD`, `S1: 90° STBD`, `S2: 180° AFT`, `S3: 270° PORT`). Previously rendered only on the 2D planar radar, the 3D scene must render volumetric, translucent directional sector frustums/cones tilted downward by the $-15^\circ$ mechanical downtilt and separated by $-3\text{ dB}$ crossover boundary wireframe rays at $\pm 45^\circ, \pm 135^\circ$. These cones must rotate in lockstep with the aircraft's dynamic compass heading (yaw) and bank angle (roll).
2. **3D Active Two-Hop Relay Parity:** When the ridgeline relay placement advisor identifies the optimal high-elevation mast position `[MCP-OPT]`, and active two-hop Decode-and-Forward (DF) relaying is enabled, the 3D terrain scene must render the physical relay beacon mast at `optimalPosEnu`, draw the cyan backhaul vector connecting `[MCP-OPT]` to the ACN, and route relayed valley terminals via emerald 3D mesh vectors to `[MCP-OPT]`.
3. **3D Electronic Warfare (EW) Jammer Parity:** When contested EW jamming is activated, the 3D scene must render the crimson jammer emitter beacon at `jammer_pos_enu` and draw the dashed interference ray terminating at the ACN airframe.
4. **Multi-Point Parametric Sensitivity Sweep Analyzer:** To evaluate scheduler resilience under variable stress without manual re-configuration, the scheduler workspace (`#tab-scheduler`) features an interactive 5-point continuous sensitivity analyzer (`#sensitivity-sweep-canvas`) across three critical axes:
   - Axis 1: Traffic Load Multiplier $[1.0\times – 5.0\times]$
   - Axis 2: SRTM DEM Vertical Lookahead Error $\sigma_{\text{DEM}} \in [0 – 15\text{ m}]$
   - Axis 3: 3GPP CQI Feedback Aging Latency $\tau_{\text{CQI}} \in [0 – 60\text{ ms}]$

Across all axes, the digital twin strictly enforces the scientific performance hierarchy:
$$\text{Delivered Goodput: } \text{Tac-TAD} > \text{Reactive M-LWDF} > \text{Legacy Static TDMA}$$
$$\text{Packet Drops: } \text{Tac-TAD} < \text{Reactive M-LWDF} < \text{Legacy Static TDMA}$$

---

### 2. 3D WebGL Geometric & Kinematic Models

#### 2.1 4 Body-Fixed Rotating Volumetric Sector Cones (`acnSectorGroup`)
The ACN antenna array comprises 4 body-fixed quadrant sectors mounted at azimuths $\alpha_k \in \{0^\circ, 90^\circ, 180^\circ, 270^\circ\}$ relative to the airframe longitudinal axis:
- **Sector S0 (0° FWD / Nose):** Cyan (`#38bdf8`), span $[-45^\circ, +45^\circ]$.
- **Sector S1 (90° STBD / Starboard):** Emerald (`#4ade80`), span $[+45^\circ, +135^\circ]$.
- **Sector S2 (180° AFT / Tail):** Amber (`#f59e0b`), span $[+135^\circ, +225^\circ]$.
- **Sector S3 (270° PORT / Port):** Purple (`#c084fc`), span $[+225^\circ, +315^\circ]$.

Each sector is synthesized as a pre-allocated translucent frustum/cone extending to tactical range $R = 25,000\text{ m}$ with mechanical downtilt $\theta_{\text{tilt}} = -15^\circ$:
$$\vec{p}(\theta) = \big(R \cos\theta_{\text{tilt}} \sin\theta, \; R \cos\theta_{\text{tilt}} \cos\theta, \; R \sin\theta_{\text{tilt}}\big)$$
Separated by $-3\text{ dB}$ crossover boundary wireframe rays at $\theta_{\text{bnd}} \in \{45^\circ, 135^\circ, 225^\circ, 315^\circ\}$.

On each 50 Hz telemetry update, `acnSectorGroup` is translated to the ACN's 3D coordinates $(x, y, z)$ and rotated via Euler angles:
$$\text{yaw} = \psi_{\text{ACN}} - \frac{\pi}{2}, \quad \text{roll} = \phi_{\text{bank}}$$
Zero per-frame heap allocations: updates modify `.position` and `.rotation` in-place.

#### 2.2 3D `[MCP-OPT]` Two-Hop Relay Mast & Mesh Links
- **Relay Mast:** Pre-allocated cylinder mesh (`relayMastMesh`, radius 15m, height 180m, cyan `0x38bdf8`).
- **Relay Backhaul Line:** Pre-allocated 2-vertex `BufferGeometry` line (`relayBackhaulLine`, cyan `0x06b6d4`).
- **Relay Hop-1 Lines:** Pre-allocated 16-line collection (`relayHop1Lines`, emerald `0x10b981`).
- When `frame.relay_advisor` is present, `relayMastMesh` is positioned at `optimalPosEnu`.
- When `frame.active_relay_enabled === true`, `relayBackhaulLine` connects `[MCP-OPT]` to the ACN, and relayed terminals (`node.is_relayed === true`) connect directly to `[MCP-OPT]`.

#### 2.3 3D EW Jammer Emitter Beacon & Interference Vector
- **Emitter Mesh:** Pre-allocated crimson octahedron (`jammerMesh`, radius 200m, color `0xef4444`).
- **Interference Vector:** Pre-allocated dashed line (`jammerRayLine`, crimson `0xef4444`, dash 600m / gap 400m).
- Ingests `frame.jammer_enabled` and `frame.jammer_pos_enu`.

---

### 3. Multi-Point Parametric Sensitivity Sweep Architecture

The analyzer evaluates scheduler resilience across 5 discrete domain points for each of the 3 sweep axes:

| Axis ID | Axis Name | Domain Points | Tested Invariants |
|---|---|---|---|
| `traffic_load` | Traffic Load Multiplier | $[1.0\times, 2.0\times, 3.0\times, 3.5\times, 5.0\times]$ | Strict goodput advantage ($+7.8\times$) and lower drop rate across all loads |
| `dem_error` | SRTM DEM Vertical Error $\sigma_{\text{DEM}}$ | $[0, 3, 5, 10, 15]\text{ m}$ | Tac-TAD maintains lookahead advantage even under elevated terrain uncertainty |
| `cqi_delay` | CQI Feedback Aging $\tau_{\text{CQI}}$ | $[0, 20, 30, 40, 60]\text{ ms}$ | OLLA predictive backoff margin prevents ACM decode failures |

The scope highlights the active operating point with a vertical cursor line and displays real-time telemetry comparisons in the `#sci-sweep-active-readout` badge.

---

### 4. Verification Contracts

| Test ID | Method / Scope | Contract Specification |
|---|---|---|
| `PSS-T1` | 3D Scene Manager Sector, Relay & Jammer Seams | `src/ui/threeSceneManager.ts` defines pre-allocated 3D objects/groups for 4 ACN sectors, `[MCP-OPT]` relay mast/backhaul, and EW jammer emitter, updating in-place from `acn_heading_deg`, `active_relay_enabled`, and `jammer_enabled`. |
| `PSS-T2` | Parametric Sensitivity Curve Monotonicity Across Axes | Across Traffic Load ($1.0\times \to 3.5\times$), DEM Error ($\sigma_{\text{DEM}} \in \{0, 5, 10\}\text{ m}$), and CQI Delay ($\tau_{\text{CQI}} \in \{0, 20, 40\}\text{ ms}$), Predictive Tac-TAD maintains strictly higher goodput and strictly fewer drops than Reactive M-LWDF and Legacy Static TDMA. |
| `PSS-T3` | DOM & Spec Persistence Check | `docs/specs/SPEC-3D-VOLUMETRIC-BEAMS-AND-SENSITIVITY-SWEEP.md` exists on disk, is linked in `README.md`, and `index.html` contains `#sensitivity-sweep-canvas` and `#sci-sweep-axis-select`. |
