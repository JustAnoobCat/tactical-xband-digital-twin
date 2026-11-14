# SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR
## Real-Time Polar X-Band SINR Viewshed Engine & 360° Orbit-Integrated Ridgeline Relay Advisor

**Document ID:** `DRDO-TAC-XBAND-SPEC-VIEWSHED-RELAY-01`  
**Status:** Approved & Implemented (Upgrade #7 / M1.2)  
**Author:** Engineering Planner (Role 1) & Implementer (Role 2)  
**Target Runtime:** Web Worker (`src/worker/simWorker.ts`, `src/core/viewshedEngine.ts`) & Scientific C2 Console (`index.html`)

---

### 1. Architectural Motivation & Invariants

In high-relief mountainous topography (e.g., Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$), airborne tactical nodes (ACN) face severe shadowing from ridgelines and massif barriers. Furthermore, hostile electronic warfare (EW) jammers degrade reception along line-of-sight propagation corridors.

To provide field commanders and mission planners with continuous situational awareness of RF coverage and optimal placement for terrestrial Mobile Command Post (MCP) relays, this specification defines:
1. **Zero-Allocation Polar X-Band Viewshed Engine:** Computes a 576-cell polar SINR grid centered on the ACN with body-fixed 4-sector antenna roll-off (ITU-R F.1336-5), knife-edge terrain diffraction (ITU-R P.526-15), atmospheric absorption (ITU-R P.676-13), and contested EW jammer interference.
2. **Amortized Ray Sweeping:** Computes 6 azimuth rays per 20 ms tick ($\Delta t = 20\text{ ms}$), achieving a complete 360° sweep every 120 ms ($< 0.4\text{ ms}$ per tick) to strictly maintain the 50 Hz discrete simulation budget ($p50 < 6\text{ ms}$, $p95 < 11\text{ ms}$).
3. **360° Orbit-Integrated Ridgeline Relay Placement Advisor:** Samples topographic candidates across 12 orbital phases ($t_m = m \cdot T_{\text{orbit}} / 12$) to calculate multi-phase line-of-sight orbit availability ($\ge 80\%$), ground squad coverage ($\ge 75\%$), and terrain prominence to advise optimal ridgeline relay positioning.

---

### 2. Mathematical Formulations

#### 2.1 Polar Viewshed Grid Geometry
The viewshed is discretized in body/world polar coordinates centered at current ACN position $\vec{p}_{\text{acn}} = [x_{\text{acn}}, y_{\text{acn}}, z_{\text{acn}}]$:
- **Azimuth Rays:** $N_{\text{az}} = 36$ angular rays with $\Delta \theta = 10^\circ$ ($0^\circ, 10^\circ, \dots, 350^\circ$ world bearing).
- **Radial Rings:** $N_{\text{rng}} = 16$ radial range bins from $r_{\min} = 1,500\text{ m}$ to $r_{\max} = 24,000\text{ m}$ in $\Delta r = 1,500\text{ m}$ steps.
- **Total Cell Count:** $N_{\text{cells}} = 36 \times 16 = 576$ cells stored in a pre-allocated `Float32Array(576)`.

Ground cell coordinate $(x_c, y_c, z_c)$ at azimuth index $a \in [0, 35]$ and range index $j \in [0, 15]$:
$$\theta_a = a \cdot 10^\circ \cdot \frac{\pi}{180}, \quad r_j = (j + 1) \cdot 1500\text{ m}$$
$$x_c = x_{\text{acn}} + r_j \sin\theta_a, \quad y_c = y_{\text{acn}} + r_j \cos\theta_a, \quad z_c = \text{DEM}(x_c, y_c) + 2.0\text{ m (mast)}$$

#### 2.2 Link Budget & Multi-Sector Antenna Coupling
For each polar cell, the propagation loss incorporates:
1. **Free-Space Path Loss (FSPL):**
   $$L_{\text{fspl}}(\text{dB}) = 20 \log_{10}(d) + 20 \log_{10}(f_c) + 20 \log_{10}\left(\frac{4\pi}{c}\right)$$
2. **ITU-R P.676-13 Atmospheric Gaseous Absorption:**
   $$A_g(\text{dB}) = \gamma_o(h_{\text{mean}}) d_{\text{eff}} + \gamma_w(h_{\text{mean}}) d_{\text{eff}}$$
3. **ITU-R P.526-15 Terrain Obstruction Loss:**
   $$L_{\text{diff}}(\text{dB}) = \text{KnifeEdgeLoss}(\nu), \quad \nu = h_{\text{obs}} \sqrt{\frac{2}{\lambda} \left(\frac{1}{d_1} + \frac{1}{d_2}\right)}$$
4. **ITU-R F.1336-5 Body-Fixed 4-Sector Roll-Off:**
   For an antenna sector with body-relative azimuth offset $\psi_s \in \{0^\circ, 90^\circ, 180^\circ, 270^\circ\}$ and heading $\psi_{\text{acn}}$:
   $$\Delta \phi_s = \text{Wrap180}(\theta_a - \psi_{\text{acn}} - \psi_s)$$
   $$A_H(\Delta \phi_s) = \min\left(12 \left(\frac{\Delta \phi_s}{\text{HPBW}_H}\right)^2, \; A_{m,H}\right), \quad \text{where } \text{HPBW}_H = 90^\circ, \; A_{m,H} = 25\text{ dB}$$
   $$G_{\text{acn}} = \max_{s \in [0, 3]} \left(G_{\text{sector,max}} - A_H(\Delta \phi_s)\right)$$
   At boresight ($\Delta \phi_s = 0^\circ$), attenuation is $0.0\text{ dB}$. At crossover diagonals ($\Delta \phi_s = \pm 45^\circ$), attenuation is $12 \cdot (45/90)^2 = 3.0\text{ dB}$.

5. **Net Signal-to-Interference-plus-Noise Ratio (SINR):**
   $$P_{\text{Rx}}(\text{dBm}) = P_{\text{Tx}} + G_{\text{cell}} + G_{\text{acn}} - (L_{\text{fspl}} + L_{\text{diff}} + A_g + L_{\text{rain}} + L_{\text{cable}} + M_{\text{impl}})$$
   $$\text{SINR}(\text{dB}) = P_{\text{Rx}} - 10 \log_{10}\left(10^{P_N / 10} + 10^{I_J / 10}\right)$$
   where $P_N = -105.0\text{ dBm}$ (thermal noise floor) and $I_J$ is the received jammer power coupled through the active sector antenna pattern.

#### 2.3 360° Orbit-Integrated Ridgeline Relay Advisor
Candidate positions $\vec{r}_{\text{cand}} = [x_k, y_k, z_k]$ are sampled across high-prominence ridgeline points in polar rings ($N_{\text{az}} = 24$, $N_{\text{rad}} = 8$ within $[2\text{ km}, 14\text{ km}]$ of theater origin).

Each candidate is evaluated across $M = 12$ equidistant orbital phases ($t_m = m \cdot T_{\text{orbit}} / 12$):
1. **Orbit Availability Percentage:**
   $$\text{Avail}_{\text{orbit}} = \frac{1}{M} \sum_{m=0}^{M-1} \mathbf{1}\{\text{SINR}(\vec{r}_{\text{cand}}, \vec{p}_{\text{acn}}(t_m)) \ge 10.0\text{ dB}\} \times 100\%$$
2. **Ground Squad Coverage Percentage:**
   $$\text{Cov}_{\text{ground}} = \frac{1}{K} \sum_{k=1}^K \mathbf{1}\{\text{SINR}(\vec{r}_{\text{cand}}, \vec{p}_{\text{ground}, k}) \ge 4.0\text{ dB} \lor \text{isLoS}\} \times 100\%$$
3. **Composite Prominence Objective Function:**
   $$S(\vec{r}_{\text{cand}}) = \left[ (\text{Avail}_{\text{orbit}} \ge 80\% ? 600 : 0) + 4.0 \cdot \text{Avail}_{\text{orbit}} + 3.0 \cdot \text{Cov}_{\text{ground}} + \frac{z_{\text{cand}} - \bar{z}_{\text{ground}}}{20} + 0.5 \cdot \overline{\text{SINR}} \right] \times \Phi_{\text{prom}}$$
   where $\Phi_{\text{prom}} = 1.5 + (z_{\text{cand}} - \bar{z}_{\text{ground}})/1000$ for elevated ridges ($z_{\text{cand}} > \bar{z}_{\text{ground}} + 150\text{ m}$) and $0.3$ otherwise.

---

### 3. Verification Contracts (`src/tests/verifyViewshedAndRelayAdvisor.ts`)

- **VRA-T1 (Grid Geometry & 4-Sector Coupling):** Grid length is exactly 576 finite entries. All 4 sector boresights ($0^\circ, 90^\circ, 180^\circ, 270^\circ$) produce $\approx 3.0\text{ dB}$ higher SINR than the $\pm 45^\circ$ crossover directions.
- **VRA-T2 (Himalayan Shadow Cone Detection):** Northward ray behind a $5,400\text{ m}$ ridge drops into severe negative SINR ($< 0\text{ dB}$) with shadow loss delta $> 70\text{ dB}$ compared to open valley.
- **VRA-T3 (Optimal Ridgeline Relay Placement):** Relay Advisor selects an elevated ridgeline position ($> 3,500\text{ m}$ MSL) achieving $\ge 80\%$ orbit availability and $\ge 75\%$ ground squad coverage.
- **VRA-T4 (Worker 50 Hz Budget Safety):** Step latency with viewshed enabled remains $< 16\text{ ms}$ (budget $\Delta t = 20\text{ ms}$), with serialized `viewshed_sinr_grid` and `relay_advisor`.
