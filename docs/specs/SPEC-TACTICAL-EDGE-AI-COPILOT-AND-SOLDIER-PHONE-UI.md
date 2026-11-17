# SPEC-TACTICAL-EDGE-AI-COPILOT-AND-SOLDIER-PHONE-UI: 5 Local Edge-AI Capabilities & ATAK Tactical Soldier Phone UI

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity per AGENTS.md)  
**Target Runtimes:** `src/core/tacticalAiPathfinder.ts`, `src/shared/workerProtocol.ts`, `src/worker/simWorker.ts`, `src/worker/telemetrySerializer.ts`, `index.html`, `src/tests/verifyEdgeAiCopilotAndSoldierPhone.ts`, `scripts/run_all_verifications.mjs`, `package.json`, `README.md`  

---

## 1. Executive Summary & Operational Context

In contested high-relief mountainous topography such as the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$), tactical ground nodes (dismounted soldier patrols and mobile command posts) encounter multi-spectral hazards: deep terrain shadow behind razorback ridgelines, active adversary electronic warfare (EW) jammers, and strict Low Probability of Intercept / Low Probability of Detection (LPI/LPD) operational constraints. 

While macroscopic C2 operators monitor aggregate network status from high-altitude command centers, dismounted tactical soldiers in the field carry ruggedized Android Tactical Assault Kit (ATAK) End-User Devices (EUD). These handheld terminals require immediate, first-person tactical awareness, turn-by-turn guidance, and autonomous peer-assisted mesh connectivity when airborne relays are occluded.

This specification realizes a complete **5-Pillar Local Edge-AI Co-Pilot** and an **ATAK Soldier Handheld Device Workspace** (`#tab-soldier`):
1. **Pillar 1 — AI Buddy-Relay Peer-to-Peer Squad Mesh:** When a soldier's direct uplink to the ACN is occluded or severed, the Edge-AI copilot evaluates terrestrial peer links ($d \le 4.5\text{ km}$, $2\text{ m}$ mast) to squadmates possessing healthy ACN uplinks, computing the exact Decode-and-Forward (DF) harmonic throughput capacity $R_{\text{buddy}} = \frac{R_{i \to j} R_{j \to \text{ACN}}}{R_{i \to j} + R_{j \to \text{ACN}}}$.
2. **Pillar 2 — AI EW Defilade Terrain-Shield Finder:** When adversary jamming is active (`jammerEnabled`), candidate micro-terrain sites are evaluated for mountain diffraction shielding ($L_{\text{diff,JAM}}\text{ [dB]}$) against `[EW-JAM]` while maintaining upward LoS to the airborne relay, applying a defilade bonus to select protected survival sites.
3. **Pillar 3 — AI Sky-Shepherd UAV Orbit Shift for Pinned Units:** When a soldier is pinned down under hostile fire (`TRIGGER_AI_SKY_SHEPHERD`), the AI evaluates candidate loiter-center and altitude offsets $(\Delta X, \Delta Y, \Delta Z)$ for the airborne relay to peer directly into the pinned soldier's canyon.
4. **Pillar 4 — AI LPI/LPD Stealth Transmit Power Controller:** Dynamically throttles ground radio transmit power $P_{\text{LPI,dBm}} \in [6.0\text{ dBm}, P_{\text{nom}}]$ to provide the minimum required RF output to sustain target MODCOD closure (+2.5 dB fade margin), dramatically reducing electromagnetic signature (up to $>90\%$ RF milliwatt power reduction).
5. **Pillar 5 — AI 15-Second Blackout Countdown Forecaster:** Pre-evaluates the ACN trajectory at $\Delta t \in \{3, 6, 9, 12, 15\}\text{ s}$ to warn soldiers in advance of upcoming ridgeline occlusion before voice/video links drop.
6. **Soldier Handheld Device (ATAK Phone) Workspace (`#tab-soldier`):** A ruggedized smartphone viewport featuring a real-time turn-by-turn compass canvas (`#soldier-phone-canvas`), AI push notification banner, status bar, and direct tactical comms controls.

---

## 2. Mathematical Formulations & Physical Models

