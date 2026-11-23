# SPEC-WP10: Viewshed-vs-Live Link Parity Engine & WCAG 2.1 Accessible Status Encoding

**Specification Document:** `docs/specs/wp10-viewshed-parity-and-accessibility-encoding.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** Physical RF Simulation Parity / Quantitative Parity Auditing / W3C WCAG 2.1 AA Compliance / Viénot (1999) CVD Simulation / Redundant Non-Color Tactical Status Encoding  
**Applies to Modules:**
- `docs/specs/wp10-viewshed-parity-and-accessibility-encoding.md` (author spec)
- `src/core/viewshedEngine.ts` (extend with unified RF parity evaluation & quantitative parity auditor; maintain 100% backward compatibility)
- `src/ui/accessibilityEncoding.ts` (create WCAG 2.1 luminance/contrast verifier, CVD simulation check, Okabe-Ito colorblind-safe encodings, redundant visual indicators, and XSS-safe badge renderer)
- `src/tests/verifyViewshedParityAndAccessibility.ts` (create — Suite 94)
- `package.json` (register `verify:viewshed-accessibility`)
- `scripts/run_all_verifications.mjs` (register Suite 94 `verify:viewshed-accessibility`)

---

## 1. Executive Summary & Problem Formulation

### 1.1 Context & Motivation
The Tactical X-Band Air-to-Ground Network Digital Twin features two critical capabilities that require scientific alignment and accessibility rigor:

1. **Physical Divergence between Viewshed Grid & Live Link Evaluation:**
   The Polar Viewshed Engine (`src/core/viewshedEngine.ts`) computes real-time 360° coverage across 576 polar cells to guide UAV positioning and relay deployment. Concurrently, the authoritative discrete-event loop (`src/worker/simWorker.ts`) invokes `LinkBudgetEngine.evaluateLink(...)` to determine physical received power ($P_{\text{rx}}$), SINR, adaptive DVB-S2X MODCOD state, and achievable throughput for live tactical nodes.
   Historically, the viewshed calculation utilized discrete approximations and heuristics (such as fixed 35 dB obstacle loss and fixed 45 dB shadow fallback) that deviated from the live link budget engine. This introduced discrepancies in coverage classification between the map viewshed overlay and actual node link states.

2. **C2 Visual Accessibility & Colorblind Operability (WCAG 2.1 SC 1.4.1 / SC 1.4.3):**
   Tactical Command & Control (C2) situational displays frequently communicate link status using red/yellow/green color codes on dark console themes (`#0b1117` and `#0f172a`). For operators with Color Vision Deficiency (CVD)—affecting ~8% of males (Deuteranopia, Protanopia, Tritanopia)—distinguishing between green, amber, orange, and red purely by hue is impossible. Furthermore, military C2 software standards require WCAG 2.1 Level AA contrast ($\ge 4.5:1$) for dark-mode readability and strict non-color redundant encoding (stroke dash patterns, geometric glyphs, unicode symbols, short text codes, and ARIA labels) to ensure zero information loss under monochromy or CVD.

---

## 2. Viewshed-vs-Live-Link Physical Divergence & Parity Alignment

### 2.1 Exact Divergence Matrix

