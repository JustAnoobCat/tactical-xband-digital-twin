# SPEC-WP05: Airframe Attitude Dynamics, 3D Coordinate Transforms, Fuselage Shadowing & Time-Correlated Rician-Jakes Fading

**Specification Document:** `docs/specs/wp05-airframe-attitude-and-channel-dynamics.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** RF Propagation / Flight Dynamics / Channel Modeling / 50 Hz Web Worker Invariants  
**Applies to Modules:** `src/core/trajectory.ts`, `src/core/antennaArray.ts`, `src/core/rfPropagationMath.ts`, `src/core/linkBudget.ts`, `src/tests/verifyAttitudeAndChannelDynamics.ts`  

---

## 1. Executive Summary & Zero-Duplication Audit

### 1.1 Context & Background
In airborne tactical network operations within high-relief mountainous topography (such as the Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$), an Airborne Communications Node (ACN) undergoes continuous 3D rotational motion (bank, pitch, yaw) while loitering along elliptical orbits or terrain-following waypoint corridors. The relative geometry between the airframe-mounted tactical antennas and ground stations (GCS) or dismounted soldiers is strongly governed by:
1. **Dynamic Airframe Attitude:** Coordinated-turn bank angles during loiter turns, pitch during climb/descent, and compass yaw heading.
2. **Fuselage & Wing Shadowing:** Physical airframe masking where line-of-sight (LOS) rays to ground nodes are obstructed by the aircraft fuselage or wing chords during banking maneuvers.
3. **Sector Handover Hysteresis:** State transitions across quad-sector directional antennas requiring clean angular hysteresis to eliminate ping-pong oscillations at sector boundaries.
4. **Time-Correlated Multipath Fading:** Doppler-induced rapid channel variations at 8.0 GHz tactical X-band where successive 50 Hz discrete simulation ticks ($\Delta t = 20\text{ ms}$) must exhibit physical temporal autocorrelation governed by Clarke/Jakes coherence statistics rather than uncorrelated white noise.

### 1.2 Zero-Duplication Codebase Audit
Before introducing new math, an exhaustive audit of existing implementations was conducted:
- **`src/core/trajectory.ts`:** Implements `ACNTrajectoryEngine` and `WaypointTrajectoryEngine`. Currently computes 3D position and velocity vectors $[v_x, v_y, v_z]$. Evaluates bank angle in `evaluateFlightPlanProfile()` via 2D finite-difference curvature $\kappa$, but lacks a unified, pure 3D coordinated-turn attitude estimator function.
- **`src/core/antennaArray.ts`:** Implements `QuadSectorAntennaEngine` with an internal `computeAcnAttitude()` that approximates pitch and bank with empirical stateful smoothing. The existing `evaluateNodeSector()` computes an approximate planar body azimuth and elevation via 1D projections. However, it lacks an exact, orthogonal 3D Tait-Bryan $Z$-$Y$-$X$ direction-cosine transformation matrix and does not model airframe fuselage or wing shadowing.
- **`src/core/rfPropagationMath.ts`:** Canonical library for ITU-R P.526 knife-edge, Bullington, Cascaded Deygout diffraction, FSPL, and geodetic calculations. Currently lacks time-correlated fading and Doppler coherence metrics.
- **`src/core/linkBudget.ts`:** Implements `computeDopplerKinematics()` (verifiable via `verify:doppler-ew`) and `computeRicianMultipathFading()` (an un-correlated instantaneous 6-oscillator model verifiable via `verify:rician-cqi`). It does not incorporate airframe shadowing losses or deterministic time-correlated Zheng-Xiao Sum-of-Sinusoids (SoS) channel fading.
- **Audit Mandate:** All existing methods (`computeDopplerKinematics`, `computeRicianMultipathFading`, `evaluateNodeSector`) and their public contracts must remain 100% intact and unaltered to preserve green status across all 88 existing verification suites. New functionality will extend these seams cleanly with optional parameters and dedicated pure mathematical functions.

---

## 2. Mathematical Formulations

### 2.1 3D Coordinated-Turn Attitude Kinematics (`src/core/trajectory.ts`)
Given instantaneous Cartesian velocity in ENU (East $v_x$, North $v_y$, Up $v_z$) in m/s, turn rate $\omega$ in rad/s, and maximum bank angle $\phi_{\max}$ (default $45^\circ$):
1. **Horizontal Speed:**
   $$v_h = \sqrt{v_x^2 + v_y^2}$$
2. **Yaw Heading $\psi$:**
   $$\psi = \begin{cases}
   0.0^\circ & \text{if } v_h \le 10^{-6} \text{ or non-finite} \\
   \left(\operatorname{atan2}(v_x, v_y) \cdot \frac{180}{\pi} + 360\right) \bmod 360 & \text{otherwise}
   \end{cases}$$
   $\psi \in [0, 360)^\circ$ clockwise from True North ($0^\circ = \text{North}, 90^\circ = \text{East}, 180^\circ = \text{South}, 270^\circ = \text{West}$).
3. **Pitch Angle $\theta$:**
   $$\theta = \begin{cases}
   0.0^\circ & \text{if } v_h \le 10^{-6} \text{ and } |v_z| \le 10^{-6} \\
   \operatorname{atan2}(v_z, v_h) \cdot \frac{180}{\pi} & \text{otherwise}
   \end{cases}$$
   $\theta > 0^\circ$ during climb (nose up), $\theta < 0^\circ$ during descent.
4. **Coordinated-Turn Bank / Roll Angle $\phi$:**
   In an aerodynamically coordinated turn, the horizontal lift component balances centrifugal force: $L \sin\phi = m \frac{v_h^2}{R} = m v_h \omega$, while the vertical lift component balances gravity: $L \cos\phi = m g$.
   $$\tan\phi = \frac{v_h \cdot \omega}{g}$$
   $$\phi = \operatorname{clamp}\left(\operatorname{atan2}(v_h \cdot \omega, g) \cdot \frac{180}{\pi}, -\phi_{\max}, +\phi_{\max}\right)$$
   where $g = 9.80665\text{ m/s}^2$. Clockwise/right turn ($\omega > 0$) induces positive right-wing-down roll ($\phi > 0$).
5. **Robustness:** Any non-finite input safely defaults to $\{ \text{yawDeg}: 0, \text{pitchDeg}: 0, \text{rollDeg}: 0 \}$.

---

### 2.2 Orthogonal Tait-Bryan $Z$-$Y$-$X$ World $\to$ Body Coordinate Transformation (`src/core/antennaArray.ts`)
Let the world coordinate frame be local ENU ($\mathbf{e}_E, \mathbf{e}_N, \mathbf{e}_U$).
The local navigation NED frame is related by:
$$\mathbf{r}_{\text{NED}} = [\text{losNorth}, \text{losEast}, -\text{losUp}]^T = [N, E, D]^T$$

The aircraft body frame is defined according to standard aerospace conventions:
- $X_b$ (`bodyForward`): Along the fuselage centerline pointing toward the nose.
- $Y_b$ (`bodyRight`): Starboard wing pointing right.
- $Z_b$ (`bodyDown`): Belly normal pointing downward through the aircraft floor.

The transformation from NED to Body frame follows the orthogonal Tait-Bryan $Z(\psi)$ - $Y(\theta)$ - $X(\phi)$ rotation sequence:
$$\mathbf{r}_{\text{body}} = \mathbf{R}_x(\phi) \mathbf{R}_y(\theta) \mathbf{R}_z(\psi) \mathbf{r}_{\text{NED}}$$

The constituent rotation matrices are:
$$\mathbf{R}_z(\psi) = \begin{bmatrix} \cos\psi & \sin\psi & 0 \\ -\sin\psi & \cos\psi & 0 \\ 0 & 0 & 1 \end{bmatrix}, \quad
\mathbf{R}_y(\theta) = \begin{bmatrix} \cos\theta & 0 & -\sin\theta \\ 0 & 1 & 0 \\ \sin\theta & 0 & \cos\theta \end{bmatrix}, \quad
\mathbf{R}_x(\phi) = \begin{bmatrix} 1 & 0 & 0 \\ 0 & \cos\phi & -\sin\phi \\ 0 & \sin\phi & \cos\phi \end{bmatrix}$$

Expanding the matrix product yields the direction-cosine matrix:
$$\mathbf{R} = \begin{bmatrix}
c_\theta c_\psi & c_\theta s_\psi & -s_\theta \\
-c_\phi s_\psi - s_\phi s_\theta c_\psi & c_\phi c_\psi - s_\phi s_\theta s_\psi & -s_\phi c_\theta \\
-s_\phi s_\psi + c_\phi s_\theta c_\psi & s_\phi c_\psi + c_\phi s_\theta s_\psi & c_\phi c_\theta
\end{bmatrix}$$
where $c_\psi = \cos\psi, s_\psi = \sin\psi, c_\theta = \cos\theta, s_\theta = \sin\theta, c_\phi = \cos\phi, s_\phi = \sin\phi$.

#### Body-Relative Angles:
Given $\mathbf{r}_{\text{body}} = [X_b, Y_b, Z_b]^T$:
1. **Body Azimuth $\psi_b$:**
   $$\psi_b = \left(\operatorname{atan2}(Y_b, X_b) \cdot \frac{180}{\pi} + 360\right) \bmod 360$$
   $0^\circ = \text{Forward (Nose)}, 90^\circ = \text{Right (Starboard)}, 180^\circ = \text{Aft (Tail)}, 270^\circ = \text{Left (Port)}$.
2. **Body Elevation $\theta_b$:**
   $$\theta_b = \operatorname{atan2}(-Z_b, \sqrt{X_b^2 + Y_b^2}) \cdot \frac{180}{\pi}$$
   - When a GCS is directly below the belly ($X_b = 0, Y_b = 0, Z_b > 0$): $\theta_b = -90.0^\circ$.
   - When the aircraft executes a **right bank** ($\phi > 0$, starboard wing drops), a GCS to the right/east maintains $Z_b > 0$, remaining deeply unobstructed ($\theta_b \ll 0^\circ$). Conversely, a GCS to the left/west experiences decreasing $Z_b$, causing $\theta_b$ to rise toward $0^\circ$ and positive values (fuselage/wing masking zone).
3. **Orthogonality Preservation:** $\det(\mathbf{R}) = 1.0$, $|\lVert \mathbf{r}_{\text{body}} \rVert - \lVert \mathbf{r}_{\text{NED}} \rVert| < 10^{-12}$.

---

### 2.3 Airframe Fuselage & Wing Shadowing Model (`src/core/antennaArray.ts`)
For an antenna mounted on the aircraft airframe:
1. **Belly Mount:**
   - **Fuselage Blockage:**
     $$\theta_{\text{eff}} = \theta_b$$
     $$L_{\text{fuse}}(\theta_{\text{eff}}) = \begin{cases}
     0.0\text{ dB} & \text{if } \theta_{\text{eff}} \le -5.0^\circ \\
     15.0 \cdot \frac{1}{2} \left[1 - \cos\left(\pi \frac{\theta_{\text{eff}} - (-5.0^\circ)}{15.0^\circ - (-5.0^\circ)}\right)\right]\text{ dB} & \text{if } -5.0^\circ < \theta_{\text{eff}} < 15.0^\circ \\
     15.0\text{ dB} & \text{if } \theta_{\text{eff}} \ge 15.0^\circ
     \end{cases}$$
   - **Wing-Chord Shadowing Bump:**
     Additional raised-cosine blockage centered at $| \text{bodyAzimuthDeg} | = 90^\circ$ (specifically, $\pm 20^\circ$ around $90^\circ$ Starboard and $270^\circ$ Port) when the line-of-sight grazes the wing chord plane ($\theta_{\text{eff}} \in [-5.0^\circ, +5.0^\circ]$):
     $$\Delta \psi_{\text{wing}} = \min(|\psi_b - 90^\circ|, |\psi_b - 270^\circ|)$$
     If $\Delta \psi_{\text{wing}} \le 20.0^\circ$ and $|\theta_{\text{eff}}| \le 5.0^\circ$:
     $$L_{\text{wing}} = 4.0 \cdot \frac{1}{2}\left[1 + \cos\left(\pi \frac{\Delta \psi_{\text{wing}}}{20.0^\circ}\right)\right] \cdot \frac{1}{2}\left[1 + \cos\left(\pi \frac{\theta_{\text{eff}}}{5.0^\circ}\right)\right]\text{ dB}$$
     Else $L_{\text{wing}} = 0.0\text{ dB}$.
   - **Total Shadow Loss:**
     $$L_{\text{shadow}} = \operatorname{clamp}(L_{\text{fuse}} + L_{\text{wing}}, 0.0, 15.0)\text{ dB}$$
2. **Dorsal Mount:**
   Exact vertical symmetry: $\theta_{\text{eff}} = -\theta_b$, with identical formulation.

---

### 2.4 Quad-Sector Handover Hysteresis (`src/core/antennaArray.ts`)
To prevent ping-pong transitions when a target hovers near the $45^\circ, 135^\circ, 225^\circ, 315^\circ$ sector seams:
- Sector boresights: $S_0 = 0^\circ, S_1 = 90^\circ, S_2 = 180^\circ, S_3 = 270^\circ$.
- Each sector nominal half-beam boundary is $\pm 45^\circ$.
- **Hysteresis Rule:**
  If a valid `previousSectorIndex` $\in \{0, 1, 2, 3\}$ is provided:
  The shortest signed angular offset to the previous sector's boresight is:
  $$\Delta \psi_{\text{prev}} = ((\psi_b - S_{\text{prev}} + 180) \bmod 360) - 180$$
  If $|\Delta \psi_{\text{prev}}| \le 45.0^\circ + \text{hysteresisMarginDeg}$ (default $3.0^\circ$, i.e. $48.0^\circ$), the previous sector is retained (`switched = false`).
  Otherwise, the best geometric sector is selected:
  $$\text{sectorIndex} = \left\lfloor \frac{(\psi_b + 45^\circ) \bmod 360}{90^\circ} \right\rfloor \bmod 4$$
  and `switched = (sectorIndex !== previousSectorIndex)`.

---

### 2.5 Deterministic Time-Correlated Zheng-Xiao (2003) Rician-Jakes Fading (`src/core/rfPropagationMath.ts`)
To model physical time-correlated fading without unphysical white-noise jumps between 50 Hz frames:
1. **Kinematic Doppler & Coherence Scale:**
   - Radial closing speed: $v_{\text{rad}}$
   - Total relative speed: $v_{\text{rel}} = \lVert \mathbf{v}_{\text{rel}} \rVert$
   - Radial Doppler shift:
     $$f_D = \frac{v_{\text{rad}}}{\lambda} = \frac{f_c \cdot v_{\text{rad}}}{c}$$
   - Maximum Doppler spread:
     $$f_{D,\max} = \frac{v_{\text{rel}}}{\lambda} = \frac{f_c \cdot v_{\text{rel}}}{c}$$
   - Clarke coherence time ($50\%$ correlation):
     $$T_c = \begin{cases}
     \frac{0.423}{f_{D,\max}} & \text{if } f_{D,\max} > 10^{-6}\text{ Hz} \\
     \infty & \text{otherwise}
     \end{cases}$$
2. **Deterministic Zheng-Xiao Improved Sum-of-Sinusoids (SoS) Model ($M = 8$):**
   The scattered diffuse multipath component $g(t) = g_I(t) + j g_Q(t)$ is generated with unit power $\mathbb{E}[|g(t)|^2] = 1.0$:
   $$g_I(t) = \sqrt{\frac{2}{M}} \sum_{n=1}^M \cos\left(2\pi f_{D,\max} t \cos\alpha_n + \psi_n\right)$$
   $$g_Q(t) = \sqrt{\frac{2}{M}} \sum_{n=1}^M \sin\left(2\pi f_{D,\max} t \sin\alpha_n + \phi_n\right)$$
   where:
   $$\alpha_n = \frac{2\pi n - \pi + \theta_0}{4M}$$
   The initial phase offsets $\theta_0, \psi_n, \phi_n$ are derived deterministically from the integer `seed` using a lightweight LCG pseudo-random hash (zero `Math.random()`).
3. **Rician Linear Envelope Combination:**
   Given Rician $K$-factor in dB: $K_{\text{lin}} = 10^{K_{\text{dB}} / 10}$ (with $K_{\text{lin}} = 0$ for $K_{\text{dB}} = -\infty$).
   $$r(t) = \left|\sqrt{\frac{K_{\text{lin}}}{K_{\text{lin}} + 1}} e^{j 2\pi f_D t} + \sqrt{\frac{1}{K_{\text{lin}} + 1}} \frac{g_I(t) + j g_Q(t)}{\sqrt{2}}\right|$$
   - Mean power is rigorously conserved: $\mathbb{E}[r(t)^2] = 1.0$.
   - Fading gain in dB:
     $$G_{\text{fading,dB}} = 20 \log_{10}(\max(r(t), 10^{-3}))$$
     clamped smoothly to $[-30.0, +6.0]\text{ dB}$.

---

## 3. Backward Compatibility & Public Interface Contract

### 3.1 Unbroken Legacy Callers
All existing calls to `LinkBudgetEngine.evaluateLink(...)` and `LinkBudgetEngine.computeRicianMultipathFading(...)` remain completely valid without parameter changes. Optional extensions are accepted via an options argument or non-breaking positional defaults:
```typescript
export interface AirframeChannelOptions {
  uavAttitude?: { headingDeg: number; pitchDeg: number; bankDeg: number };
  antennaMount?: 'belly' | 'dorsal';
  enableAirframeShadowing?: boolean;
  correlatedFadingParams?: {
    simTimeS: number;
    seed: number;
    carrierFreqHz?: number;
    relativeSpeedMps?: number;
  };
}
```

### 3.2 Output Telemetry Extensions
`LinkStatus` will carry optional telemetry fields:
- `airframeShadowLossDb?: number;`
- `bodyAzimuthDeg?: number;`
- `bodyElevationDeg?: number;`
- `correlatedFadingDb?: number;`
- `coherenceTimeMs?: number;`

Legacy consumers ignore these fields; advanced UI and telemetry consumers can inspect them directly.

---

## 4. Verification Suite Specification (Suite 89)

The new verification suite `src/tests/verifyAttitudeAndChannelDynamics.ts` will rigorously validate:
1. **Coordinated-Turn Attitude:** $v = 50\text{ m/s}, R = 500\text{ m}$ ($\omega = 0.1\text{ rad/s}$) $\implies \text{rollDeg} \approx 26.99^\circ \pm 0.05^\circ$; clamping at $\pm 45^\circ$; climb/descent pitch; `NaN` safety.
2. **3D World $\to$ Body Orthogonality:** $|\lVert \mathbf{u}_{\text{body}} \rVert - 1| < 10^{-12}$; bank angle sign physics (right bank exposes west GCS to positive elevation/fuselage shadow, east GCS remains unobstructed).
3. **Airframe Shadow Loss:** $0\text{ dB}$ for $\theta_b \le -5^\circ$, smooth $C^1$ rise to $15\text{ dB}$ at $\ge 15^\circ$, wing-chord bump, dorsal vertical inversion.
4. **Quad-Sector Hysteresis:** Zero ping-pong switches within $\pm 2.5^\circ$ of all 4 sector seams ($45^\circ, 135^\circ, 225^\circ, 315^\circ$); clean switch beyond $+48.5^\circ$.
5. **Deterministic Zheng-Xiao Fading:** Deterministic repeat across identical seed/time; exact 8.0 GHz Doppler shift ($v_{\text{rad}} = 50\text{ m/s} \implies f_D \approx 1334.26\text{ Hz}$); unit-mean power $\mathbb{E}[r^2] = 1.0 \pm 0.12$; temporal autocorrelation $\rho(\Delta t = 0.05 T_c) > 0.85$.
6. **Execution Budget:** 10,000 evaluations complete in $< 50\text{ ms}$ ($< 5\,\mu\text{s}$ per call).