### 2.1 Pillar 1: Harmonic Decode-and-Forward Buddy-Relay Capacity
For a shadowed or degraded soldier node $i$ located at $\vec{r}_i$ and candidate squadmate $j \neq i$ at $\vec{r}_j$ ($50\text{ m} \le \|\vec{r}_i - \vec{r}_j\|_{\text{horiz}} \le 4500\text{ m}$):
1. **Direct Peer Link ($i \to j$):**
   - Carrier frequency: $f_0 = 8.0\text{ GHz}$ ($\lambda = 0.0375\text{ m}$)
   - Terrestrial mast height: $2.0\text{ m}$ AGL
   - Slant distance: $d_{i,j} = \|\vec{r}_i - \vec{r}_j\|_2$
   - 10-step curved-Earth DEM ray-march with $4/3$ effective Earth radius:
     $$z_{\text{eff}}(s) = z_{\text{DEM}}(s) + \frac{s(d - s)}{2 R_{\text{eff}}}$$
   - Knife-edge diffraction parameter $\nu$ and ITU-R P.526 loss $L_{\text{diff}, i \to j}$.
   - Free Space Path Loss:
     $$\text{FSPL}_{i \to j} = 20 \log_{10}(d_{i,j}) + 20 \log_{10}(f_0) - 147.552$$
   - Received power:
     $$P_{\text{rx}, i \to j} = P_{\text{tx}, i} + G_{\text{tx}} + G_{\text{rx}} - \text{FSPL}_{i \to j} - L_{\text{diff}, i \to j} - L_{\text{gas}}$$
   - $\text{SINR}_{i \to j} = P_{\text{rx}, i \to j} - N_0$. Modcod rate: $R_{i \to j} = \text{modcod}(\text{SINR}_{i \to j})$.
2. **Harmonic Decode-and-Forward Rate:**
   When squadmate $j$ has a healthy direct uplink ($R_{j \to \text{ACN}} \ge 8.0\text{ Mbps}$, `!isOutage`):
   $$R_{\text{buddy}, i \to j} = \frac{R_{i \to j} \cdot R_{j \to \text{ACN}}}{R_{i \to j} + R_{j \to \text{ACN}}}$$
3. **Rescue Criterion:**
   Buddy rescue is selected if $\max_j R_{\text{buddy}, i \to j} > R_{\text{direct}, i}$.

### 2.2 Pillar 2: Micro-Terrain EW Defilade Mountain Shielding
When `jammerEnabled` is true with jammer at $\vec{r}_{\text{JAM}}$:
1. At candidate site $\vec{r}_c = (x_c, y_c, z_c + 2\text{ m})$, an 8-step DEM ray-march to $\vec{r}_{\text{JAM}}$ evaluates knife-edge terrain intrusion:
   $$h_{\text{intrude}} = z_{\text{DEM}}(s) - z_{\text{LoS}}(s)$$
   $$\nu_{\text{JAM}} = h_{\text{intrude}} \cdot \sqrt{\frac{2}{\lambda} \left(\frac{1}{d_1} + \frac{1}{d_2}\right)}$$
   $$L_{\text{diff,JAM}} = \begin{cases} 0 & \nu_{\text{JAM}} \le -0.7 \\ \min(50, \max(0, 6.9 + 20 \log_{10}(\sqrt{(\nu - 0.1)^2 + 1} + (\nu - 0.1)))) & \nu_{\text{JAM}} > -0.7 \end{cases}$$
2. Sites with $L_{\text{diff,JAM}} \ge 10.0\text{ dB}$ provide mountain barrier shadow against enemy jamming.
3. **Multi-Objective Utility with Defilade Bonus:**
   $$U(\vec{r}_c) = 2.5 \cdot \gamma_{\text{ACN}} + 35.0 \cdot \mathbb{I}_{\text{LoS}} + 0.5 \cdot Q[n, s] - 0.08 \cdot t_{\text{walk}} + 1.8 \cdot L_{\text{diff,JAM}} \cdot \mathbb{I}_{\text{LoS}}$$

### 2.3 Pillar 3: AI Sky-Shepherd UAV Orbit Shift for Pinned Units
When a ground node is pinned under fire ($\vec{v} = 0$, mobility impossible):
1. Evaluates 9 candidate loiter-center displacements $\Delta X, \Delta Y \in \{-1200, 0, +1200\}\text{ m}$ toward $\vec{r}_{\text{pinned}}$ and altitude adjustment $\Delta Z = +350\text{ m}$.
2. Verifies safe terrain clearance: $\text{AGL} = Z_{\text{UAV}} - z_{\text{DEM}}(X, Y) \ge 400.0\text{ m}$.
3. Marches ray from $(X_{\text{cand}}, Y_{\text{cand}}, Z_{\text{cand}})$ to $\vec{r}_{\text{pinned}}$ to find the offset that maximizes $\text{SINR}_{\text{pinned}}$.