| Physical Phenomenon | Legacy Fast Viewshed (`computeCellSinr`) | Authoritative Live Link (`evaluateLink`) | Parity Alignment Architecture |
| :--- | :--- | :--- | :--- |
| **Free-Space Path Loss (FSPL)** | Friis equation at $f_c = 8.0\text{ GHz}$ | Friis equation at $f_c = 8.0\text{ GHz}$ | **Identical**: Exact shared static formula `LinkBudgetEngine.computeFsplDb`. |
| **Atmospheric Gas Loss** | ITU-R P.676 altitude integrated ($h_o=6\text{ km}, h_w=2\text{ km}$) | ITU-R P.676 altitude integrated ($h_o=6\text{ km}, h_w=2\text{ km}$) | **Identical**: Shared static formula `LinkBudgetEngine.computeGaseousAttenuationDb`. |
| **Hydrometeor Rain Loss** | ITU-R P.838 / P.839 ($k_H=0.00411, \alpha_H=1.390, h_R=4800\text{ m}$) | ITU-R P.838 / P.839 with freezing height liquid partition | **Identical**: Shared static formula `LinkBudgetEngine.computeRainAttenuationDb`. |
| **Terrain Diffraction** | ITU-R P.526 Bullington / Knife-Edge, step = 150 m | ITU-R P.526 Bullington / Knife-Edge, step = 100 m | Parity mode aligns step interval and passes `crestRadiusM` & `curvatureLossDb`. |
| **CAD Obstacle Occlusion** | Fixed heuristic penalty: `diffLossDb = 35.0 dB` | Explicit `obstacleBlocked: true` $\rightarrow$ `isOutage: true`, `modcod = LINK_OUTAGE` | Parity mode marks explicit obstacle outage matching live `LinkBudgetEngine` behavior. |
| **Shadow / Out of Coverage** | Fixed heuristic penalty: `diffLossDb = 45.0 dB` | Fail-safe classification `isLos: false`, $P_{\text{rx}}$ below threshold | Parity mode invokes `evaluateLink` directly, mapping outage states consistently. |
| **Antenna Gain & Roll-off** | 4-sector roll-off calculated inline | `QuadSectorAntennaEngine.evaluateNodeSector(...)` | Parity mode delegates to authoritative sector evaluation or equivalent 4-sector roll-off. |
| **Sky Noise & Receiver Noise** | Thermal floor + ITU-R P.618 sky noise increase | Thermal floor + ITU-R P.618 sky noise increase + Jammer | **Identical**: Direct invocation of `evaluateLink` unifies noise floor and jamming. |

### 2.2 Parity Mode Design & Quantitative Auditor

1. **Evaluation Seam (`evaluateViewshedPointWithParity`):**
   ```ts
   public evaluateViewshedPointWithParity(
     target: Position3D | { worldBearingDeg: number; rangeM: number },
     acnPos: Position3D,
     acnVel: Position3D,
     terrain: TerrainEngine,
     rf: RFConfig,
     env: EnvironmentConfig,
     options?: ViewshedParityOptions
   ): ViewshedParityResult;
   ```
   Directly evaluates the path through `terrain.evaluateTerrainObstruction(...)` and `linkBudgetEngine.evaluateLink(...)` to achieve zero physical delta ($\le 0.001\text{ dB}$) against live links under identical conditions.

2. **Parity Auditor (`auditViewshedLinkBudgetParity`):**
   ```ts
   export function auditViewshedLinkBudgetParity(
     viewshedSamples: readonly (number | { snrDb?: number; sinrDb?: number; isOutage?: boolean })[],
     liveLinkSamples: readonly (number | { snrDb?: number; sinrDb?: number; isOutage?: boolean })[],
     linkMarginThresholdDb: number = -1.5
   ): ViewshedParityAuditReport;
   ```
   Computes:
   - `sampleCount`: Total valid finite sample pairs.
   - `maxAbsErrorDb`: $\max_i |\text{SINR}_{\text{view}, i} - \text{SINR}_{\text{live}, i}|$.
   - `meanAbsErrorDb`: $\frac{1}{N} \sum_i |\text{SINR}_{\text{view}, i} - \text{SINR}_{\text{live}, i}|$.
   - `rmseDb`: $\sqrt{\frac{1}{N} \sum_i (\text{SINR}_{\text{view}, i} - \text{SINR}_{\text{live}, i})^2}$.
   - `biasDb`: $\frac{1}{N} \sum_i (\text{SINR}_{\text{view}, i} - \text{SINR}_{\text{live}, i})$.
   - `classificationAgreementRate`: Fraction $[0, 1]$ where both channels agree on operational vs outage.
   - `disagreementIndices`: Indices where classification diverges.
   - Robust guards: handles empty inputs, mismatched lengths, and non-finite values safely without throwing.

---

## 3. WCAG 2.1 Luminance, Contrast & CVD Mathematical Formulations

