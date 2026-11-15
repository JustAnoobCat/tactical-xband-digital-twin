# Specification: Atmospheric Refractivity Gradient, Bullington Horizon Tangents & Multi-Order Fresnel Path Profiling

**Specification Identifier:** `SPEC-PATH-PROFILE-BULLINGTON-REFRACTIVITY-UPGRADE.md`  
**Author:** Role 1 Engineering Planner / Systems Architect  
**Reviewer Verdict / Sign-off:** `APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)`  
**Applicable Standards:** ITU-R P.834-9, ITU-R P.526-15 §4.5.1, SPLAT! RF Engineering Suite, Radio Mobile CAD  
**Implementation Seam:** `src/core/config.ts`, `src/core/terrain.ts`, `src/core/linkProfile.ts`, `src/core/profileEngine.ts`, `src/shared/workerProtocol.ts`, `src/worker/simWorker.ts`, `src/ui/linkProfileViewport.ts`, `index.html`  

---

## 1. Executive Summary & Operational Context

In mountainous high-altitude tactical communications (Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$), radio wave propagation along air-to-ground links is governed by two interacting physical phenomena:
1. **Vertical Atmospheric Refractivity Gradients ($\frac{dN}{dh}$)**: Barometric lapse rates, temperature inversions, and tropospheric moisture layers curve electromagnetic rays relative to the Earth's physical curvature. Under ITU-R standard conditions, rays bend downward with an effective Earth radius factor $K = 4/3 \approx 1.333$ ($\frac{dN}{dh} = -39.25\text{ N-units/km}$), effectively flattening the Earth. However, under sub-refractive ducting inversions ($K \le 0.80$, $\frac{dN}{dh} \ge +39\text{ N/km}$) or super-refractive trapping ($K \ge 2.00$, $\frac{dN}{dh} \le -78\text{ N/km}$), the apparent Earth bulge alters clearance over high alpine ridgelines by several metres, turning grazing line-of-sight links into hard knife-edge shadow occlusions.
2. **Multi-Ridge Knife-Edge Diffraction Geometry (Bullington Double-Horizon Method)**: When multiple mountain ridges obstruct or intrude into the propagation path, the authoritative ITU-R P.526-15 §4.5.1 standard replaces multiple discrete knife-edges with a single equivalent virtual knife-edge constructed at the intersection of the radio horizon tangent rays from the transmitter and receiver terminals.

This specification upgrades the Tactical X-Band Air-to-Ground Network Digital Twin with first-principles variable refractivity modeling, interactive SPLAT!/Radio Mobile-grade path profile visualization, visual Bullington horizon tangent rays and virtual apex rendering, multi-order Fresnel zone envelopes ($F_1, F_2, F_3$), and interactive sample-by-sample crosshair telemetry inspection.

---

## 2. Mathematical & Physical Formulations

### 2.1 ITU-R P.834-9 Atmospheric Refractivity & Effective Earth Radius ($K$-Factor)

The radio refractive index $n$ of the troposphere is expressed in radio refractivity units $N = (n - 1) \times 10^6$. The curvature of a radio ray $\rho^{-1}$ relative to true Earth radius $R_E = 6,371,000\text{ m}$ defines the effective Earth radius $R_{\text{eff}} = K \cdot R_E$, where $K$ is the effective Earth radius factor:
$$K = \frac{1}{1 + R_E \cdot 10^{-6} \cdot \frac{dN}{dh}} \approx \frac{1}{1 + \frac{1}{157} \frac{dN}{dh}}$$

Inverting this fundamental relation gives the vertical refractivity gradient $\frac{dN}{dh}$ in $\text{N-units/km}$ as a function of the operational $K$-factor:
$$\frac{dN}{dh} = 157.0 \cdot \left(\frac{1}{K} - 1.0\right) \text{ [N-units/km]}$$

#### Operational Refractivity Regimes:
1. **Sub-Refractive Ducting Inversion ($K = 0.80$):**
   $$\frac{dN}{dh} = 157.0 \cdot \left(\frac{1}{0.80} - 1.0\right) = +39.25 \text{ N/km}$$
   Rays bend upward away from the Earth surface, amplifying apparent Earth curvature bulge and increasing obstruction over grazing ridgelines.
2. **High-Altitude Dry Alpine ($K = 1.18$):**
   $$\frac{dN}{dh} = 157.0 \cdot \left(\frac{1}{1.18} - 1.0\right) = -23.95 \text{ N/km}$$
   Typical for cold, dry Himalayan winter atmosphere with reduced moisture lapse rate.
3. **ITU-R Standard Atmosphere ($K = 4/3 \approx 1.3333333333333333$):**
   $$\frac{dN}{dh} = 157.0 \cdot \left(\frac{3}{4} - 1.0\right) = -39.25 \text{ N/km}$$
   The global ITU-R baseline standard for temperate continental climates.
4. **Super-Refractive Layer ($K = 2.00$):**
   $$\frac{dN}{dh} = 157.0 \cdot \left(\frac{1}{2.00} - 1.0\right) = -78.50 \text{ N/km}$$
   Enhanced downward ray bending, flattening Earth curvature and restoring link clearance across previously shadowed valleys.
