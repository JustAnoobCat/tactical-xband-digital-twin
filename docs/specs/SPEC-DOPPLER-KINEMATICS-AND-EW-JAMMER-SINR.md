# Engineering Specification: First-Principles 8.0 GHz 3D Kinematic Doppler Shift and Contested EW X-Band Jammer Model

- **Document ID:** `SPEC-DOPPLER-KINEMATICS-AND-EW-JAMMER-SINR`
- **Revision:** 1.0.0
- **Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)
- **Role Authority:** Role 2 (Coder / Implementer per `AGENTS.md`)
- **System Target:** TypeScript Web Worker Engine (`src/`)

---

## 1. Executive Summary & Scientific Objectives

This specification defines the first-principles implementation of:
1. **8.0 GHz 3D Kinematic Doppler Shift ($f_d$) & Analytical Drift Rate ($\dot{f}_d$):**
   Continuous frequency drift tracking between dynamic Aerial Communication Nodes (ACN) and static/mobile ground nodes in high-relief mountainous topography, incorporating 3D relative velocities and centripetal/tangential flight accelerations.
2. **Contested Electronic Warfare (EW) X-Band Jammer Model:**
   High-power tactical ground/airborne jammer emitter interacting with:
   - ITU-R P.526-15 mountain ridge knife-edge diffraction and terrain shielding.
   - ITU-R F.1336 quad-sector directional horn antenna isolation and off-boresight pattern roll-off.
   - Non-linear thermal + sky noise + interference ($N + I$) linear power addition producing physically accurate Signal-to-Interference-plus-Noise Ratio (SINR).
   - Dynamic DVB-S2X MODCOD degradation and outage boundary shifting.
3. **Tactical Predictive Lookahead Jammer-Evasion Flushing (`Tac-TAD`):**
   Coupling the `PredictiveLookAheadEngine` with contested jammer ingress, enabling proactive data queue flushing before the ACN flies out from behind terrain shielding into hostile jammer line-of-sight.

---

## 2. Mathematical & Physical Formulations

### 2.1 3D Doppler Shift ($f_d$) & Analytical Doppler Rate ($\dot{f}_d$)
For an ACN positioned at $\vec{r}_{\text{acn}} = [x_a, y_a, z_a]^T \in \mathbb{R}^3$, velocity $\vec{v}_{\text{acn}} = [v_x, v_y, v_z]^T$, acceleration $\vec{a}_{\text{acn}} = [a_x, a_y, a_z]^T$, and stationary ground node $\vec{r}_i = [x_i, y_i, z_i]^T$:

1. **Line-of-Sight Unit Vector:**
   $$\vec{d}_i = \vec{r}_i - \vec{r}_{\text{acn}}$$
   $$d_{3\text{D}, i} = \max(\|\vec{d}_i\|, 1.0)$$
   $$\hat{u}_i = \frac{\vec{d}_i}{d_{3\text{D}, i}}$$

2. **Radial Closing Velocity:**
   $$v_{\text{rad}, i} = \vec{v}_{\text{acn}} \cdot \hat{u}_i \quad \text{[m/s]}$$
   *(Note: $v_{\text{rad}, i} > 0$ when ACN approaches node $i$, representing closing speed).*

3. **Doppler Frequency Shift ($f_{d, i}$):**
   $$f_{d, i} = \frac{f_c}{c} v_{\text{rad}, i} \quad \text{[Hz]}$$
   where $f_c = 8.0 \times 10^9\text{ Hz}$ and $c = 299\,792\,458\text{ m/s}$.

4. **Analytical Doppler Drift Rate ($\dot{f}_{d, i}$):**
   $$\dot{f}_{d, i} = \frac{f_c}{c} \left( \vec{a}_{\text{acn}} \cdot \hat{u}_i - \frac{\|\vec{v}_{\text{acn}}\|^2 - v_{\text{rad}, i}^2}{d_{3\text{D}, i}} \right) \quad \text{[Hz/s]}$$

---

### 2.2 Contested EW X-Band Jammer Model & Terrain Shielding
Let the ground jammer be positioned at $\vec{r}_J = [x_J, y_J, z_{\text{DEM}}(x_J, y_J) + 3.0\text{ m}]^T$ with EIRP $\text{EIRP}_J\text{ [dBm]}$ (e.g., $65.0\text{ dBm} = 316.2\text{ W}$).