### 3.1 Relative Luminance (W3C WCAG 2.1)
For an sRGB hex color `#RRGGBB`, extract $R, G, B \in [0, 255]$ and normalize to $c = R/255, G/255, B/255$.
Linearize each component via the exact W3C threshold:
$$c_{\text{lin}} = \begin{cases} \frac{c}{12.92} & \text{if } c \le 0.04045 \\ \left(\frac{c + 0.055}{1.055}\right)^{2.4} & \text{if } c > 0.04045 \end{cases}$$

The relative luminance $L \in [0, 1]$ is:
$$L = 0.2126 \cdot R_{\text{lin}} + 0.7152 \cdot G_{\text{lin}} + 0.0722 \cdot B_{\text{lin}}$$

### 3.2 WCAG 2.1 Contrast Ratio
Given foreground luminance $L_{\text{fg}}$ and background luminance $L_{\text{bg}}$:
$$\text{Contrast Ratio} = \frac{\max(L_{\text{fg}}, L_{\text{bg}}) + 0.05}{\min(L_{\text{fg}}, L_{\text{bg}}) + 0.05} \in [1.0, 21.0]$$
- Level **AA**: $\text{Contrast} \ge 4.5:1$ (normal text/icons).
- Level **AAA**: $\text{Contrast} \ge 7.0:1$.
- Level **AA-large**: $\text{Contrast} \ge 3.0:1$ (large text / graphical UI indicators per SC 1.4.11).

### 3.3 Viénot, Brettel, & Mollon (1999) CVD Simulation Matrices
To simulate human dichromatic vision in linearized sRGB space:

$$\begin{bmatrix} R' \\ G' \\ B' \end{bmatrix}_{\text{deuteranopia}} = \begin{bmatrix} 0.29275 & 0.70725 & 0.0 \\ 0.29275 & 0.70725 & 0.0 \\ -0.02234 & 0.02234 & 1.0 \end{bmatrix} \begin{bmatrix} R_{\text{lin}} \\ G_{\text{lin}} \\ B_{\text{lin}} \end{bmatrix}$$

$$\begin{bmatrix} R' \\ G' \\ B' \end{bmatrix}_{\text{protanopia}} = \begin{bmatrix} 0.11238 & 0.88762 & 0.0 \\ 0.11238 & 0.88762 & 0.0 \\ 0.00401 & -0.00401 & 1.0 \end{bmatrix} \begin{bmatrix} R_{\text{lin}} \\ G_{\text{lin}} \\ B_{\text{lin}} \end{bmatrix}$$

$$\begin{bmatrix} R' \\ G' \\ B' \end{bmatrix}_{\text{tritanopia}} = \begin{bmatrix} 1.0 & 0.14464 & -0.14464 \\ 0.0 & 0.85923 & 0.14077 \\ 0.0 & 0.85923 & 0.14077 \end{bmatrix} \begin{bmatrix} R_{\text{lin}} \\ G_{\text{lin}} \\ B_{\text{lin}} \end{bmatrix}$$