### 2.4 Pillar 4: AI LPI/LPD Stealth Transmit Power Controller
1. Nominal transmit power: $P_{\text{nom}} = 30.0\text{ dBm}$ (Soldier), $40.0\text{ dBm}$ (MCP).
2. Target closure threshold: $\gamma_{\text{target}} = 18.5\text{ dB}$ (64-APSK $16.0\text{ dB}$ threshold $+ 2.5\text{ dB}$ fade margin).
3. If link is in outage ($\gamma < -2.85\text{ dB}$) or marginal ($\gamma \le \gamma_{\text{target}}$):
   $$P_{\text{LPI}} = P_{\text{nom}}, \quad \Delta P_{\text{reduction}} = 0\text{ dB}, \quad \text{RF Reduction} = 0\%$$
4. If link has excess margin $\Delta M = \gamma - \gamma_{\text{target}} > 0$:
   $$P_{\text{LPI}} = \max\big(6.0\text{ dBm}, \min(P_{\text{nom}}, P_{\text{nom}} - \Delta M)\big)$$
   $$\Delta P_{\text{reduction}} = P_{\text{nom}} - P_{\text{LPI}}\text{ [dB]}$$
   $$\text{RF Sig Reduction Pct} = \left(1.0 - 10^{-\frac{\Delta P_{\text{reduction}}}{10}}\right) \times 100\%$$

### 2.5 Pillar 5: AI 15-Second Blackout Countdown Forecaster
1. Evaluates ACN position at lookahead times $\Delta t \in \{3, 6, 9, 12, 15\}\text{ s}$.
2. Ray-marches 10-step DEM clearance for each future step.
3. If node is currently connected (`!isOutage`) and enters outage at $\Delta t_{\text{blackout}}$:
   - `blackoutImminent = true`
   - `blackoutInSeconds = Δt_blackout`
   - `estimatedDurationS = N_outage_steps * 3.0`

---

## 3. ATAK Tactical Soldier EUD Phone Workspace (`#tab-soldier`)

The workspace provides an intuitive two-column layout:
- **Left Column: Ruggedized Smartphone EUD Frame (`#soldier-eud-phone-frame`)**
  - **Terminal Selector Dropdown (`#eud-node-select`):** Synced with `selectedNodeId`.
  - **Phone Status Bar (`#eud-status-bar`):** Network carrier `DRDO-XBAND-NTN`, route badge (`DIRECT UAV` / `BUDDY S{j}` / `2-HOP RELAY`), RF TX power readout, GPS coordinates and MSL elevation.
  - **AI Push Notification Banner (`#eud-ai-notification-banner`):** Tactical advisory card displaying action directives (`WALK DIRECTIVE`, `BUDDY-MESH ACTIVE`, `EW DEFILADE SHIELD`, `BLACKOUT IN X.Xs`, `SKY-SHEPHERD OVERHEAD`, or `POSITION OPTIMAL`).
  - **Turn-by-Turn Compass Canvas (`#soldier-phone-canvas`, 260x260 CSS px):** High-DPI rotating compass dial rendering current heading, target waypoint beacon `[★ AI-SAFE]`, Turn-by-Turn arrow with distance and bearing, slope readout, squadmate positions, and `[EW-JAM]` threat angle.
  - **Phone Touch Action Bar:** `#btn-eud-walk-ai` (Follow AI Walk Path), `#btn-eud-pin-shepherd` (Call UAV Sky-Shepherd), and Comms triggers (`SOS`, `Voice`, `Video`, `Photo`).
- **Right Column: 5-Pillar Edge-AI Co-Pilot Command Matrix (`#ai-copilot-matrix-panel`)**
  - Global toggles: `#btn-ai-buddy-mesh-toggle`, `#btn-ai-lpi-stealth-toggle`, `#btn-ai-auto-heal-toggle`.
  - Live metric cards for each of the 5 pillars.

---

## 4. Verification Suite Specification (`src/tests/verifyEdgeAiCopilotAndSoldierPhone.ts`)

- **ECP-T1:** Pillar 1 — AI Buddy-Relay Squad Mesh Rescue with harmonic DF rate.
- **ECP-T2:** Pillar 2 & 3 — EW Defilade Terrain Shielding ($L_{\text{diff,JAM}} > 10\text{ dB}$) and Sky-Shepherd UAV Loiter Offset.
- **ECP-T3:** Pillar 4 & 5 — AI LPI/LPD Transmit Power Reduction ($>90\%$ RF sig reduction) and 15-Second Blackout Countdown.
- **ECP-T4:** ATAK Soldier Phone UI, Spec Persistence, and Layout Invariants.
