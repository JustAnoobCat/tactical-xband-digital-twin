# Implementation Specification: Replacing Hardcoded RF/Terrain Constants with First-Principles ITU-R Physics

**Document ID:** `SPEC-ITU-FIRST-PRINCIPLES-RF-AND-TERRAIN`  
**Author:** Role 1: Engineering Planner  
**Date:** 2026-11-13  
**Status:** PROPOSED (Awaiting User Sign-Off)  
**Target Repository:** `tactical-xband-digital-twin`  
**Target Branch:** `main`  

---

## 1. Objective & Scope

### 1.1 Primary Objective
Eliminate empirical and hardcoded heuristic constants across the physical propagation, atmospheric, and scheduling engines:
1. **Hardcoded Fock Rounded-Crest Penalty (`12.0 dB`):** Replace with physical DEM ridge radius of curvature ($R_{\text{crest}}$) and dimensionless cylinder curvature loss $T(m, n)$ per ITU-R P.526-15 §4.2, coupled with ITU-R P.526-15 §4.5.1 Bullington multi-ridge equivalent knife-edge construction.
2. **Flat Gaseous Absorption (`0.012 dB/km`):** Replace with ITU-R P.676-13 / P.835-6 altitude-integrated exponential scale-height tropospheric absorption for dry oxygen ($h_o = 6000\text{ m}$) and water vapor ($h_w = 2000\text{ m}$) across high-relief Ladakh altitudes ($3000\text{–}6000\text{ m}$ MSL).
3. **Infinite Rain Height Assumption:** Replace with ITU-R P.839-4 $0^\circ\text{C}$ freezing isotherm rain ceiling ($h_R = 4800.0\text{ m}$ MSL for Ladakh sector at $34.5^\circ\text{N}$) with partitioned liquid vs dry ice/snow attenuation.
4. **Static Receiver Noise Floor:** Incorporate ITU-R P.618-14 sky-noise temperature integration ($\Delta T_{\text{sky}}$) into receiver operating noise temperature ($T_{\text{sys}} = T_0 \cdot 10^{\text{NF}/10} + \Delta T_{\text{sky}}$) during rain and atmospheric events.
5. **Hardcoded TDMA Timing Advance (`0.001 s`):** Replace with physical speed-of-light propagation timing advance ($\tau_{\text{TA}, i} = 2 d_{3\text{D}, i} / c$) based on authoritative link slant range.

### 1.2 Target Seams
- `src/core/terrain.ts`: `evaluateTerrainObstruction()`, `TerrainObstruction` interface, and helper functions for DEM profile derivatives and Bullington geometry.
- `src/core/linkProfile.ts`: `LinkProfile` interface (expose `crestRadiusM`, `curvatureLossDb`, `bullingtonApexDistM`).
- `src/core/profileEngine.ts`: `buildSelectedLinkBudget()`, `buildEmptyFresnelSlice()`, `buildFresnelSlice()`.
- `src/core/linkBudget.ts`: `computeGaseousAttenuationDb()`, `computeRainAttenuationDb()`, and `evaluateLink()`.
- `src/core/scheduler.ts`: `LegacyStaticScheduler.scheduleFrame()` and `TerrainAwareDynamicScheduler.scheduleFrame()`.
- `src/worker/simWorker.ts`: Pass node and ACN altitudes into `linkEngine.evaluateLink()`.
- `src/shared/workerProtocol.ts`: Update `SelectedLinkBudgetTelemetry` and `FresnelSliceTelemetry` with physical metadata.
- `src/tests/verifyItuFirstPrinciples.ts`: New verification suite (57th suite).
- `scripts/run_all_verifications.mjs` & `package.json`: Suite registration.

### 1.3 Exclusions
- Do NOT alter the 50 Hz discrete-event loop time-step ($\Delta t = 20\text{ ms}$).
- Do NOT alter DVB-S2X MODCOD SNR switching thresholds or spectral efficiencies.
- Do NOT change the constructor signature of `TerrainAwareDynamicScheduler(0.008)` (inviolable contract in `scripts/verify-project.mjs`).
- Do NOT break existing 1-argument or legacy test calls to `computeGaseousAttenuationDb`, `computeRainAttenuationDb`, and `evaluateLink`.