After linear transformation, components are clamped to $[0, 1]$ and delinearized via sRGB gamma companding:
$$c_{\text{srgb}} = \begin{cases} 12.92 \cdot c' & \text{if } c' \le 0.0031308 \\ 1.055 \cdot (c')^{1/2.4} - 0.055 & \text{if } c' > 0.0031308 \end{cases}$$

### 3.4 CIE76 Perceptual Distance ($\Delta E^*$)
Colors are converted from sRGB to CIE $1931\text{ XYZ}$ (Standard Illuminant $D_{65}$, $X_n=0.95047, Y_n=1.00000, Z_n=1.08883$), then to CIE $L^*a^*b^*$.
The perceptual color difference is computed as:
$$\Delta E^* = \sqrt{(\Delta L^*)^2 + (\Delta a^*)^2 + (\Delta b^*)^2}$$
A threshold of $\Delta E^* > 15.0$ guarantees distinct visual separation under full dichromacy.

---

## 4. Canonical Tactical Status Encodings & Redundant Identifiers

### 4.1 State Definitions & Visual Mapping Table

| Tactical Status | Standard Color | Colorblind-Safe (Okabe-Ito Inspired) | Contrast vs `#0b1117` | Contrast vs `#0f172a` | Canvas / SVG `strokeDash` | Geometric `glyph` | Unicode `iconChar` | Short Code | ARIA Accessible Label |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`OPTIMAL`** | `#22c55e` | `#4ade80` | **10.89 : 1** | **10.25 : 1** | `[]` (solid) | `circle` | `●` | `OPT` | `Link Optimal (Clear Line-of-Sight)` |
| **`DEGRADED`** | `#eab308` | `#facc15` | **12.39 : 1** | **11.66 : 1** | `[8, 4]` (long dash) | `triangle` | `▲` | `DEG` | `Link Degraded (Fresnel Encroachment / Marginal Margin)` |
| **`CRITICAL`** | `#f97316` | `#fb923c` | **8.38 : 1** | **7.89 : 1** | `[3, 3]` (dotted) | `diamond` | `◆` | `CRIT` | `Link Critical (Demodulation Limit / Severe Attenuation)` |
| **`OUTAGE`** | `#ef4444` | `#ec4899` | **5.38 : 1** | **5.06 : 1** | `[12, 4, 3, 4]` (dash-dot) | `cross` | `✕` | `OUT` | `Link Outage (Physical Blockage or Path Loss Outage)` |
| **`RELAY_ACTIVE`** | `#3b82f6` | `#818cf8` | **6.36 : 1** | **5.98 : 1** | `[6, 3, 2, 3, 2, 3]` (dash-double-dot) | `hexagon` | `⬡` | `RLY` | `Relay Active (Two-Hop Tactical Routing)` |

*Note: All 5 colorblind-safe colors achieve $\ge 4.5:1$ contrast against dark consoles `#0b1117` and `#0f172a`, and every pairwise combination achieves simulated $\Delta E^* \ge 19.57 > 15.0$ under Deuteranopia, Protanopia, and Tritanopia.*

### 4.2 XSS-Safe Accessible Badge Renderer
`renderAccessibleStatusBadge(status, label?, mode = 'colorblind-safe')` generates a structured HTML badge:
- Integrates `src/ui/domSafety.ts` (`safeHtml`, `escapeHtml`, `sanitizeCssColor`, `escapeAttr`).
- Emits `role="status"` and `aria-label` for screen reader compliance.
- Safely neutralizes malicious payloads (e.g. `<script>alert(1)</script>`).
- Encapsulates non-color identifiers (`iconChar` + `shortCode`) so meaning is never communicated solely by color.

---

## 5. Verification Plan (Suite 94)

1. **Parity Physical Verification:**
   Run parallel evaluations of 24 representative coordinates (LoS, ridge diffraction, heavy rain $25\text{ mm/hr}$, CAD obstacle) via both `viewshedEngine.ts` and `LinkBudgetEngine`. Verify $\text{maxAbsErrorDb} \le 1.5\text{ dB}$, $\text{rmseDb} \le 1.0\text{ dB}$, and $\text{classificationAgreementRate} \ge 0.95$.
2. **WCAG 2.1 Color Math Checks:**
   Verify analytical contrast: `#ffffff` vs `#000000` $= 21.000 \pm 0.001$, identical colors $= 1.000$. Verify all 5 colorblind-safe states pass $\ge 4.5:1$ contrast against `#0b1117` and `#0f172a`.
3. **CVD Simulation & Pairwise Separation:**
   Verify pairwise $\Delta E^* > 15.0$ under Deuteranopia, Protanopia, and Tritanopia across all 5 states.
4. **Redundant Visual Uniqueness:**
   Verify 5/5 unique `strokeDash`, 5/5 unique `glyph`, 5/5 unique `shortCode`, non-empty `ariaLabel`.
5. **Security & Edge Cases:**
   Verify XSS sanitization in badge rendering and graceful handling of empty/invalid inputs.
6. **Performance Budget:**
   Micro-benchmark 50,000 encoding and WCAG lookups in $< 50\text{ ms}$ ($< 1\text{ µs/call}$).
