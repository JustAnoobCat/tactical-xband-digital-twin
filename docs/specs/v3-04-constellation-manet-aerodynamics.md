# Specification V3-04: Multi-ACN Constellation & Handover, Multi-Hop MANET Routing (Half-Duplex Penalty), Ground Convoy Mobility & Wind-Coupled High-Altitude Aerodynamics

**Document ID:** `SPEC-V3-04-CONSTELLATION-MANET-AERODYNAMICS`  
**Status:** Approved / Authoritative  
**Domain:** Airborne Tactical Network Simulation Engine (TypeScript / Vite 50 Hz Web Worker)  
**Sector:** Ladakh Regional Theater ($34.5^\circ\text{N}, 76.5^\circ\text{E}$, MSL 3,500 m – 7,200 m)  
**Parent Framework:** Tactical X-Band Air-to-Ground Digital Twin Architectural Framework  

---

## 1. Executive Architectural Overview

Specification V3-04 extends the digital twin simulation engine from a single airborne communication node (ACN-1) to an autonomous multi-ACN airborne constellation with seamless 3GPP-aligned Event A3 handover, air-to-air (A2A) cross-link backhaul, multi-hop Dijkstra MANET routing for terrain-isolated ground forces under half-duplex medium contention, continuous ground convoy/patrol kinematic mobility, and wind-coupled International Standard Atmosphere (ISA) high-altitude flight mechanics with automatic Controlled Flight Into Terrain (CFIT) pull-up safety.

```
                              [ ACN-1 (Primary) ]
                                 ▲             ▲
                                 │ A2A X-Link  │ Event A3
                                 │ (8 GHz)     │ Handover
                                 ▼             ▼
  [ High-Altitude Wind ] ──► [ ACN-2 (Phased Orbit) ]
  (ISA Density ρ(h), Crab)       ▲
                                 │ Direct LoS
                                 │
                         [ Node 1 Gateway ]
                                 ▲
                                 │ In-Band Half-Duplex Peer Hop 1
                                 ▼
                         [ Node 3 Relay ]
                                 ▲
                                 │ In-Band Half-Duplex Peer Hop 2
                                 ▼
                      [ Node 4 Isolated Convoy ]
                        (12 m/s Ground Mobility)
```

### Authoritative Architecture Invariants
1. **Worker State Authority:** Live constellation positions, handover state machines, MANET routing graphs, ground convoy progress, and UAV endurance are owned strictly by `SimulationWorkerManager` in `src/worker/simWorker.ts` and reset deterministically on `RESET_SIM`.
2. **Stateless Core Engine:** All evaluation logic in `src/core/constellationAndMobilityEngine.ts` is 100% pure, deterministic, free of `Math.random()`, free of mutable module-level state, and executes in $< 5\,\mu\text{s}/\text{call}$.
3. **Strict Backward Compatibility:** Default configuration (`acnConstellationCount: 1`, `enableMultiHopManet: false`, `enableGroundConvoyMobility: false`, `windSpeedMs: 0.0`, `enableAutoCfitPullUp: false`) preserves exact bit-for-bit equivalence across all 105 prior verification suites.
4. **Worker Line Count Discipline:** `src/worker/simWorker.ts` must strictly remain $< 3,300$ lines (enforced by Suite 93) by encapsulating orchestration routines in `constellationAndMobilityEngine.ts`.

---

## 2. Mathematical & Physical Formulations

### 2.1 Multi-ACN Constellation Geometry & Phased Orbital Offsets
For a constellation of $N \in \{1, 2, 3, 4\}$ ACNs, the primary aircraft ($k = 0$, `ACN-1`) tracks the authoritative flight trajectory $\mathbf{p}_0(t) = [x_0(t), y_0(t), z_0(t)]^T$.
Secondary aircraft ($k \in \{1, \dots, N-1\}$, labeled `ACN-2`, `ACN-3`, `ACN-4`) maintain a coordinated phased orbit around the operational theater:
$$\theta_k(t) = \theta_0 + \frac{2\pi k}{N} + \omega_{\text{const}} t$$
$$\mathbf{p}_k(t) = \begin{bmatrix} x_0(t) + R_{\text{form}} \cos\theta_k(t) \\ y_0(t) + R_{\text{form}} \sin\theta_k(t) \\ z_0(t) + k \cdot \Delta z_{\text{sep}} \end{bmatrix}$$
where:
- $R_{\text{form}} = 18\,000\text{ m}$ (tactical formation standoff radius).
- $\omega_{\text{const}} = \frac{2\pi}{T_{\text{orbit}}}$, with $T_{\text{orbit}} = 720\text{ s}$ ($12\text{ min}$ loiter period).
- $\Delta z_{\text{sep}} = 150\text{ m}$ (standard ICAO vertical separation minimum for formation deconfliction).

