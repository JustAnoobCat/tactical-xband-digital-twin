# SPEC-WP04: ITU-R P.526-15 Multi-Edge Diffraction Engine (Bullington & Cascaded Deygout)

**Specification Document:** `docs/specs/wp04-itur526-multiedge-diffraction.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** RF Propagation / Physical Rigor / Electromagnetic Diffraction  
**Applies to Modules:** `src/core/rfPropagationMath.ts`, `src/core/linkBudget.ts`, `src/tests/verifyMultiEdgeDiffraction.ts`  

---

## 1. Executive Summary & Problem Formulation

### 1.1 Context & Background
In airborne tactical network operations within high-relief mountainous topography (such as the Ladakh theater at $34.5^\circ\text{N}, 76.5^\circ\text{E}$), radio line-of-sight between tactical ground nodes and Airborne Communications Nodes (ACN) is frequently obstructed by multiple topographic obstacles in cascade:
1. **Multiple Mountain Ridges:** High alpine passes and jagged valleys where transmission paths traverse two or more successive mountain ridges.
2. **Compound Obstructions (Terrain Ridge + CAD Structures):** Links where a natural terrain ridge is combined with discrete man-made obstacles (e.g., tactical FOB buildings, radar towers, extruded CAD barriers).

### 1.2 Limitation of Single Knife-Edge Model
The legacy single knife-edge diffraction implementation computes only the single dominant obstacle apex ($\nu_{\max}$) relative to the direct transmitter-receiver chord:
$$L_{\text{diff}} = J(\nu_{\max})$$
While computationally trivial, single-edge diffraction substantially underestimates diffraction attenuation in multi-obstacle environments:
- For two equal knife-edge obstacles at $d/3$ and $2d/3$ with $\nu \approx 1\text{--}3$, textbook physical diffraction (Epstein-Peterson / Cascaded Deygout / ITU-R P.526) induces **6 to 14 dB** of additional attenuation compared to a single knife edge.
- Treating multiple cascading obstacles as a single knife edge results in over-optimistic link budget calculations, erroneously assigning high-throughput MODCODs to severely degraded or blocked links.

### 1.3 Core Objectives of WP-04
1. **Preserve Authoritative Single-Edge Primitives:** Maintain `computeKnifeEdgeDiffractionLossDb(nu)` verbatim to ensure 100% backward compatibility.
2. **ITU-R P.526-15 §4.5.1 Bullington Equivalent Knife-Edge:** Implement the full double-horizon Bullington method over discrete path elevation profiles, including effective Earth curvature bulge $b_i = \frac{d_i(d - d_i)}{2 k R_e}$ and horizon ray intersection.
3. **ITU-R P.526-15 §4.5 Cascaded Deygout Engine:** Implement the 3-edge Cascaded Deygout diffraction engine (Primary $m$, Left Secondary $s_1$, Right Secondary $s_2$) with sub-path geometry partitioning.
4. **Anti-Shoulder Double-Counting Guard:** Enforce local-peak and prominence/valley filtering to prevent discrete raymarch samples on the slope of a single smooth Gaussian hill from being falsely counted as independent secondary knife-edges.
5. **Close-Edge Spacing Correction:** Apply the ITU-R P.526 / Causebrook edge-spacing correction factor $C$ to bound total loss physically between $\max(J(\nu_m), L_{\text{Bullington}})$ and realistic physical limits.
6. **Allocation-Minimal 50 Hz Loop Protection:** Process parallel typed/numeric arrays without per-tick object allocations, guaranteeing microsecond-level execution ($< 20\,\mu\text{s}$ per link).
7. **Clean Link Budget Integration:** Wire the multi-edge diffraction engine into `src/core/linkBudget.ts` with model configuration options (`'deygout-multiedge' | 'bullington' | 'single-edge'`) and full backward compatibility across all 86 pre-existing verification suites.

---

## 2. Mathematical Rigor & Formulations

### 2.1 ITU-R P.526-15 Single Knife-Edge Diffraction $J(\nu)$
The standard ITU-R P.526-15 approximation for Fresnel knife-edge diffraction loss $J(\nu)$ in dB as a function of the dimensionless Fresnel-Kirchhoff parameter $\nu$:

$$J(\nu) = \begin{cases}
0.0\text{ dB} & \text{if } \nu \le -0.78 \\
6.9 + 20 \log_{10}\left(\sqrt{(\nu - 0.1)^2 + 1} + \nu - 0.1\right)\text{ dB} & \text{if } \nu > -0.78
\end{cases}$$

At grazing incidence ($\nu = 0$), $J(0) = 6.9 + 20\log_{10}(\sqrt{1.01} - 0.1) \approx 6.033\text{ dB}$.

### 2.2 Profile Geometry & Effective Earth Curvature Bulge
Given a path profile of $N$ samples with horizontal distances $d_i$ from Tx ($d_0 = 0, d_{N-1} = d$) and total elevations $h_i$ (combining terrain and CAD obstacle heights above MSL):
- Transmitter at $(0, h_0)$
- Receiver at $(d, h_{N-1})$
- Effective Earth radius: $a_e = k R_e$ (default $k = 4/3$, $R_e = 6\,371\,000\text{ m}$)
- Effective Earth curvature bulge arched into the profile at sample $i$:
  $$b_i = \frac{d_i (d - d_i)}{2 a_e}$$
- Effective obstacle elevation at sample $i$:
  $$h_i^{\text{eff}} = h_i + b_i$$
- Direct line-of-sight (chord) height at distance $d_i$:
  $$h_{\text{los}}(d_i) = h_0 + \frac{d_i}{d} (h_{N-1} - h_0)$$

---

### 2.3 ITU-R P.526-15 §4.5.1 Bullington Equivalent Knife-Edge
The Bullington method constructs an equivalent knife-edge obstacle at the intersection of the maximum horizon rays from transmitter and receiver:

1. **Horizon Tangents:**
   - Tx forward horizon slope:
     $$S_{t, i} = \frac{h_i^{\text{eff}} - h_0}{d_i}, \quad S_{\text{tim}} = \max_{1 \le i \le N-2} S_{t, i}$$
   - Rx backward horizon slope:
     $$S_{r, i} = \frac{h_i^{\text{eff}} - h_{N-1}}{d - d_i}, \quad S_{\text{rim}} = \max_{1 \le i \le N-2} S_{r, i}$$
   - Direct path slope:
     $$S_{\text{tr}} = \frac{h_{N-1} - h_0}{d}$$

2. **Line-of-Sight Case ($S_{\text{tim}} < S_{\text{tr}}$):**
   When the horizon rays do not intersect above the direct line:
   - For each intermediate sample $i \in [1, N-2]$, calculate clearance above LOS:
     $$\Delta h_i = h_i^{\text{eff}} - h_{\text{los}}(d_i)$$
   - Calculate Fresnel parameter:
     $$\nu_i = \Delta h_i \sqrt{\frac{2}{\lambda} \left(\frac{1}{d_i} + \frac{1}{d - d_i}\right)}$$
   - Worst-case diffraction parameter: $\nu_{\max} = \max_i \nu_i$.
   - Bullington loss: $L_{\text{Bull}} = J(\nu_{\max})$.

3. **Non-Line-of-Sight Case ($S_{\text{tim}} \ge S_{\text{tr}}$):**
   The two horizon rays intersect at distance $d_b$ and elevation $h_b$:
   - Intersection distance:
     $$d_b = \frac{h_{N-1} - h_0 + S_{\text{rim}} d}{S_{\text{tim}} + S_{\text{rim}}}$$
     Clamped safely inside $(0, d)$: $d_b = \text{clamp}(d_b, 10^{-3}, d - 10^{-3})$.
   - Intersection apex height:
     $$h_b = h_0 + S_{\text{tim}} d_b$$
   - Effective apex height above direct LOS:
     $$h_{\text{apex}} = h_b - \left(h_0 + \frac{d_b}{d}(h_{N-1} - h_0)\right)$$
   - Equivalent Bullington Fresnel parameter:
     $$\nu_b = h_{\text{apex}} \sqrt{\frac{2}{\lambda} \left(\frac{1}{d_b} + \frac{1}{d - d_b}\right)}$$
   - Bullington loss:
     $$L_{\text{Bull}} = J(\nu_b)$$

---

### 2.4 ITU-R P.526-15 §4.5 Cascaded Deygout Multi-Edge Diffraction

Deygout's cascaded knife-edge method identifies the principal obstacle $m$ along the overall path, divides the path into sub-paths, and calculates secondary diffraction over each sub-path:

#### Step 1: Principal Knife-Edge ($m$)
Across all interior samples $i \in [1, N-2]$:
$$\nu_i = \left(h_i^{\text{eff}} - h_{\text{los}}(d_i)\right) \sqrt{\frac{2}{\lambda}\left(\frac{1}{d_i} + \frac{1}{d - d_i}\right)}$$
$$m = \arg\max_{1 \le i \le N-2} \nu_i, \quad \nu_m = \max_i \nu_i$$

- If $\nu_m \le -0.78$: The path has pristine Fresnel clearance. Return $0.0\text{ dB}$ immediately.
- Otherwise: Primary knife-edge loss is $L_1 = J(\nu_m)$.

#### Step 2: Anti-Shoulder Guard & Secondary Candidate Qualification
On a discretized continuous hill (e.g. Gaussian ridge sampled at 50 m intervals), points adjacent to the summit ($m \pm 1, m \pm 2$) lie on the slope of the *same* mountain. Treating them as secondary knife edges causes spurious double/triple-counting of diffraction loss.

To qualify as an independent secondary knife edge, a candidate index $i$ must satisfy:
1. **Local Peak Condition:**
   $$h_i \ge h_{i-1} \quad \text{and} \quad h_i \ge h_{i+1}$$
   (or a discrete CAD obstacle step where height strictly exceeds neighbors).
2. **Prominence / Valley Separation:**
   Between candidate $i$ and principal peak $m$, there must exist a physical valley or clearance depression:
   $$\min_{k \in (\min(i, m), \max(i, m))} h_k < \min(h_i, h_m)$$
   This ensures that continuous smooth hills have exactly zero secondary candidates, matching single-edge physics perfectly.

#### Step 3: Secondary Knife-Edge Evaluation on Sub-Paths
- **Sub-Path 1 (Tx $\to$ Primary Peak $m$):**
  - Sub-path length: $D_1 = d_m$
  - Sub-path Earth bulge at sample $i \in (0, m)$:
    $$b_{1, i} = \frac{d_i (D_1 - d_i)}{2 a_e}$$
  - Sub-path chord height:
    $$h_{\text{chord}, 1}(d_i) = h_0 + \frac{d_i}{D_1} (h_m^{\text{eff}} - h_0)$$
  - Sub-path clearance parameter:
    $$\nu_{1, i} = \left(h_i + b_{1, i} - h_{\text{chord}, 1}(d_i)\right) \sqrt{\frac{2}{\lambda}\left(\frac{1}{d_i} + \frac{1}{D_1 - d_i}\right)}$$
  - Select candidate $s_1$ maximizing $\nu_{1, i}$ among qualified local peaks.
  - If $\nu_{s1} > -0.78$, secondary left loss is $L_{s1} = J(\nu_{s1})$; otherwise $L_{s1} = 0.0\text{ dB}$.

- **Sub-Path 2 (Primary Peak $m \to$ Rx):**
  - Sub-path length: $D_2 = d - d_m$
  - For sample $j \in (m, N-1)$, relative distance $d_{2, j} = d_j - d_m$:
  - Sub-path Earth bulge:
    $$b_{2, j} = \frac{d_{2, j} (D_2 - d_{2, j})}{2 a_e}$$
  - Sub-path chord height:
    $$h_{\text{chord}, 2}(d_{2, j}) = h_m^{\text{eff}} + \frac{d_{2, j}}{D_2} (h_{N-1} - h_m^{\text{eff}})$$
  - Sub-path clearance parameter:
    $$\nu_{2, j} = \left(h_j + b_{2, j} - h_{\text{chord}, 2}(d_{2, j})\right) \sqrt{\frac{2}{\lambda}\left(\frac{1}{d_{2, j}} + \frac{1}{D_2 - d_{2, j}}\right)}$$
  - Select candidate $s_2$ maximizing $\nu_{2, j}$ among qualified local peaks.
  - If $\nu_{s2} > -0.78$, secondary right loss is $L_{s2} = J(\nu_{s2})$; otherwise $L_{s2} = 0.0\text{ dB}$.

#### Step 4: Spacing Correction & Total Attenuation
When multiple diffraction edges are close together, direct summation of knife-edge losses $L_1 + L_{s1} + L_{s2}$ overestimates attenuation because the diffraction zones overlap. The ITU-R P.526 / Causebrook spacing correction factor $C$ compensates for inter-edge spacing:

For each active secondary edge $k \in \{1, 2\}$ with separation distance $d_{\text{sep}}$ and sub-path baseline $D_k$:
$$\beta_k = \sqrt{\frac{d_{\text{sep}} \cdot d}{d_m (d - d_m)}}$$
$$C_k = \text{clamp}\left(10.0 \cdot \exp(-1.5 \beta_k), \; 0.0, \; 0.85 \cdot L_{sk}\right)$$

Total multi-edge diffraction loss is bounded:
$$L_{\text{total}} = \max\left(L_1, \; L_{\text{Bull}}, \; \min\left(60.0\text{ dB}, \; L_1 + \max(0, L_{s1} - C_1) + \max(0, L_{s2} - C_2)\right)\right)$$

This formulation rigorously satisfies the four fundamental boundary conditions:
1. **Pristine LOS:** $\nu_m \le -0.78 \implies 0.0\text{ dB}$.
2. **Single Knife-Edge or Smooth Gaussian Mountain:** No secondary peaks qualify $\implies L_{\text{total}} = J(\nu_m)$.
3. **Two Equal Knife-Edges at $d/3$ and $2d/3$:** Both peaks qualify $\implies L_{\text{total}} > J(\nu_m)$ by the textbook $\sim 6\text{--}14\text{ dB}$ secondary margin.
4. **Natural Ridge + CAD Building:** Accurately accounts for building obstruction in addition to terrain ridge diffraction.

---

## 3. Architecture & Interface Contracts

### 3.1 Profile Input Contract
To ensure zero GC allocations in the 50 Hz discrete simulation loop, profiles are passed as parallel numeric arrays:
```typescript
export interface ProfileDiffractionInput {
  readonly distancesM: ArrayLike<number>;  // Monotonically increasing from 0 to d
  readonly elevationsM: ArrayLike<number>; // MSL elevation (terrain + CAD height)
  readonly wavelengthM?: number;           // Carrier wavelength (default 8.0 GHz: ~0.037474 m)
  readonly kFactor?: number;               // Effective Earth k-factor (default 4/3)
  readonly earthRadiusM?: number;          // True Earth radius (default 6,371,000 m)
}
```

### 3.2 Result Data Structures
```typescript
export interface BullingtonDiffractionResult {
  readonly lossDb: number;
  readonly nuApex: number;
  readonly apexDistM: number;
  readonly apexElevMslM: number;
  readonly isLos: boolean;
}