---

## 2. Baseline Architecture & Context

### 2.1 Current State
- `src/core/terrain.ts:983–984`:
  ```ts
  const fockPenaltyDb = 12.0;
  diffractionLossDb = knifeEdgeLoss + fockPenaltyDb;
  ```
  Every terrain occlusion unconditionally applies an uncalibrated $+12.0\text{ dB}$ penalty regardless of whether the mountain crest is razor-sharp granite or a rolling plateau.
- `src/core/linkBudget.ts:93–95`:
  ```ts
  public static computeGaseousAttenuationDb(slantRangeM: number): number {
    return 0.012 * (slantRangeM / 1000.0);
  }
  ```
  A flat $0.012\text{ dB/km}$ is applied whether propagation occurs at sea level or across the thin air of Khardung La ($5359\text{ m}$ MSL).
- `src/core/linkBudget.ts:103–112`:
  Rain attenuation is assumed liquid through the entire slant path up to `rainCellLengthKm`, ignoring that precipitation above the freezing ceiling ($4800\text{ m}$ MSL) is dry ice/snow with negligible attenuation ($< 8\%$).
- `src/core/linkBudget.ts:161–210`:
  Receiver thermal noise floor is calculated strictly from $k_B T_0 B \cdot 10^{\text{NF}/10}$ ($T_0 = 290\text{ K}$) without sky-noise temperature increase from atmospheric absorption ($T_{\text{sky}}$).
- `src/core/scheduler.ts:477, 599, 627, 915, 1115`:
  `timingAdvanceS: 0.001` is hardcoded across all TDMA allocations.

### 2.2 Architectural & Performance Constraints
- Worker execution budget for obstruction evaluation: $< 1.5\text{ ms}$ per tick for all 16 ground nodes.
- Zero heap allocations in inner ray-marching and profile derivative loops.
- All 56 existing verification suites (`npm run verify:all`) must pass with 0 regressions.

---

## 3. Affected Components & Files

| Component / File | Role | Modifications |
| :--- | :--- | :--- |
| `src/core/terrain.ts` | Physics | Implement DEM crest derivative calculation, radius of curvature $R_{\text{crest}}$, ITU-R P.526-15 §4.2 cylinder loss $T(m, n)$, and §4.5.1 Bullington multi-ridge equivalent knife-edge. Update `TerrainObstruction` interface. |
| `src/core/linkProfile.ts` | Display Geometry | Add `crestRadiusM?`, `curvatureLossDb?`, and `bullingtonApexDistM?` to `LinkProfile`. |
| `src/core/profileEngine.ts` | Worker Domain | Pass physical curvature and Bullington apex through Fresnel slice telemetry. |
| `src/core/linkBudget.ts` | RF Physics | Implement altitude-integrated P.676-13 gaseous loss, P.839-4 rain freezing ceiling, and P.618-14 sky noise increase $\Delta T_{\text{sky}}$. |
| `src/core/scheduler.ts` | Schedulers | Replace hardcoded `timingAdvanceS: 0.001` with $2 d_{3\text{D}} / c$ in `SlotAllocation`. |
| `src/worker/simWorker.ts` | Worker State | Provide node altitude ($z_{\text{node}}$) and ACN altitude ($z_{\text{acn}}$) to `linkEngine.evaluateLink()`. |
| `src/shared/workerProtocol.ts` | Contracts | Add optional physical metrics to `SelectedLinkBudgetTelemetry` and `FresnelSliceTelemetry`. |
| `src/tests/verifyItuFirstPrinciples.ts` | Test Suite | New verification suite covering ITU-T1 through ITU-T5. |
| `scripts/run_all_verifications.mjs` | Test Runner | Register `verify:itu-physics` as suite #57. |
| `package.json` | Project Scripts | Register `"verify:itu-physics": "vite-node src/tests/verifyItuFirstPrinciples.ts"`. |

---