### 2.2 Air-to-Air (A2A) Cross-Link Backhaul & Radio Horizon
Cross-link communication between secondary ACN $k$ and primary gateway `ACN-1` operates over directional X-Band ($f = 8\text{ GHz}$).
1. **Slant Range:**
   $$d_{A2A} = \|\mathbf{p}_k - \mathbf{p}_0\|$$
2. **Smooth-Earth Radio Horizon Clearance:**
   Using the standard 4/3 effective Earth radius model ($a_e = \frac{4}{3} R_E \approx 8.4947 \times 10^6\text{ m}$):
   $$d_{\text{horizon}} = \sqrt{2 a_e h_k} + \sqrt{2 a_e h_0}$$
   If $d_{A2A} > d_{\text{horizon}}$, the cross-link is occluded by Earth curvature.
3. **Cross-Link Received Power & Capacity:**
   $$\text{FSPL}_{A2A}(d, f) = 20\log_{10}(d) + 20\log_{10}(f) - 147.55$$
   $$P_{\text{rx},A2A} = P_{\text{tx},A2A} + G_{\text{tx},A2A} + G_{\text{rx},A2A} - \text{FSPL}_{A2A}$$
   $$\text{SNR}_{A2A} = P_{\text{rx},A2A} - N_0 - 10\log_{10}(B_{A2A}) - NF$$
   $$C_{A2A} = \min\left(C_{\max,A2A}, B_{A2A} \cdot \log_2\left(1 + 10^{\text{SNR}_{A2A}/10}\right)\right)$$
   where $P_{\text{tx}} = 33\text{ dBm}$ (2 W), $G_{\text{tx}} = G_{\text{rx}} = 15\text{ dBi}$ (horn/patch array), $B_{A2A} = 50\text{ MHz}$, $C_{\max,A2A} = 150\text{ Mbps}$.

### 2.3 3GPP Event A3 Make-Before-Break Handover State Machine
Ground node $i$ maintains an active serving ACN association $s_i \in \{1, \dots, N\}$.
Handover candidate evaluation follows 3GPP TS 36.331 Event A3 criteria with load balancing:
$$\text{Condition: } \gamma_{\text{cand},i} - \Delta L_{\text{cand}} > \gamma_{\text{serv},i} - \Delta L_{\text{serv}} + \text{Hys}_{\text{A3}}$$
where:
- $\gamma_k$ is the received link SNR (dB) from ACN $k$.
- $\text{Hys}_{\text{A3}} = 2.0\text{ dB}$ (hysteresis margin preventing ping-pong flapping).
- $\Delta L = \max(0, (\text{Load} - 0.85) \times 10.0)\text{ dB}$ (load-shedding penalty when an ACN exceeds 85% capacity).
- **Time-to-Trigger (TTT):** The candidate must strictly satisfy the Event A3 condition for $N_{\text{TTT}} = 5$ consecutive simulation frames ($100\text{ ms}$ at 50 Hz). If the candidate drops below the threshold before $N_{\text{TTT}}$ ticks, the trigger counter resets to 0.
- **Emergency Outage Fallback:** If the serving link enters deep outage ($\gamma_{\text{serv},i} < -1.5\text{ dB}$) while a valid candidate provides $\gamma_{\text{cand},i} \ge 0.0\text{ dB}$, an immediate zero-frame fallback handover executes to avert dropped connectivity.

### 2.4 Multi-Hop Dijkstra MANET Routing & Half-Duplex Penalty
When a ground terminal $u$ experiences severe terrain shadowing from all available ACNs, it discovers ad-hoc peer links to neighboring ground terminals.
1. **Ad-Hoc Peer Links:** Link exist between nodes $u, v$ if $\|\mathbf{p}_u - \mathbf{p}_v\| \le R_{\text{peer},\max}$ (`15,000 m`) with line-of-sight elevation clearance.
2. **Routing Graph:** Weighted directed graph $G = (V, E)$ where edge cost $w(u, v)$ balances link capacity and hop overhead:
   $$w(u, v) = \frac{1}{\max(0.1, R_{uv})} + 0.05$$