5. **Tropospheric Trapping ($K = 4.00$):**
   $$\frac{dN}{dh} = 157.0 \cdot \left(\frac{1}{4.00} - 1.0\right) = -117.75 \text{ N/km}$$
   Severe atmospheric ducting; radio horizon extended significantly beyond geometric horizon.

### 2.2 Analytical Earth Curvature Bulge

Along a link of 3D length $D$ (metres), the geometric Earth bulge $\Delta h(s)$ at distance $s$ from the transmitter ($0 \le s \le D$) is:
$$\Delta h(s) = \frac{s \cdot (D - s)}{2 \cdot R_{\text{eff}}} = \frac{s \cdot (D - s)}{2 \cdot K \cdot R_E}$$

At path midpoint $s = D/2$:
$$\Delta h_{\text{mid}} = \frac{(D/2)^2}{2 \cdot K \cdot R_E} = \frac{D^2}{8 \cdot K \cdot R_E}$$

For a baseline distance $D = 20\text{ km} = 20,000\text{ m}$:
- **Sub-refractive ($K = 0.80$):** $\Delta h_{\text{mid}} = \frac{400,000,000}{8 \cdot 0.80 \cdot 6,371,000} = 9.81\text{ m}$
- **Standard ($K = 4/3$):** $\Delta h_{\text{mid}} = \frac{400,000,000}{8 \cdot (4/3) \cdot 6,371,000} = 5.89\text{ m}$
- **Super-refractive ($K = 2.00$):** $\Delta h_{\text{mid}} = \frac{400,000,000}{8 \cdot 2.00 \cdot 6,371,000} = 3.92\text{ m}$

### 2.3 Multi-Order Fresnel Zones ($F_1, F_2, F_3$)

The radius $r_{Fn}(s)$ of the $n$-th Fresnel zone at distance $s$ from the transmitter ($d_1 = s, d_2 = D - s$) for carrier wavelength $\lambda = c / f_c$ is:
$$r_{Fn}(s) = \sqrt{\frac{n \cdot \lambda \cdot s \cdot (D - s)}{D}} = \sqrt{n} \cdot r_{F1}(s)$$

Specifically:
- First Fresnel zone: $r_{F1}(s) = \sqrt{\frac{\lambda \cdot s \cdot (D - s)}{D}}$
- Operational clearance criterion: $0.6 \cdot r_{F1}(s)$
- Second Fresnel zone: $r_{F2}(s) = \sqrt{2} \cdot r_{F1}(s)$
- Third Fresnel zone: $r_{F3}(s) = \sqrt{3} \cdot r_{F1}(s)$

### 2.4 ITU-R P.526-15 §4.5.1 Bullington Horizon Tangents & Virtual Apex

Given transmitter at $(0, z_{\text{tx}})$ and receiver at $(D, z_{\text{rx}})$, the slope of the ray from TX to effective terrain at sample $i$ is:
$$s_{\text{tx}, i} = \frac{z_{\text{eff}, i} - z_{\text{tx}}}{d_{1, i}}$$
The TX horizon peak is the maximum slope $s_{\text{tx,max}}$ occurring at distance $s_{\text{tx,dist}}$.
Similarly, the slope from RX to effective terrain at sample $i$ (where $d_{2, i} = D - d_{1, i}$) is:
$$s_{\text{rx}, i} = \frac{z_{\text{eff}, i} - z_{\text{rx}}}{d_{2, i}}$$
The RX horizon peak is the maximum slope $s_{\text{rx,max}}$ occurring at distance $s_{\text{rx,dist}}$.

The virtual Bullington apex $(s_{\text{bull}}, z_{\text{bull}})$ occurs at the intersection of the two horizon tangent rays:
$$s_{\text{bull}} = \frac{z_{\text{rx}} - z_{\text{tx}} + s_{\text{rx,max}} \cdot D}{s_{\text{tx,max}} + s_{\text{rx,max}}}$$
$$z_{\text{bull}} = z_{\text{tx}} + s_{\text{tx,max}} \cdot s_{\text{bull}}$$

The LoS chord height at $s_{\text{bull}}$ is:
$$z_{\text{los}}(s_{\text{bull}}) = z_{\text{tx}} + \frac{s_{\text{bull}}}{D} \cdot (z_{\text{rx}} - z_{\text{tx}})$$

The penetration height $h_{\text{bull}}$ above the LoS chord is:
$$h_{\text{bull}} = z_{\text{bull}} - z_{\text{los}}(s_{\text{bull}})$$

The dimensionless diffraction parameter $\nu$ is:
$$\nu = h_{\text{bull}} \cdot \sqrt{\frac{2}{\lambda} \left(\frac{1}{s_{\text{bull}}} + \frac{1}{D - s_{\text{bull}}}\right)}$$

The knife-edge diffraction loss $J(\nu)$ in dB is:
$$J(\nu) = 6.9 + 20 \log_{10} \left(\sqrt{(\nu - 0.1)^2 + 1} + \nu - 0.1\right)$$

---

## 3. Architecture & Data Contracts