export interface DeygoutMultiEdgeResult {
  readonly totalLossDb: number;
  readonly primaryNu: number;
  readonly primaryLossDb: number;
  readonly primaryEdgeIndex: number;
  readonly primaryEdgeDistM: number;
  readonly secondaryLeftNu: number;
  readonly secondaryLeftLossDb: number;
  readonly secondaryLeftIndex: number;
  readonly secondaryRightNu: number;
  readonly secondaryRightLossDb: number;
  readonly secondaryRightIndex: number;
  readonly secondaryEdgeCount: number;
  readonly bullingtonLossDb: number;
  readonly correctionDb: number;
  readonly method: 'deygout-multiedge' | 'bullington' | 'single-edge';
}
```

### 3.3 LinkBudgetEngine Integration
`LinkBudgetEngine` supports profile-based diffraction evaluation via:
```typescript
public static computeProfileDiffraction(
  distancesM: ArrayLike<number>,
  elevationsM: ArrayLike<number>,
  wavelengthM?: number,
  kFactor?: number,
  earthRadiusM?: number,
  model?: 'deygout-multiedge' | 'bullington' | 'single-edge'
): DeygoutMultiEdgeResult;
```
Existing `evaluateLink` calls remain fully compatible by passing pre-computed `diffractionLossDb` directly, with an optional profile overload for end-to-end evaluation.

---

## 4. Verification & Validation Strategy

The verification suite `src/tests/verifyMultiEdgeDiffraction.ts` tests 8 mandatory verification gates:
1. **Pristine LOS:** Confirm $0.0\text{ dB}$ across all models when all points have clearance $> 0.6$ Fresnel radius.
2. **Single Sharp Knife-Edge:** Confirm Deygout matches single-edge $J(\nu)$ within $10^{-6}\text{ dB}$.
3. **Single Smooth Gaussian Hill:** 256 samples forming a smooth bell curve. Confirm anti-shoulder guard detects 0 secondary edges and loss equals single-edge peak $J(\nu_m)$.
4. **Two Equal Knife-Edges ($d/3$ and $2d/3$):** Confirm secondary edge detected, Deygout loss strictly exceeds single-edge $J(\nu_m)$ by $6\text{--}14\text{ dB}$, and exceeds Bullington appropriately.
5. **Three Knife-Edges (Main + Left + Right):** Confirm primary and both left/right secondary edges detected (`secondaryEdgeCount === 2`).
6. **Compound Terrain Ridge + Tactical CAD Obstacle:** End-to-end validation through `LinkBudgetEngine` proving CAD building adds realistic secondary diffraction on top of terrain blockage.
7. **Degenerate Edge Cases:** $N < 3$ samples, identical coordinates, zero distance, negative distances, NaN safety.
8. **Performance & 50 Hz Loop Budget:** 1,000 invocations over 256-sample profiles complete in $< 20\text{ ms}$ total ($< 20\,\mu\text{s}$ per link).