## 4. Data Flow & Interface Contracts

### 4.1 `TerrainObstruction` Extension (`src/core/terrain.ts`)
```ts
export interface TerrainObstruction {
  readonly minClearanceM: number;
  readonly fresnelRadiusM: number;
  readonly diffractionLossDb: number;
  readonly isLos: boolean;
  readonly isCoverageComplete?: boolean;
  readonly obstacleBlocked: boolean;
  readonly obstacleIntersections: readonly ObstacleIntersection[];
  readonly coverageNote?: string;
  // First-principles ITU-R P.526-15 physical parameters
  readonly crestRadiusM?: number;
  readonly curvatureLossDb?: number;
  readonly bullingtonApexDistM?: number;
}
```

### 4.2 `LinkStatus` Extension (`src/core/linkBudget.ts`)
```ts
export interface LinkStatus {
  readonly modcodName: string;
  readonly spectralEfficiency: number;
  readonly bitrateBps: number;
  readonly bitrateMbps: number;
  readonly snrDb: number;
  readonly prxDbm: number;
  readonly fsplDb: number;
  readonly diffractionLossDb: number;
  readonly gasLossDb: number;
  readonly rainLossDb: number;
  readonly cableLossDb: number;
  readonly implementationMarginDb: number;
  readonly totalLossDb: number;
  readonly isOutage: boolean;
  readonly slantRangeM: number;
  readonly pNoiseDbm: number;
  readonly pTxDbm: number;
  readonly txGainDbi: number;
  readonly rxGainDbi: number;
  readonly obstacleBlocked?: boolean;
  readonly timingAdvanceS?: number;
  // ITU-R P.618-14 Sky Noise Coupling
  readonly skyNoiseIncreaseDb?: number;
  readonly skyTemperatureK?: number;
}
```

### 4.3 `LinkBudgetEngine` Methods (`src/core/linkBudget.ts`)
```ts
public static computeGaseousAttenuationDb(
  slantRangeM: number,
  nodeAltM?: number,
  acnAltM?: number,
  carrierFreqHz: number = 8.0e9
): number;

public static computeRainAttenuationDb(
  slantRangeM: number,
  env: EnvironmentConfig,
  nodeAltM?: number,
  acnAltM?: number
): number;

public evaluateLink(
  nodeType: NodeType | string,
  slantRangeM: number,
  diffractionLossDb: number,
  rf: RFConfig,
  env: EnvironmentConfig,
  obstacleBlocked: boolean = false,
  customTxPowerDbm?: number,
  sectorEval?: AcnSectorEvaluation,
  nodeAltM?: number,
  acnAltM?: number
): LinkStatus;
```

---

## 5. Algorithms & Mathematical Formulations

### 5.1 ITU-R P.526-15 §4.2 Rounded-Crest Curvature Attenuation $T(m, n)$

#### Step 1: Terrain Profile Derivatives & Crest Radius of Curvature ($R_{\text{crest}}$)
Along the ray path of length $D$, stepped at interval $\Delta s$ (e.g. $100\text{ m}$), let $z_i$ be the effective terrain elevation including 4/3 Earth curvature bulge:
$$z_i = z_{\text{terrain}}(s_i) + \Delta h_{\text{bulge}}(s_i)$$

At the dominant obstruction peak index $i_{\text{peak}} \in [1, N-2]$:
$$z'(s) = \frac{z_{i+1} - z_{i-1}}{2 \Delta s}$$
$$z''(s) = \frac{z_{i-1} - 2 z_i + z_{i+1}}{\Delta s^2}$$

