# SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH
## Active Two-Hop Decode-and-Forward (DF) Tactical Mesh Relay Engine

**Document ID:** `DRDO-TAC-XBAND-SPEC-ACTIVE-RELAY-01`  
**Status:** Approved by Role 1 Planner (Gemini Argon) & Implemented (Upgrade #8 / M1.2)  
**Author:** Engineering Planner (Role 1) & Implementer (Role 2)  
**Target Runtime:** Web Worker (`src/worker/simWorker.ts`, `src/core/linkBudget.ts`) & Scientific C2 Console (`index.html`)

---

### 1. Architectural Motivation & Invariants

In high-relief mountainous topography (e.g., Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$), airborne tactical nodes (ACN) face severe knife-edge diffraction and physical line-of-sight occlusion from massif barriers when communicating directly with dismounted squads and forward operating posts located in steep glacial valleys. While the passive Ridgeline Relay Advisor identifies the mathematically optimal topographic site across 360° orbital sweeps (`[MCP-OPT]`), occluded valley terminals remain in complete radio outage (`bitrateBps = 0`, `isOutage = true`) without active relay infrastructure.

This specification elevates the passive advisor into an **Active Two-Hop Decode-and-Forward (DF) Tactical Mesh Relay Engine**:
1. **Physical & Mathematical Rigor:** Employs the rigorous half-duplex Decode-and-Forward harmonic capacity identity:
   $$R_{\text{DF}, i} = \frac{R_{1, i} \cdot R_{2, \text{R}}}{R_{1, i} + R_{2, \text{R}}} \text{ [bps]}$$
   where $R_{1, i}$ is the terrestrial Hop-1 rate between terminal $i$ and the high-gain ridgeline mast, and $R_{2, \text{R}}$ is the airborne backhaul Hop-2 rate between the ridgeline mast and the ACN.
2. **Web Worker State Authority & 50 Hz Budget:** All two-hop relay routing and capacity decisions execute exclusively within the background Web Worker (`src/worker/simWorker.ts`) within the 20 ms discrete simulation step ($\Delta t = 20\text{ ms}$).
3. **Zero-Overhead Static Hop-1 Caching:** Because ground terminals and the optimal ridgeline site are geodetically stationary, Hop-1 terrain obstruction ray-marches are computed once and cached, invalidating only when the ridgeline candidate changes or a dynamic node operation occurs. Hop-1 evaluation therefore costs **0 DEM ray-marches per tick**, maintaining strict compliance with the $p50 < 6\text{ ms}$, $p95 < 12\text{ ms}$ discrete-event budget.
4. **Quadrantal Antenna Backhaul Integration:** The Hop-2 link is coupled with the body-fixed 4-sector antenna array on the ACN (`activeSectorId`), properly steering backhaul airtime into the aircraft sector facing the ridgeline mast.
5. **Full Backward Compatibility:** The active relay defaults to disabled (`activeRelayEnabled = false`), preserving bit-for-bit regression-free compatibility with all baseline verifications.

---

### 2. Mathematical Formulations

#### 2.1 Decode-and-Forward (DF) Harmonic Rate Identity
In a half-duplex Decode-and-Forward relaying system where the relay buffers and re-transmits data over shared X-band spectrum, the time-fraction allocated to Hop 1 is $t_1 = \frac{B}{R_1}$ and Hop 2 is $t_2 = \frac{B}{R_2}$ for block size $B$. The total transmission time per block is:
$$T = t_1 + t_2 = B \left(\frac{1}{R_1} + \frac{1}{R_2}\right) = B \left(\frac{R_1 + R_2}{R_1 R_2}\right)$$
The effective end-to-end harmonic capacity is therefore:
$$R_{\text{DF}} = \frac{B}{T} = \frac{R_1 \cdot R_2}{R_1 + R_2} \text{ [bps]}$$

If either hop suffers a physical outage ($R_1 = 0$ or $R_2 = 0$), the relay path is unusable:
$$R_{\text{DF}} = 0$$

#### 2.2 Two-Hop Propagation Delay & Timing Advance
The two-hop slant distance is the sum of the individual Euclidean hop ranges:
$$d_{\text{total}, i} = d_{i, \text{R}} + d_{\text{R}, \text{ACN}}$$
The authoritative two-way round-trip timing advance $\tau_{\text{TA,DF}}$ utilized for TDMA slot synchronization and guard time calculation is:
$$\tau_{\text{TA,DF}, i} = \frac{2(d_{i, \text{R}} + d_{\text{R}, \text{ACN}})}{c}$$
where $c = 299,792,458\text{ m/s}$.

#### 2.3 Bottleneck Signal-to-Noise Ratio & MODCOD Selection
Under Decode-and-Forward architecture, decoding errors occur independently on both hops. The bottleneck link quality governs link reliability:
$$\text{SNR}_{\text{DF}} = \min(\text{SNR}_{1, i}, \text{SNR}_{2, \text{R}})$$
$$\text{SINR}_{\text{DF}} = \min(\text{SINR}_{1, i}, \text{SINR}_{2, \text{R}})$$
The composite link status reports the governing MODCOD prefixed as `2HOP:<ModCod>` corresponding to the bottleneck hop.

#### 2.4 Dynamic Switching & Rescue Criterion
Terminal $i$ switches from the direct A2G link to the two-hop relay mesh if and only if:
$$\text{directLink.isOutage} \lor R_{\text{DF}, i} > R_{\text{direct}, i}$$
When rescued, the node transitions from `isOutage = true` to `isOutage = false`, `isRelayed = true`, and receives TDMA allocations through the ACN quadrant sector serving the ridgeline backhaul (`hop2Link.activeSectorId`).

---

### 3. User Interface & Live Mesh Radar Visualization

1. **Radar Canvas (`#radar-canvas`):**
   - Renders the `[MCP-OPT]` diamond ridgeline mast symbol at its geodetic coordinate.
   - Draws a cyan backhaul vector (`#06b6d4`, dashed `[6, 3]`) from `[MCP-OPT]` to the ACN.
   - For all active terminals with `is_relayed = true`, draws a dashed emerald mesh vector (`#10b981`, dashed `[4, 4]`) connecting the terminal to `[MCP-OPT]`.
2. **C2 Operator Workbench Panels:**
   - `#relay-advisor-panel` in `#tab-terrain`: Adds `#btn-toggle-active-relay` with live status readout showing active relayed node count and backhaul sector signal strength.
   - `#sci-ablation-panel` in `#tab-scheduler`: Adds Two-Hop Mesh Relay Mode selector (`#sci-relay-select`) for multi-scheduler ablation experiments.

---

### 4. Verification Contracts (`src/tests/verifyActiveTwoHopRelay.ts`)

- **ATR-T1 (Exact Harmonic Decode-and-Forward Capacity Formula):** For $R_1 = 30.0\text{ Mbps}$ and $R_2 = 60.0\text{ Mbps}$, verifies $R_{\text{DF}} = \frac{30 \times 60}{30 + 60} = 20.000\text{ Mbps}$ and two-hop timing advance $\tau_{\text{TA}} = \frac{2(d_1 + d_2)}{c}$.
- **ATR-T2 (Valley Outage Rescue via Ridgeline Relay):** Verifies that a terrain-blocked valley terminal (`directLink.isOutage = true`, `bitrateBps = 0`) with LoS to the ridge relay transitions to `isOutage = false`, `isRelayed = true`, and `bitrateMbps > 0`.
- **ATR-T3 (End-to-End Worker Packet Drop Reduction with Active Relay):** Runs `SimulationWorkerManager` under congestion and verifies that enabling `activeRelayEnabled: true` rescues occluded nodes (`relayed_node_count > 0`), reduces cumulative delay drops, and increases delivered goodput.
- **ATR-T4 (DOM & Spec Persistence Check):** Asserts `docs/specs/SPEC-ACTIVE-TWO-HOP-RIDGE-RELAY-MESH.md` exists on disk and `index.html` contains `#btn-toggle-active-relay`.