### 3.1 Core Configuration (`src/core/config.ts`)
```typescript
export interface IEnvironmentConfig {
  readonly effectiveEarthRadiusFactor: number;
  readonly earthRadiusFactorK?: number;
  // ...
}

export class EnvironmentConfig implements IEnvironmentConfig {
  public readonly effectiveEarthRadiusFactor: number;
  public readonly earthRadiusFactorK: number = 4.0 / 3.0;

  public static refractivityGradientFromK(kFactor: number): number;
  public static effectiveEarthRadiusM(kFactor?: number): number;
  public get effectiveEarthRadiusM(): number;
}
```

### 3.2 Link Profile Analysis Contract (`src/core/linkProfile.ts` & `src/core/profileEngine.ts`)
```typescript
export interface BullingtonApexData {
  readonly distM: number;
  readonly elevM: number;
  readonly losHeightM: number;
  readonly diffractionParameterNu: number;
  readonly lossDb: number;
  readonly txHorizonDistM: number;
  readonly txHorizonElevM: number;
  readonly rxHorizonDistM: number;
  readonly rxHorizonElevM: number;
}

export interface LinkProfile {
  // Existing fields ...
  readonly kFactor: number;
  readonly refractivityGradNPerKm: number;
  readonly maxEarthBulgeM: number;
  readonly bullingtonApex?: BullingtonApexData | null;
  readonly fresnelZone2RadiusMidM: number;
  readonly fresnelZone3RadiusMidM: number;
}
```

### 3.3 Worker Inter-Process Communication (`src/shared/workerProtocol.ts`)
- `SetScientificParamsCommand`: carries optional `earthRadiusFactorK?: number;` in range $[0.5, 10.0]$.
- `ConfigUpdateParams`: carries optional `earthRadiusFactorK?: number;`.
- `FresnelSliceTelemetry`: transports `kFactor`, `refractivityGradNPerKm`, `maxEarthBulgeM`, `bullingtonApex`, `fresnelZone2RadiusMidM`, and `fresnelZone3RadiusMidM`.

---

## 4. User Experience & Inspector Controls

### 4.1 Atmospheric Refractivity Control Strip (`#tab-terrain`)
Located directly above the profile canvas in `#tab-terrain`:
- `<select id="prof-refractivity-select" aria-label="ITU-R P.834 Atmospheric Refractivity K-Factor Regime">`:
  - `Sub-Refractive Ducting Inversion (K = 0.80 | +39 N/km)`
  - `High-Altitude Dry Alpine (K = 1.18 | -24 N/km)`
  - `ITU-R Standard Atmosphere (K = 1.333 | -39 N/km)` (Selected by default)
  - `Super-Refractive Layer (K = 2.00 | -78 N/km)`
  - `Tropospheric Trapping (K = 4.00 | -118 N/km)`
- `<button type="button" id="prof-toggle-fresnel-orders" aria-label="Toggle Multi-Order Fresnel Zones F1 F2 F3" aria-pressed="true">`:
  Toggles rendering of $F_1, F_2, F_3$ envelopes and Bullington tangent rays.
- `<div id="prof-physics-readout">`:
  Crisp monospaced telemetry banner:
  `K-Factor: {kFactor} ({dN/dh} N/km) | Midpoint Bulge: +{maxBulgeM} m | Bullington Apex: {s_bull} km (ν = {nu}, J = {lossDb} dB) | R_crest: {crest_radius_m} m`.

### 4.2 Interactive SPLAT! Crosshair Inspector
- Hovering across `#profile-canvas` (`#terrain-canvas`) moves a vertical crosshair cursor with distance tracking.
- Canvas renders an on-screen HUD badge:
  `s = XX.XX km | Elev+Bulge: XXXX m (Δh_bulge: +XX.X m) | LoS: XXXX m | Clr: +/-XX.X m | ν(s) = X.XX`.

---

## 5. Verification & Validation Protocol

The test suite `src/tests/verifyPathProfileRefractivity.ts` validates:
- **PPR-T1 (ITU-R P.834-9 Refractivity Gradient & Earth Bulge Scaling):** Validates Earth bulge scaling at $D = 20\text{ km}$: $K = 0.80$ produces $\Delta h = 9.81\text{ m}$, $K = 4/3$ produces $\Delta h = 5.89\text{ m}$, and $K = 2.00$ produces $\Delta h = 3.92\text{ m}$.
- **PPR-T2 (Bullington Double-Horizon Apex & Multi-Order Fresnel Radii):** Validates $r_{F2} = \sqrt{2} r_{F1}$ and $r_{F3} = \sqrt{3} r_{F1}$ within $10^{-6}$, and verifies that dual-ridge obstructions populate valid `bullingtonApex` coordinates $(s_{\text{bull}}, z_{\text{bull}}, \nu_{\text{bull}})$.
- **PPR-T3 (DOM & Global Layout Invariance Check):** Asserts `#prof-refractivity-select`, `#prof-toggle-fresnel-orders`, and `#prof-physics-readout` exist inside `#tab-terrain`, and verifies that global layout styles (`.rail`, `.topbar`, `.app-shell`, `c2-console-theme.css`) remain 100% untouched.