3. **Gateway Nodes:** Nodes with direct healthy ACN connectivity ($\text{SNR} \ge 3.0\text{ dB}$).
4. **Dijkstra Shortest Path:** Finds the optimal route $P = (v_0, v_1, \dots, v_H)$ from source $v_0$ to gateway $v_H$ subject to $H \le 3$.
5. **In-Band Half-Duplex Throughput Bottleneck:**
   Because relays transmit and receive on the same RF channel/band, medium access must be time-shared across all $H$ hops. The effective end-to-end capacity $R_{\text{e2e}}$ is the harmonic sum of individual hop capacities:
   $$\frac{1}{R_{\text{e2e}}} = \sum_{h=1}^H \frac{1}{\max(10^{-6}, R_h)} \implies R_{\text{e2e}} = \frac{1}{\sum_{h=1}^H \frac{1}{\max(10^{-6}, R_h)}}$$
   - For $H = 2$ equal hops of $10\text{ Mbps}$: $R_{\text{e2e}} = \frac{1}{0.1 + 0.1} = 5.000\text{ Mbps}$ (exact 50% throughput penalty).
   - For $H = 3$ equal hops of $12\text{ Mbps}$: $R_{\text{e2e}} = \frac{1}{0.0833 \times 3} = 4.000\text{ Mbps}$.
6. **End-to-End Latency:**
   $$D_{\text{e2e}} = \sum_{h=1}^H \frac{d_h}{c} + (H - 1) \cdot T_{\text{turnaround}}$$
   where $T_{\text{turnaround}} = 2.5\text{ ms}$ (hardware baseband switching & MAC queue traversal).

### 2.5 Continuous Ground Convoy / Patrol Kinematics
Ground units marked as mobile patrols (e.g. Node 2 tactical patrol, Node 4 mechanized convoy) advance along predetermined geographic corridors:
$$\mathbf{p}_{\text{curr}}(t + \Delta t) = \mathbf{p}_{\text{curr}}(t) + \mathbf{v}_{\text{convoy}} \Delta t$$
$$\mathbf{v}_{\text{convoy}} = v_{\text{speed}} \cdot \frac{\mathbf{w}_{next} - \mathbf{w}_{curr}}{\|\mathbf{w}_{next} - \mathbf{w}_{curr}\|}$$
where:
- Tactical patrol speed: $v_{\text{speed}} = 1.4\text{ m/s}$ ($5.0\text{ km/h}$, dismounted infantry).
- Mechanized convoy speed: $v_{\text{speed}} = 12.0\text{ m/s}$ ($43.2\text{ km/h}$, armored column).
- Closed-corridor wrapping: when reaching waypoint $M$, waypoint index advances smoothly to 0.

### 2.6 Wind-Coupled ISA Aerodynamics & Flight Envelope
Airborne relay flight dynamics are modeled under International Standard Atmosphere (ISA) barometric conditions:
1. **ISA Troposphere Air Density Ratio ($h \le 11\,000\text{ m}$):**
   $$\sigma(h) = \frac{\rho(h)}{\rho_0} = \left(1 - 2.25577 \times 10^{-5} h\right)^{4.25588}$$
   - Sea level $\rho_0 = 1.225\text{ kg/m}^3$.
   - At Ladakh loiter altitude $h = 5\,500\text{ m}$: $\sigma(5500) = (1 - 0.124067)^{4.25588} = 0.875933^{4.25588} \approx 0.569 \pm 0.005$.
2. **True Airspeed (TAS) Stall Floor:**
   Sea-level calibrated stall speed $V_{\text{stall},0} = 24.0\text{ m/s}$. The minimum aerodynamic TAS required to maintain lift at altitude $h$:
   $$V_{\text{stall,TAS}}(h) = \frac{V_{\text{stall},0}}{\sqrt{\sigma(h)}}$$
   At $h = 5\,500\text{ m}$, $V_{\text{stall,TAS}} = \frac{24.0}{\sqrt{0.569}} \approx 31.82\text{ m/s}$ ($1.326\times$ increase over sea level).
