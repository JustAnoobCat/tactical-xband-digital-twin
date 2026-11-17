# SPEC-AI-PHYSICS-TRUTH-AND-CLOSED-LOOP-EXECUTION: Ground Truth Coupling & Authoritative Closed-Loop Edge-AI

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity per AGENTS.md)  
**Target Runtimes:** `src/core/tacticalAiPathfinder.ts`, `src/worker/simWorker.ts`, `src/shared/workerProtocol.ts`, `src/worker/telemetrySerializer.ts`, `index.html`, `src/tests/verifyAiPhysicsTruthAndClosedLoop.ts`, `scripts/run_all_verifications.mjs`, `package.json`, `README.md`  

---

## 1. Executive Summary & Problem Formulation

The Tactical Edge-AI Co-Pilot provides tactical soldiers and C2 operators with real-time Link-Recovery pathfinding, Buddy-Relay mesh networking, EW defilade terrain shielding, Sky-Shepherd UAV orbit shifting, LPI/LPD stealth RF throttling, and 15-second predictive blackout warnings.

However, to ensure scientific rigor and tactical fidelity in the Ladakh digital twin, the AI copilot must never operate as a detached "display-only" overlay. Every prediction, recommendation, and operational mode must be **100% physically coupled to the authoritative 50 Hz Web Worker simulation runtime (`src/worker/simWorker.ts`) and physical engines (`LinkBudgetEngine`, `ObstacleManager`, `ACNTrajectory`)**:

1. **Exact Link Budget Parity:** Candidate site SINR predictions must match the authoritative `LinkBudgetEngine.evaluateLink()` calculation within $\le 1.5\text{ dB}$, utilizing identical transmitter power, node-type gains, ITU-R F.1336 antenna roll-off, cable losses, implementation margins, and receiver thermal + sky noise floors.
2. **3D Obstacle Sky-Ray Blocking:** In addition to 2D footprint ground avoidance, candidate sites must march the 3D line-of-sight *sky ray* from candidate ground level $(x_c, y_c, z_c + 2\text{ m})$ to the airborne relay $\vec{r}_{\text{ACN}}$, detecting volumetric intersections with 3D barrier walls, blocks, and peaks so that the AI never routes a soldier into the RF shadow of a structure.
3. **Future-Orbit Arrival & Multi-Phase Persistence Scoring:** Recommendations must be scored not only against instantaneous UAV position $\vec{r}_{\text{ACN}}(t_0)$, but also against the projected UAV arrival position $\vec{r}_{\text{ACN}}(t_0 + \min(\Delta t_{\text{walk}}, 8.0\text{ s}))$, ensuring persistent link closure rather than fleeting flashes of connectivity.
4. **Closed-Loop Pillar 1 (Buddy-Relay Packet Delivery in Worker):** When `aiBuddyMeshEnabled` is true, shadowed nodes rescued by a squadmate must have an active Buddy-Relay `LinkStatus` assigned in `simWorker.ts`, enabling the TDMA scheduler to physically transmit and acknowledge packets via the decode-and-forward peer.
5. **Closed-Loop Pillar 3 (Sky-Shepherd Physical UAV Repositioning):** When `aiSkyShepherdActive` is triggered for a pinned soldier, the UAV's physical trajectory position $\vec{r}_{\text{ACN}}$ in `simWorker.ts` must slew smoothly ($80\text{ m/s}$ horiz, $25\text{ m/s}$ vert) by the computed loiter offset $(\Delta X, \Delta Y, \Delta Z)$, physically peering into the canyon and restoring link closure across the entire digital twin.
6. **Closed-Loop Pillar 4 (LPI/LPD Stealth Transmit Power Control):** When `aiLpiStealthEnabled` is true, the node's throttled transmit power $P_{\text{LPI,dBm}}$ must be passed directly into `linkEngine.evaluateLink()`, physically lowering RF transmit power and signature in the link budget waterfall while holding target MODCOD lock.

---

## 2. Mathematical Formulations & Physical Models

### 2.1 Authoritative Link Budget Parity
Candidate site SINR evaluation in `src/core/tacticalAiPathfinder.ts` must use the exact parameters of the authoritative `LinkBudgetEngine`:
- **Node TX Power & Antenna Gain:**
  - Dismounted Soldier: $P_{\text{tx}} = 30.0\text{ dBm}$ ($1.0\text{ W}$), $G_{\text{tx}} = 0.0\text{ dBi}$ omni-directional.
  - Wheeled MCP: $P_{\text{tx}} = 40.0\text{ dBm}$ ($10.0\text{ W}$), $G_{\text{tx}} = 6.0\text{ dBi}$ directional mast.
- **ACN Receive Gain & Pattern:**
  - Peak boresight gain: $G_{\text{ACN,peak}} = 18.0\text{ dBi}$.
  - Sector array off-boresight azimuth & elevation roll-off per ITU-R F.1336 / 3GPP TR 38.811.
- **Losses & Margins:**
  - Hardware cable loss: $L_{\text{cable}} = 2.0\text{ dB}$.
  - Implementation & polarization margin: $M_{\text{impl}} = 2.5\text{ dB}$.
  - Curved-Earth Free Space Path Loss:
    $$\text{FSPL} = 20 \log_{10}(d) + 20 \log_{10}(f_0) - 147.552$$
  - Elevation-scaled ITU-R P.676 gaseous absorption $L_{\text{gas}}$.
  - ITU-R P.526 curved-Earth knife-edge diffraction loss $L_{\text{diff}}$.