For a convex ridge crest ($z''(s) < 0$), the physical radius of curvature $R_{\text{crest}}$ is:
$$R_{\text{crest}} = \text{clamp}_{[0.5, 2000.0]}\left( \frac{\left(1 + (z'(s))^2\right)^{3/2}}{\max\left(-z''(s), \; 5 \times 10^{-4}\text{ m}^{-1}\right)} \right)$$
*(If $z''(s) \ge 0$, representing a flat plateau or local saddle, set $R_{\text{crest}} = 2000.0\text{ m}$ with $T_{\text{crest}} = 0\text{ dB}$.)*

#### Step 2: Dimensionless Cylinder Parameters $m$ and $n$
With wavelength $\lambda = c / f \approx 0.037474\text{ m}$ ($f = 8.0\text{ GHz}$), segment distances $d_1 = s_{i}$ and $d_2 = D - s_{i}$, and penetration height $h_{\text{obs}} = z_i - z_{\text{los}}(s_i)$:
$$m = R_{\text{crest}}^{2/3} \left(\frac{d_1 + d_2}{d_1 d_2}\right) \left(\frac{\lambda}{\pi}\right)^{1/3}$$
$$n = \max(h_{\text{obs}}, 0) \cdot R_{\text{crest}}^{-1/3} \left(\frac{\pi}{\lambda}\right)^{2/3}$$

#### Step 3: Cylinder Excess Attenuation $T(m, n)$
$$T_{\text{crest}}(m, n) = \begin{cases} 
7.2 m^{1/2} - (2 - 12.5 n) m + 3.6 m^{3/2} - 0.8 m^2 & \text{if } m \cdot n \le 4.0 \\
-6.0 - 20 \log_{10}(m \cdot n) + 7.2 m^{1/2} - (2 - 17 n) m + 3.6 m^{3/2} - 0.8 m^2 & \text{if } m \cdot n > 4.0 
\end{cases}$$
$$T_{\text{crest}} = \text{clamp}_{[0.0, 20.0]}\left( T_{\text{crest}}(m, n) \right)\text{ dB}$$

---

### 5.2 ITU-R P.526-15 §4.5.1 Bullington Multi-Ridge Horizon Construction

When multiple peaks exist between TX at $(0, z_{\text{tx}})$ and RX at $(D, z_{\text{rx}})$:
1. Compute the horizon elevation angle (slope) from TX:
   $$S_{\text{tx}}(s_i) = \frac{z_{\text{eff}}(s_i) - z_{\text{tx}}}{s_i}, \quad S_{\text{tx,max}} = \max_i S_{\text{tx}}(s_i) \text{ at index } i_{\text{tx}}$$
2. Compute the horizon elevation angle (slope) from RX:
   $$S_{\text{rx}}(s_i) = \frac{z_{\text{eff}}(s_i) - z_{\text{rx}}}{D - s_i}, \quad S_{\text{rx,max}} = \max_i S_{\text{rx}}(s_i) \text{ at index } i_{\text{rx}}$$
3. If $i_{\text{tx}} \neq i_{\text{rx}}$ and the two horizon tangent lines intersect above the direct line of sight:
   - Apex horizontal distance:
     $$s_{\text{bull}} = \frac{z_{\text{rx}} - z_{\text{tx}} + S_{\text{rx,max}} D}{S_{\text{tx,max}} + S_{\text{rx,max}}}$$
   - Apex elevation:
     $$z_{\text{bull}} = z_{\text{tx}} + S_{\text{tx,max}} s_{\text{bull}}$$
   - LoS chord elevation at $s_{\text{bull}}$:
     $$z_{\text{los}}(s_{\text{bull}}) = z_{\text{tx}} + \frac{s_{\text{bull}}}{D}(z_{\text{rx}} - z_{\text{tx}})$$
   - Apex clearance height:
     $$h_{\text{bull}} = z_{\text{bull}} - z_{\text{los}}(s_{\text{bull}})$$
   - Bullington Fresnel parameter $\nu_{\text{bull}}$:
     $$\nu_{\text{bull}} = h_{\text{bull}} \sqrt{\frac{2}{\lambda} \left(\frac{1}{s_{\text{bull}}} + \frac{1}{D - s_{\text{bull}}}\right)}$$
   - Knife-edge loss $J(\nu_{\text{bull}})$:
     $$J(\nu) = 6.9 + 20 \log_{10}\left( \sqrt{(\nu - 0.1)^2 + 1.0} + (\nu - 0.1) \right)$$
   - Total diffraction loss:
     $$A_{\text{diff}} = J(\nu_{\text{bull}}) + T_{\text{crest}}(m, n)$$
4. If $i_{\text{tx}} == i_{\text{rx}}$ (single dominant ridge):
   $$A_{\text{diff}} = J(\nu_{\text{single}}) + T_{\text{crest}}(m, n)$$

---

### 5.3 ITU-R P.676-13 Altitude-Integrated Gaseous Absorption

Tropospheric density decreases exponentially with altitude. For propagation between $z_1 = \min(\text{nodeAltM}, \text{acnAltM})$ and $z_2 = \max(\text{nodeAltM}, \text{acnAltM})$:
- Scale heights per ITU-R P.835-6:
  - Dry air oxygen: $h_o = 6000.0\text{ m}$, sea-level rate $\gamma_{o,0} = 0.0072\text{ dB/km}$ at $8.0\text{ GHz}$.
  - Water vapor: $h_w = 2000.0\text{ m}$, sea-level rate $\gamma_{w,0} = 0.0028\text{ dB/km}$ at $8.0\text{ GHz}$.
- Analytical height-scaling integral:
  $$\eta(z_1, z_2, H) = \begin{cases} 
  \frac{H}{z_2 - z_1}\left(e^{-z_1/H} - e^{-z_2/H}\right) & \text{if } |z_2 - z_1| > 10.0\text{ m} \\ 
  e^{-(z_1 + z_2)/(2H)} & \text{otherwise} 
  \end{cases}$$
- Total gaseous loss:
  $$A_{\text{gas}} = \left(\gamma_{o,0} \cdot \eta(z_1, z_2, h_o) + \gamma_{w,0} \cdot \eta(z_1, z_2, h_w)\right) \cdot \frac{\max(d_{3\text{D}}, 1.0)}{1000.0}\text{ dB}$$

---

### 5.4 ITU-R P.839-4 Rain Freezing Ceiling ($h_R$)

For Himalayan mid-latitudes ($34.5^\circ\text{N}$):
- $0^\circ\text{C}$ isotherm height: $h_0 \approx 4440.0\text{ m}$ MSL.
- Rain height ceiling: $h_R = h_0 + 360.0\text{ m} = 4800.0\text{ m}$ MSL.
- Liquid slant path fraction $f_{\text{liquid}}$:
  $$f_{\text{liquid}} = \begin{cases}
  0.0 & \text{if } \min(z_1, z_2) \ge h_R \\
  1.0 & \text{if } \max(z_1, z_2) \le h_R \\
  \text{clamp}_{[0, 1]}\left(\frac{h_R - \min(z_1, z_2)}{|z_2 - z_1|}\right) & \text{otherwise}
  \end{cases}$$
- Effective rain cell distance: $L_{\text{eff}} = \min(d_{3\text{D}} / 1000.0, \text{rainCellLengthKm})$.
- Specific rain attenuation: $\gamma_R = k_H R^{\alpha_H} = 0.00411 \cdot (\text{rainRateMmH})^{1.39}\text{ dB/km}$.
- Combined attenuation (liquid rain + 8% dry snow/ice):
  $$A_{\text{rain}} = \gamma_R \cdot L_{\text{eff}} \cdot \left(f_{\text{liquid}} + 0.08 \cdot (1.0 - f_{\text{liquid}})\right)\text{ dB}$$

---

### 5.5 ITU-R P.618-14 Sky-Noise Coupling

Atmospheric absorption radiates thermal noise into the antenna aperture:
- Medium physical temperature: $T_m = 275.0\text{ K}$.
- Total absorption: $A_{\text{atm}} = A_{\text{gas}} + A_{\text{rain}}$ (in dB).
- Sky noise temperature increase:
  $$\Delta T_{\text{sky}} = T_m \left(1 - 10^{-A_{\text{atm}} / 10}\right)\text{ K}$$
- Receiver reference noise temperature ($T_0 = 290.0\text{ K}$, $\text{NF}_{\text{dB}}$):
  $$T_{\text{in}, 0} = T_0 \cdot 10^{\text{NF}/10}$$
- Sky-noise degradation:
  $$\Delta N_{\text{sky,dB}} = 10 \log_{10}\left(1 + \frac{\Delta T_{\text{sky}}}{T_0 \cdot 10^{\text{NF}/10}}\right)\text{ dB}$$
- Total receiver noise floor:
  $$P_{\text{noise,dBm}} = P_{\text{noise,thermal,dBm}} + \Delta N_{\text{sky,dB}}$$

---

### 5.6 Speed-of-Light Propagation Timing Advance

For each active TDMA link allocation:
$$\tau_{\text{TA}, i} = \frac{2.0 \cdot d_{3\text{D}, i}}{299792458.0}\text{ seconds}$$
*(Falls back to `this.timingAdvanceS` only when `slantRangeM <= 0` or undefined).*

---

## 6. Concurrency & Lifecycle

```
[ Worker Tick (50 Hz, simWorker.ts) ]
  ├── 1. TerrainEngine.evaluateTerrainObstruction(nodePos, acnPos, rfConfig, envConfig)
  │      ├── Evaluates 100m ray-march with zero-allocation scalar loop
  │      ├── Finds Bullington horizons (Stx,max, Srx,max)
  │      ├── Computes DEM crest curvature derivatives z', z'' -> Rcrest
  │      └── Outputs J(nu_bull) + T_crest(m, n), crestRadiusM, bullingtonApexDistM
  │
  ├── 2. LinkBudgetEngine.evaluateLink(..., nodeAltM, acnAltM)
  │      ├── Computes P.676-13 altitude-scaled gasLossDb
  │      ├── Computes P.839-4 freezing-ceiling partitioned rainLossDb
  │      ├── Computes P.618-14 skyNoiseIncreaseDb & elevates pNoiseDbm
  │      └── Determines SNR, DVB-S2X MODCOD, and bitrate
  │
  └── 3. Schedulers (LegacyStatic / TacDynamic)
         ├── Reads linkStatus.slantRangeM
         └── Assigns timingAdvanceS = (2 * slantRangeM) / SPEED_OF_LIGHT to each slot
```

---

## 7. Edge Cases & Failure Modes

1. **Flat Plateau / Saddle ($z''(s) \ge 0$):** Curvature radius clamped to $2000.0\text{ m}$; excess cylinder loss $T_{\text{crest}}$ defaults cleanly to $0.0\text{ dB}$.
2. **Sharp Cliff / Knife Ridge ($z''(s) \ll 0$):** Curvature radius clamped to $0.5\text{ m}$; prevents division by zero.
3. **Single Ridge ($i_{\text{tx}} == i_{\text{rx}}$):** Bullington apex collapses gracefully to the single ridge crest distance; $s_{\text{bull}} = s_i$.
4. **Equal Node & ACN Altitudes ($|z_2 - z_1| \le 10\text{ m}$):** Analytical altitude integral uses midpoint exponential fallback $e^{-(z_1 + z_2)/(2H)}$ avoiding $0/0$ division.
5. **Clear Sky ($A_{\text{atm}} = 0\text{ dB}$):** $\Delta T_{\text{sky}} = 0.0\text{ K}$, $\Delta N_{\text{sky,dB}} = 0.0\text{ dB}$; receiver noise floor matches pure thermal $k_B T_0 B \cdot 10^{\text{NF}/10}$.
6. **Missing Altitudes in Legacy Unit Tests:** When `nodeAltM === undefined || acnAltM === undefined`, methods fall back to legacy sea-level constants ($0.012\text{ dB/km}$, full liquid rain path, $\Delta N_{\text{sky}} = 0$), guaranteeing 100% backward test compatibility.

---

## 8. Performance & Memory Budget

- **Inner Loop Allocation:** 0 dynamic array allocations during ray-marching, curvature derivative estimation, or Bullington slope tracking.
- **Worker CPU Time:** Added calculations require only scalar math ($+ \sim 0.05\text{ ms}$ per 16-node frame), well within the $20.0\text{ ms}$ budget.

---

## 9. Regression & Compatibility Guardrails

- `scripts/verify-project.mjs`: Line 104 asserts `this.tacScheduler = new TerrainAwareDynamicScheduler(0.008)`. The constructor signature and default rate remain locked.
- `src/tests/verifyPhysics.ts`: Test 1 (Timing Advance at 200 km) and Test 4 (Mountain Occlusion Outage) will continue passing identically.
- `src/tests/verifyRfBandwidth.ts`: Test 5 expects thermal noise floor without altitudes. Preserved identically.
- All 56 existing test suites remain untouched and passing.

---

## 10. Verification Strategy & Measurable Acceptance Criteria

### 10.1 New Verification Suite: `src/tests/verifyItuFirstPrinciples.ts`
Implement 5 comprehensive physical validation tests:
- **ITU-T1 (P.526-15 Crest Curvature Monotonicity):**  
  A sharp knife-edge crest ($R_{\text{crest}} \approx 2\text{ m}$) yields $T_{\text{crest}} < 2.0\text{ dB}$, while a broad crest ($R_{\text{crest}} \approx 300\text{ m}$) yields $T_{\text{crest}} > 8.0\text{ dB}$, monotonically increasing with $R_{\text{crest}}$.
- **ITU-T2 (P.526-15 Bullington Multi-Ridge Intersection):**  
  A dual-ridge terrain obstacle yields total diffraction loss strictly greater than either individual ridge alone, with calculated $s_{\text{bull}}$ lying between the two peaks.
- **ITU-T3 (P.676-13 Altitude-Integrated Absorption):**  
  A 20 km propagation link at Ladakh altitude ($3500\text{ m} \to 5500\text{ m}$) exhibits strictly lower gaseous absorption than an identical 20 km link at sea level ($0\text{ m} \to 500\text{ m}$) by $> 40\%$.
- **ITU-T4 (P.618-14 Sky-Noise Coupling):**  
  Under heavy rain ($25.0\text{ mm/hr}$), $\Delta T_{\text{sky}} > 0\text{ K}$, increasing `pNoiseDbm` by $\ge 0.5\text{ dB}$ and reducing SNR accordingly.
- **ITU-T5 (Physical Speed-of-Light Timing Advance):**  
  A terminal at slant range $d_{3\text{D}} = 14,989.6229\text{ m}$ produces $\tau_{\text{TA}} = 100.0\text{ }\mu\text{s}$ ($1.0 \times 10^{-4}\text{ s}$) within $\pm 10^{-9}\text{ s}$.

### 10.2 Complete Quality Gate Checklist
```bash
# Gate 1: Typecheck
npm run typecheck

# Gate 2: Structural Check
npm run verify

# Gate 3: New ITU First-Principles Physics Suite
npx vite-node src/tests/verifyItuFirstPrinciples.ts

# Gate 4: Full Test Runner (57/57 Suites Passing)
node scripts/run_all_verifications.mjs

# Gate 5: Playwright Multi-Viewport UX Verification
npm run verify:browser

# Gate 6: Production Build
npm run build
```

---

## 11. Acceptance Criteria Checklist

- [ ] `12.0 dB` hardcoded constant in `src/core/terrain.ts` replaced with physical $R_{\text{crest}}$ and ITU-R P.526-15 $T(m, n)$.
- [ ] Bullington multi-ridge equivalent knife-edge algorithm active in `src/core/terrain.ts`.
- [ ] ITU-R P.676-13 altitude-scaled gaseous absorption active in `src/core/linkBudget.ts`.
- [ ] ITU-R P.839-4 rain freezing ceiling ($4800\text{ m}$) active in `src/core/linkBudget.ts`.
- [ ] ITU-R P.618-14 sky-noise temperature integration active in `src/core/linkBudget.ts`.
- [ ] Physical speed-of-light timing advance active in `src/core/scheduler.ts`.
- [ ] `src/tests/verifyItuFirstPrinciples.ts` created and registered in `scripts/run_all_verifications.mjs` and `package.json`.
- [ ] All 57 test suites pass 100% with 0 regressions.