3. **Crosswind Coupling & Crab Angle:**
   Given ambient wind velocity $\mathbf{v}_{\text{wind}} = [w_x, w_y]^T$ and nominal airspeed $\mathbf{v}_{\text{TAS}}$ along track heading $\psi$:
   $$v_{\text{crosswind}} = \|\mathbf{v}_{\text{wind}}\| \cdot \sin(\theta_{\text{wind}} - \psi)$$
   $$\beta_{\text{crab}} = \arcsin\left(\operatorname{clamp}\left(\frac{v_{\text{crosswind}}}{\max(1.0, \|\mathbf{v}_{\text{TAS}}\|)}, -0.95, 0.95\right)\right) \times \frac{180^\circ}{\pi}$$
   $$\mathbf{v}_{\text{ground}} = \mathbf{v}_{\text{TAS}} + \mathbf{v}_{\text{wind}}$$
   For $v_{\text{crosswind}} = 20\text{ m/s}$ and $V_{\text{TAS}} = 60\text{ m/s}$: $\beta_{\text{crab}} = \arcsin(1/3) \approx 19.47^\circ \pm 0.05^\circ$.
4. **Mission Endurance & Bingo Fuel:**
   Nominal loiter endurance $E_0 = 480\text{ min}$ (8 hours). Real-time fuel burn rate is elevated by high-altitude thin air drag and vertical climb work:
   $$\dot{E} = \frac{1}{60} \cdot \sqrt{\frac{\rho_0}{\rho(h)}} \cdot \left(1.0 + \max\left(0, \frac{v_z}{10.0}\right) \times 0.5\right) \quad [\text{min/s}]$$
   Bingo reserve alert triggers when remaining endurance $E_{\text{rem}} \le 45\text{ min}$.
5. **Automatic CFIT Pull-Up System:**
   Monitors forward terrain elevation profile over lookahead horizon $d_{\text{look}} = 3\,000\text{ m}$.
   If projected altitude $z_{\text{ACN}} < z_{\text{terrain,ahead}} + H_{\text{AGL,floor}}$ ($H_{\text{AGL,floor}} = 300\text{ m}$):
   $$z_{\text{cmd}} = z_{\text{terrain,ahead}} + H_{\text{AGL,floor}} + 50.0\text{ m}$$
   commands emergency vertical velocity $v_z = v_{z,\text{max}}$ ($10.0\text{ m/s}$) with `cfitPullUpActive: true`.

---

## 3. Verification Test Suite Matrix (Suite 106)

| Test ID | Gate Name | Target Metric / Acceptance Criteria |
|---|---|---|
| **[CM-T1]** | Event A3 Handover & A2A Backhaul | 5-frame TTT hold requirement; zero ping-pong; immediate fallback on serving outage ($< -1.5\text{ dB}$); A2A radio horizon clearance & $C_{A2A} > 50\text{ Mbps}$. |
| **[CM-T2]** | Multi-Hop Dijkstra MANET Routing | $H = 2$ equal $10\text{ Mbps}$ hops $\implies R_{\text{e2e}} = 5.000\text{ Mbps}$ ($\pm 0.001$); 3-hop isolated node recovery; end-to-end latency accumulation. |
| **[CM-T3]** | Ground Convoy Mobility | Armored convoy at $12.0\text{ m/s}$ advances $\Delta s = 0.24\text{ m}$ per $20\text{ ms}$ tick; exact velocity vectors; corridor waypoint wrap. |
| **[CM-T4]** | ISA Aerodynamics & Flight Envelope | $\sigma(5500) = 0.569 \pm 0.005$; $V_{\text{stall,TAS}} = 1.326\times V_{\text{stall},0}$; $20\text{ m/s}$ crosswind crab angle $= 19.47^\circ \pm 0.05^\circ$; bingo alert at $\le 45\text{ min}$; auto-CFIT triggers at $< 300\text{ m}$ AGL floor. |
| **[CM-T5]** | Live Worker Multi-ACN Run & Perf | Live 3-ACN constellation run with MANET, convoy, wind, and CFIT; bit-exact determinism across duplicate runs; clean `RESET_SIM`; UI label accessibility; micro-benchmark $< 5\,\mu\text{s}/\text{call}$. |

---

## 4. Architectural Sign-Off
Approved for implementation under Role 2: Coder / Implementer. All modifications conform strictly to designated seams and preserve all 105 prior verification suites.