1. **Propagation Loss to ACN ($L_{J \to \text{acn}}$):**
   Using ITU-R P.526-15 multi-obstacle diffraction and ITU-R P.676 / P.838:
   $$L_{J \to \text{acn}}\text{ [dB]} = \text{FSPL}(d_J, f_c) + L_{\text{diff}, J} + A_{\text{gas}, J} + A_{\text{rain}, J} + L_{\text{cable}}$$
   When terrain blocks the direct line-of-sight between Jammer and ACN, $L_{\text{diff}, J} > 25\text{ dB}$, providing natural Himalayan terrain shielding.

2. **Directional Sector Reception Isolation ($G_{\text{acn}, k}(\theta_J)$):**
   For each sector $k \in \{0, 1, 2, 3\}$, antenna off-boresight angle $\Delta \theta_{J, k}$ determines receiver gain:
   $$G_{\text{acn}, k}(\theta_J) = G_{\text{peak}} - A_{\text{sector}}(\Delta \theta_{J, k}, \phi_{J})$$
   Sidelobe attenuation reaches $25.0\text{ dB}$ on backlobes (e.g., Sector $S_3$ vs. Sector $S_1$).

3. **Received Jammer Interference Power ($I_{J \to k}$):**
   $$I_{J \to k}\text{ [dBm]} = \text{EIRP}_J + G_{\text{acn}, k}(\theta_J) - L_{J \to \text{acn}}$$

4. **Linear Power Summation & SINR Calculation:**
   Given effective thermal + sky noise power $P_{\text{noise}}\text{ [dBm]}$:
   $$P_{N+I, k}\text{ [mW]} = 10^{P_{\text{noise}} / 10} + 10^{I_{J \to k} / 10}$$
   $$P_{N+I, k}\text{ [dBm]} = 10 \log_{10}(P_{N+I, k}\text{ [mW]})$$
   $$\text{SINR}_k\text{ [dB]} = P_{\text{rx}}\text{ [dBm]} - P_{N+I, k}\text{ [dBm]}$$
   The resulting $\text{SINR}_k$ is mapped directly into the DVB-S2X MODCOD table for adaptive rate determination.

---

### 2.3 Predictive Lookahead Jammer-Evasion Flushing
In `PredictiveLookAheadEngine.evaluatePredictiveState()`:
When `jammerEnabled === true`, future link evaluations incorporate predicted jammer interference $I_{J \to k}(t + \tau)$.
If an ACN is currently in terrain shielding ($L_{\text{diff}, J} > 35\text{ dB}$) but trajectory projection reveals line-of-sight jammer exposure ($L_{\text{diff}, J} \to 0\text{ dB}$) causing outage within the lookahead horizon, `imminentOcclusion` is flagged and `Tac-TAD` schedules an emergency high-priority queue drain before jammer ingress collapses link capacity.

---

## 3. Implementation Seams

1. `src/core/linkBudget.ts`:
   - `computeDopplerKinematics(...)`
   - `LinkStatus` extension: `radialVelocityMs`, `dopplerShiftHz`, `dopplerRateHzS`, `jammerInterferenceDbm`, `sinrDb`.
   - `evaluateLink(...)` updated with noise + interference summation.
2. `src/core/config.ts`:
   - `EnvironmentConfig`: `jammerEnabled`, `jammerEirpDbm`, `jammerPosEnu`.
3. `src/core/trajectory.ts`:
   - `PredictiveLookAheadEngine`: jammer-aware link evaluation for future time steps.
4. `src/worker/simWorker.ts`:
   - 50 Hz discrete-event loop Doppler kinematics evaluation for all ground nodes.
   - Jammer terrain obstruction and 4-sector interference calculation.
   - Zero-allocation buffers, state serialization, and command handling.
5. `src/shared/workerProtocol.ts` & `src/worker/telemetrySerializer.ts`:
   - Updated IPC interfaces for jammer parameters and serialized node telemetry.
6. `index.html` & UI:
   - Scientific controls for EW Jammer mode in `#tab-scheduler`.
   - Status badge showing terrain shielding and worst-sector interference.
   - Doppler readout in link budget waterfall.
   - Crimson emitter indicator on `#radar-canvas`.

---

## 4. Verification Suite & Gates

- **DEW-T1:** 8.0 GHz 3D Doppler Shift & Sign Symmetry ($v_{\text{rad}} = +59.9585\text{ m/s} \to f_d = +1600.0\text{ Hz}$).
- **DEW-T2:** 4-Sector Directional Jammer Sidelobe Isolation ($25.0\text{ dB}$ front-to-back isolation).
- **DEW-T3:** Himalayan Terrain Shielding Against Jamming ($> 25\text{ dB}$ SINR improvement behind mountain).
- **DEW-T4:** Predictive Jammer Evasion in `Tac-TAD` (lookahead flags imminent outage and initiates pre-burst flush).