- **Receiver Noise Floor:**
  $$P_{\text{noise}} = -174.0 + 10 \log_{10}(B) + \text{NF} + \Delta N_{\text{sky}} \approx -95.98\text{ dBm}$$
  (for $B = 50.0\text{ MHz}$, $\text{NF} = 4.0\text{ dB}$, $\Delta N_{\text{sky}} \approx 1.0\text{ dB}$).
- **Active EW Jammer Interference:**
  When `jammerEnabled && jammerPosEnu`:
  $$I_{\text{JAM}} = P_{\text{tx,JAM}} + G_{\text{JAM}} + G_{\text{rx,side}} - \text{FSPL}_{\text{JAM}} - L_{\text{diff,JAM}}$$
  $$\text{SINR} = \frac{P_{\text{rx}}}{P_{\text{noise}} + I_{\text{JAM}}}$$

### 2.2 3D Obstacle Sky-Ray Intersection
For a candidate site $\vec{r}_c = (x_c, y_c, z_c + 2.0)$ and UAV position $\vec{r}_{\text{ACN}}$, the sky-ray line segment is parameterized as:
$$\vec{r}(t) = \vec{r}_c + t (\vec{r}_{\text{ACN}} - \vec{r}_c), \quad t \in [0, 1]$$
For each 3D obstacle (cylinder with radius $R$, height $H$, or box with bounds $[X_{\min}, X_{\max}] \times [Y_{\min}, Y_{\max}]$ and top elevation $Z_{\text{top}}$):
1. Compute ray parameter $t$ where $(x(t), y(t))$ intersects the 2D polygon/circle of the obstacle.
2. If $z(t) \le Z_{\text{top}}$, the sky ray is blocked by the 3D barrier.
3. Blocked candidates incur $35\text{–}45\text{ dB}$ obstacle diffraction loss and are flagged as obstructed (`candIsLoS = false`).

### 2.3 Closed-Loop Slew Dynamics for Sky-Shepherd (Pillar 3)
When Sky-Shepherd is active for pinned node $k$:
1. Optimal loiter shift $\Delta \vec{r}^* = (\Delta X^*, \Delta Y^*, \Delta Z^*)$ is computed by `computeAiSkyShepherdUavOffset`.
2. On each 50 Hz discrete simulation step ($\Delta t = 0.020\text{ s}$):
   $$\vec{d}_{\text{horiz}} = (\Delta X^* - \text{offset}_X, \Delta Y^* - \text{offset}_Y)$$
   $$\text{offset}_{X,Y}(t + \Delta t) = \text{offset}_{X,Y}(t) + \min(v_{\text{horiz,max}} \Delta t, \|\vec{d}_{\text{horiz}}\|) \cdot \hat{d}_{\text{horiz}}$$
   $$\text{offset}_Z(t + \Delta t) = \text{offset}_Z(t) + \text{clamp}(\Delta Z^* - \text{offset}_Z, -v_{\text{vert,max}} \Delta t, +v_{\text{vert,max}} \Delta t)$$
   where $v_{\text{horiz,max}} = 80.0\text{ m/s}$ and $v_{\text{vert,max}} = 25.0\text{ m/s}$.
3. Authoritative UAV position used across all physics and links:
   $$\vec{r}_{\text{ACN,effective}}(t) = \vec{r}_{\text{ACN,nominal}}(t) + \vec{\text{offset}}_{\text{shepherd}}(t)$$

---

## 3. Strict Invariants

1. **Default Startup Invariance:** All active closed-loop intervention flags (`aiBuddyMeshEnabled`, `aiLpiStealthEnabled`, `aiSkyShepherdActive`, `aiAutoHealEnabled`) default to `false` at worker initialization, ensuring exact reproducibility and compatibility with all 83 existing test suites.
2. **50 Hz Loop Budget:** All closed-loop calculations must run in $< 0.5\text{ ms}$ per 20 ms worker step ($p50 < 6.5\text{ ms}$).
3. **Zero Theme Modification:** `frontend/c2-console-theme.css` must remain 100% untouched.

---

## 4. Verification Suite Requirements (APT-T1–T4)

- **APT-T1 (Predicted SINR Truth vs. Authoritative `LinkBudgetEngine`):** Verify candidate site predicted SINR matches `LinkBudgetEngine.evaluateLink()` within $\le 2.0\text{ dB}$.
- **APT-T2 (3D Barrier Sky-Ray Blocking Awareness):** Verify tall 3D obstacle blocking the candidate-to-ACN ray is identified, preventing false LoS assertions.
- **APT-T3 (Closed-Loop Buddy-Relay Packet Delivery in Worker):** Verify enabling `buddyMeshEnabled: true` in `SimulationWorkerManager` delivers real goodput bits through the scheduler for occluded nodes near healthy squadmates.
- **APT-T4 (Closed-Loop Sky-Shepherd Physical Movement & LPI Power Throttling in Worker):**
  1. Verify triggering `TRIGGER_AI_SKY_SHEPHERD` physically slews `acnPos` toward the canyon loiter offset over 30 simulation steps.
  2. Verify enabling `lpiStealthEnabled: true` throttles `p_tx_dbm` below $30.0\text{ dBm}$ on healthy LoS nodes while holding MODCOD lock.
