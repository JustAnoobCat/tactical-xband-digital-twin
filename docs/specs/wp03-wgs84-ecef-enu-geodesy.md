# SPEC-WP03: Canonical WGS-84 ECEF / ENU / Vincenty Geodetic Engine

**Specification Document:** `docs/specs/wp03-wgs84-ecef-enu-geodesy.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** Geodesy / Astrodynamics / Mathematical Rigor  
**Applies to Modules:** `src/core/geodesy.ts`, `src/core/geodeticRulerEngine.ts` (optional), `src/tests/verifyWgs84Geodesy.ts`  

---

## 1. Executive Summary & Problem Formulation

### 1.1 Context & Background
The tactical simulation engine operates in the Ladakh mountainous theater ($34.500000^\circ\text{N}, 76.500000^\circ\text{E}$). The legacy coordinate subsystem (Milestone M7.1) utilized a linear Local Equirectangular projection (Plate Carrée with standard parallel at $\phi_0 = 34.5^\circ\text{N}$):
- Meridional scale: $110\,931.4506\text{ m/deg}$
- Parallel scale: $91\,839.9774\text{ m/deg}$

While computationally trivial ($\mathcal{O}(1)$ linear arithmetic) and perfectly suited for mapping the rectilinear $2^\circ \times 2^\circ$ SRTM DEM elevation grid tiles into memory without resampling, flat-Earth equirectangular mapping introduces significant geometric distortion when simulating wide-area operations (AO $\ge 150\text{--}300\text{ km}$):
1. **Curvature Drop & Altitude Leakage:** A horizontal displacement of $d = 150\text{ km}$ exhibits an ellipsoidal curvature drop $u \approx -d^2 / (2R) \approx -1.77\text{ km}$. Naive 3D tangent-plane transformations that assume $u = 0$ distort ellipsoidal heights and cause non-physical elevation leakage.
2. **Meridional Convergence & Easting Drift:** On an oblate ellipsoid ($f \approx 1/298.257$), parallels of latitude converge poleward. At the corners of a $300\text{ km}$ operational area, linear equirectangular projection accumulates multi-kilometer easting discrepancies compared to true ellipsoidal geodesics.
3. **Long-Range Line-of-Sight & Look Angles:** Precise antenna pointing (azimuth, elevation) and 3D slant range calculation for airborne tactical nodes (ACN at $12\,000\text{ m}$ MSL) across long baselines require rigorous ECEF chord distance and local topocentric ENU rotation.

### 1.2 Core Objectives of WP-03
1. **Canonical WGS-84 Constants:** Export authoritative WGS-84 ellipsoid constants ($a, f, b, e^2, e'^2$) with double-precision floating-point fidelity.
2. **Rigorous 3D ECEF $\leftrightarrow$ Geodetic Conversion:** Implement zero-side-effect, sub-millimeter accurate `geodeticToEcef` and Bowring/Newton-Raphson `ecefToGeodetic` routines with $< 10^{-11}\text{ rad}$ latitude convergence and non-singular polar handling.
3. **Local Topocentric ENU Transformations:** Implement exact 3D `geodeticToEnu` and `enuToGeodetic` via rotation matrix $\mathbf{R}_{\text{ECEF}\to\text{ENU}}(\phi_0, \lambda_0)$.
4. **Surface-Constrained 2D ENU $\leftrightarrow$ Geodetic Conversion:** Formulate a 2D surface-constrained inverse projection that iteratively converges tangent plane $u$ onto the reference ellipsoid surface ($h = h_{\text{origin}}$) in 3–4 fixed-point steps, eliminating altitude leakage and achieving $< 10^{-4}\text{ m}$ round-trip error across $300\text{ km}$.
5. **Vincenty Ellipsoidal Inverse Geodesic:** Provide millimeter-accurate geodesic distance, forward azimuth, and back azimuth with antipodal fallback and coincident-point handling.
6. **True 3D Slant Range & Topocentric Look Angles:** Compute exact 3D ECEF chord slant range, local topocentric azimuth, and true elevation angle (including horizon curvature dip).
7. **Strict 50 Hz Performance Budget:** Guarantee all geodetic primitives execute in $< 5\,\mu\text{s}$ per invocation without hot-loop object allocations, allowing 10,000 transforms to execute in $< 50\text{ ms}$.
8. **Backward Compatibility & Suite Invariance:** Maintain 100% compatibility with all 86 existing verification suites, honoring the DEM-aligned linear Plate Carrée mapping where asserted by legacy DEM tests.

---

## 2. Mathematical Rigor & Formulations

### 2.1 WGS-84 Ellipsoid Reference Parameters
The World Geodetic System 1984 (WGS-84 / EPSG:7030) defines:
- Semi-major axis:
  $$a = 6\,378\,137.0\text{ m}$$
- Reciprocal flattening:
  $$1/f = 298.257223563 \implies f \approx 3.3528106647474805 \times 10^{-3}$$
- Semi-minor axis:
  $$b = a(1 - f) \approx 6\,356\,752.314245179\text{ m}$$
- First eccentricity squared:
  $$e^2 = 2f - f^2 = \frac{a^2 - b^2}{a^2} \approx 6.6943799901413165 \times 10^{-3}$$
- Second eccentricity squared:
  $$e'^2 = \frac{a^2 - b^2}{b^2} = \frac{e^2}{1 - e^2} \approx 6.739496742276434 \times 10^{-3}$$

### 2.2 Principal Radii of Curvature
For geodetic latitude $\phi$:
- **Prime Vertical Radius of Curvature** (transverse radius):
  $$N(\phi) = \frac{a}{\sqrt{1 - e^2 \sin^2\phi}}$$
- **Meridional Radius of Curvature** (along meridian):
  $$R_M(\phi) = \frac{a(1 - e^2)}{(1 - e^2 \sin^2\phi)^{3/2}}$$
- **Gaussian Mean Radius**:
  $$R_{\text{gauss}}(\phi) = \sqrt{R_M(\phi) N(\phi)}$$

At theater origin $\phi_0 = 34.500000^\circ\text{N}$:
- $R_M(\phi_0) \approx 6\,355\,951.68\text{ m} \implies \frac{\pi}{180} R_M \approx 110\,931.4506\text{ m/deg}$
- $N(\phi_0) \cos\phi_0 \approx 5\,262\,058.26\text{ m} \implies \frac{\pi}{180} N(\phi_0) \cos\phi_0 \approx 91\,839.9774\text{ m/deg}$

### 2.3 Geodetic $(\phi, \lambda, h) \to$ ECEF $(X, Y, Z)$
Given latitude $\phi$, longitude $\lambda$, and ellipsoidal height $h$:
$$X = (N(\phi) + h) \cos\phi \cos\lambda$$
$$Y = (N(\phi) + h) \cos\phi \sin\lambda$$
$$Z = \left(N(\phi)(1 - e^2) + h\right) \sin\phi$$

### 2.4 ECEF $(X, Y, Z) \to$ Geodetic $(\phi, \lambda, h)$
1. Longitude:
   $$\lambda = \text{atan2}(Y, X)$$
2. Equatorial projection:
   $$p = \sqrt{X^2 + Y^2}$$
3. Polar singularity guard:
   If $p < 10^{-10}\text{ m}$:
   $$\phi = \begin{cases} +\frac{\pi}{2} & \text{if } Z \ge 0 \\ -\frac{\pi}{2} & \text{if } Z < 0 \end{cases}, \quad h = |Z| - b, \quad \lambda = 0$$
4. Bowring initialization:
   $$\theta = \text{atan2}(Z \cdot a, p \cdot b)$$
   $$\phi_0 = \text{atan2}\left(Z + e'^2 b \sin^3\theta, \; p - e^2 a \cos^3\theta\right)$$
5. High-precision Newton/fixed-point iteration (converges to $< 10^{-12}\text{ rad}$ in $\le 3$ iterations):
   $$\phi_{k+1} = \text{atan2}\left(Z + e^2 N(\phi_k) \sin\phi_k, \; p\right)$$
6. Non-singular ellipsoidal height (exact for all latitudes):
   $$h = p \cos\phi + Z \sin\phi - a \sqrt{1 - e^2 \sin^2\phi}$$

### 2.5 ECEF $\leftrightarrow$ Topocentric ENU Transformation
Given local origin $P_0 = (\phi_0, \lambda_0, h_0)$ with ECEF coordinates $\mathbf{R}_0 = (X_0, Y_0, Z_0)^\top$:
$$\Delta \mathbf{R} = \mathbf{R} - \mathbf{R}_0 = \begin{bmatrix} X - X_0 \\ Y - Y_0 \\ Z - Z_0 \end{bmatrix}$$

The rotation matrix from ECEF to East-North-Up (ENU) is:
$$\mathbf{R}_{\text{ECEF}\to\text{ENU}} = \begin{bmatrix}
-\sin\lambda_0 & \cos\lambda_0 & 0 \\
-\sin\phi_0 \cos\lambda_0 & -\sin\phi_0 \sin\lambda_0 & \cos\phi_0 \\
\cos\phi_0 \cos\lambda_0 & \cos\phi_0 \sin\lambda_0 & \sin\phi_0
\end{bmatrix}$$

- **ECEF to ENU:**
  $$\begin{bmatrix} e \\ n \\ u \end{bmatrix} = \mathbf{R}_{\text{ECEF}\to\text{ENU}} \begin{bmatrix} \Delta X \\ \Delta Y \\ \Delta Z \end{bmatrix}$$
- **ENU to ECEF:**
  $$\begin{bmatrix} X \\ Y \\ Z \end{bmatrix} = \begin{bmatrix} X_0 \\ Y_0 \\ Z_0 \end{bmatrix} + \mathbf{R}_{\text{ECEF}\to\text{ENU}}^\top \begin{bmatrix} e \\ n \\ u \end{bmatrix}$$

### 2.6 Surface-Constrained 2D ENU $\leftrightarrow$ Geodetic Conversion
In 2D planar projection callers, $(x, y)$ represents horizontal easting/northing on the terrain surface where altitude $h$ is tracked independently as MSL/ellipsoidal height, **not** local tangent-plane elevation $u$.
If one naively sets $u = 0$, the projected point sits on the tangent plane above the curved Earth, resulting in an altitude drop:
$$u_{\text{surface}} \approx -\frac{e^2 + n^2}{2 R_{\text{gauss}}}$$
At $d = 150\text{ km}$, $u_{\text{surface}} \approx -1.77\text{ km}$. Feeding $u = 0$ into standard `enuToGeodetic` creates an artificial $+1.77\text{ km}$ altitude distortion and latitudinal shifts.

**Solution: Surface-Constrained Fixed-Point Iteration:**
Given horizontal target $(e, n)$ and surface altitude $h_{\text{surf}}$ (default $h_0$):
1. Initialize $u^{(0)} = -\frac{e^2 + n^2}{2 N(\phi_0)}$.
2. Loop $k = 0, 1, 2, 3$:
   a. $(\phi, \lambda, h_{\text{calc}}) = \text{enuToGeodetic}(e, n, u^{(k)}, \phi_0, \lambda_0, h_0)$.
   b. Compute exact ECEF point on surface: $\mathbf{P} = \text{geodeticToEcef}(\phi, \lambda, h_{\text{surf}})$.
   c. Rotate back to local ENU: $(e_{\text{check}}, n_{\text{check}}, u_{\text{check}}) = \mathbf{R}_{\text{ECEF}\to\text{ENU}}(\mathbf{P} - \mathbf{P}_0)$.
   d. Update: $u^{(k+1)} = u_{\text{check}}$.
3. In 3 iterations, $|e_{\text{check}} - e| < 10^{-6}\text{ m}$ and $|n_{\text{check}} - n| < 10^{-6}\text{ m}$ with zero altitude error.

### 2.7 Vincenty's Inverse Geodesic Algorithm
Computes ellipsoidal geodesic distance $s$, initial forward bearing $\alpha_1$, and final bearing $\alpha_2$ between $P_1(\phi_1, \lambda_1)$ and $P_2(\phi_2, \lambda_2)$:
- Reduced latitudes: $U_1 = \arctan((1 - f)\tan\phi_1)$, $U_2 = \arctan((1 - f)\tan\phi_2)$.
- Iterative solution for difference in longitude on auxiliary sphere $\lambda$:
  $$\sin\sigma = \sqrt{(\cos U_2 \sin\lambda)^2 + (\cos U_1 \sin U_2 - \sin U_1 \cos U_2 \cos\lambda)^2}$$
  $$\cos\sigma = \sin U_1 \sin U_2 + \cos U_1 \cos U_2 \cos\lambda$$
  $$\sigma = \text{atan2}(\sin\sigma, \cos\sigma)$$
  $$\sin\alpha = \frac{\cos U_1 \cos U_2 \sin\lambda}{\sin\sigma}$$
  $$\cos^2\alpha = 1 - \sin^2\alpha$$
  $$\cos(2\sigma_m) = \cos\sigma - \frac{2 \sin U_1 \sin U_2}{\cos^2\alpha}$$
  $$\lambda' = L + (1 - C) f \sin\alpha \left\{ \sigma + C \sin\sigma \left[ \cos(2\sigma_m) + C \cos\sigma (-1 + 2\cos^2(2\sigma_m)) \right] \right\}$$
- Tolerance: $|\lambda' - \lambda| < 10^{-12}\text{ rad}$ (max 100 iterations).
- Fallback: For nearly antipodal points failing to converge within 100 iterations, fall back smoothly to Great-Circle Spherical Geodesic with Gaussian mean radius.

### 2.8 3D Slant Range & Topocentric Look Angles
For transmitter $(\phi_1, \lambda_1, h_1)$ and receiver $(\phi_2, \lambda_2, h_2)$:
- $\mathbf{P}_1 = \text{geodeticToEcef}(\phi_1, \lambda_1, h_1)$
- $\mathbf{P}_2 = \text{geodeticToEcef}(\phi_2, \lambda_2, h_2)$
- 3D Euclidean slant range (chord distance):
  $$d_{\text{slant}} = \|\mathbf{P}_2 - \mathbf{P}_1\|_2 = \sqrt{(X_2 - X_1)^2 + (Y_2 - Y_1)^2 + (Z_2 - Z_1)^2}$$
- Local Tx topocentric ENU coordinates of Rx:
  $$\begin{bmatrix} e \\ n \\ u \end{bmatrix} = \mathbf{R}_{\text{ECEF}\to\text{ENU}}(\phi_1, \lambda_1) (\mathbf{P}_2 - \mathbf{P}_1)$$
- Azimuth:
  $$\text{Az} = (\text{atan2}(e, n) \times 180 / \pi + 360) \pmod{360}$$
- Elevation:
  $$\text{El} = \text{atan2}\left(u, \sqrt{e^2 + n^2}\right) \times 180 / \pi$$
- Ground Arc:
  $$d_{\text{ground}} = \text{wgs84VincentyInverse}(\phi_1, \lambda_1, \phi_2, \lambda_2).\text{distanceM}$$

---

## 3. Existing Interfaces, Contracts & Nuances

### 3.1 Existing Exported Signatures in `src/core/geodesy.ts`
The following existing exports MUST be maintained with full signature and return type parity:
- `GEODESY_ORIGIN_LAT_DEG = 34.5`
- `GEODESY_ORIGIN_LON_DEG = 76.5`
- `METERS_PER_DEG_LAT = 110931.4506`
- `METERS_PER_DEG_LON = 91839.9774`
- `DEM_COVERAGE_HALF_WIDTH_M = 91839.9774`
- `DEM_COVERAGE_HALF_HEIGHT_M = 110931.4506`
- `DEM_MIN_LAT_DEG = 33.5`, `DEM_MAX_LAT_DEG = 35.5`
- `DEM_MIN_LON_DEG = 75.5`, `DEM_MAX_LON_DEG = 77.5`
- `interface GeodeticCoordinate { readonly latDeg: number; readonly lonDeg: number; readonly isWithinCoverage: boolean; }`
- `interface CartesianCoordinate { readonly xM: number; readonly yM: number; readonly isWithinCoverage: boolean; }`
- `cartesianToGeodetic(xM: number, yM: number): GeodeticCoordinate`
- `geodeticToCartesian(latDeg: number, lonDeg: number): CartesianCoordinate`
- `formatDmsComponent(deg: number, isLatitude: boolean): string`
- `formatGeodeticDecimal(latDeg: number, lonDeg: number, fractionDigits?: number): string`
- `formatGeodeticDms(latDeg: number, lonDeg: number): string`

### 3.2 Legacy Contract Analysis & Nuance Documentation
Existing tests (`verifyGeodesy.ts`, `verifyDemMapping.ts`, `verifyNodeInventoryCoordinates.ts`) assert exact agreement ($< 10^{-12\circ}$ and $< 10^{-7}\text{ m}$) with `METERS_PER_DEG_LAT` ($110\,931.4506$) and `METERS_PER_DEG_LON` ($91\,839.9774$).
- **Origin Contract:** $(0, 0)$ strictly maps to $(34.5^\circ\text{N}, 76.5^\circ\text{E})$.
- **DEM Rectilinear Indexing:** In `TerrainEngine`, DEM elevation data from SRTM tiles is stored in a 2D regular raster array. The local Cartesian theater coordinates are mapped linearly to this grid. Altering `cartesianToGeodetic(x, y)` to non-linear ENU by default would break the raster index bijection and fail `verifyGeodesy.ts` (test suite 19) and `verifyDemMapping.ts` (test suite 68).
- **Resolution:**
  - `cartesianToGeodetic` and `geodeticToCartesian` retain their linear DEM equirectangular behavior when called in default mode, ensuring 100% backward compatibility with all 86 existing suites.
  - An optional parameter `mode?: 'equirectangular' | 'wgs84-enu'` is supported.
  - High-precision WGS-84 workflows utilize the new canonical functions: `geodeticToEcef`, `ecefToGeodetic`, `geodeticToEnu`, `enuToGeodetic`, `geodeticToEnu2D`, `enuToGeodetic2D`, `wgs84VincentyInverse`, `wgs84SlantRangeAndLookAngles`, `latLonToLocal`, and `localToLatLon`.

---

## 4. New Canonical Function Signatures

```typescript
// Ellipsoid Constants
export const WGS84_A_M = 6378137.0;
export const WGS84_F = 1.0 / 298.257223563;
export const WGS84_B_M = WGS84_A_M * (1.0 - WGS84_F);
export const WGS84_E2 = 2.0 * WGS84_F - WGS84_F * WGS84_F;
export const WGS84_E_PRIME2 = (WGS84_A_M * WGS84_A_M - WGS84_B_M * WGS84_B_M) / (WGS84_B_M * WGS84_B_M);

// Types
export interface EcefCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EnuCoordinate {
  readonly eastM: number;
  readonly northM: number;
  readonly upM: number;
}

export interface GeodeticCoordinate3D {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly altM: number;
}

export interface LocalRadii {
  readonly Rm: number;        // Meridional radius
  readonly Rn: number;        // Prime vertical radius
  readonly Rgauss: number;    // Gaussian mean radius
}

export interface VincentyResult {
  readonly distanceM: number;
  readonly initialBearingDeg: number;
  readonly finalBearingDeg: number;
  readonly iterations: number;
  readonly converged: boolean;
}

export interface SlantRangeLookAngles {
  readonly slantRangeM: number;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  readonly groundArcM: number;
}

// Canonical Functions
export function geodeticToEcef(latDeg: number, lonDeg: number, altM?: number): EcefCoordinate;
export function ecefToGeodetic(x: number, y: number, z: number): GeodeticCoordinate3D;
export function geodeticToEnu(latDeg: number, lonDeg: number, altM?: number, originLatDeg?: number, originLonDeg?: number, originAltM?: number): EnuCoordinate;
export function enuToGeodetic(eastM: number, northM: number, upM?: number, originLatDeg?: number, originLonDeg?: number, originAltM?: number): GeodeticCoordinate3D;
export function geodeticToEnu2D(latDeg: number, lonDeg: number, originLatDeg?: number, originLonDeg?: number): { eastM: number; northM: number };
export function enuToGeodetic2D(eastM: number, northM: number, originLatDeg?: number, originLonDeg?: number, surfaceAltM?: number): { latDeg: number; lonDeg: number };
export function latLonToLocal(latDeg: number, lonDeg: number, originLatDeg?: number, originLonDeg?: number): { xM: number; yM: number };
export function localToLatLon(xM: number, yM: number, originLatDeg?: number, originLonDeg?: number, surfaceAltM?: number): { latDeg: number; lonDeg: number };
export function wgs84LocalRadii(latDeg: number): LocalRadii;
export function wgs84VincentyInverse(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number): VincentyResult;
export function wgs84SlantRangeAndLookAngles(txLatDeg: number, txLonDeg: number, txAltM: number, rxLatDeg: number, rxLonDeg: number, rxAltM: number): SlantRangeLookAngles;
```

---

## 5. Verification Plan (`src/tests/verifyWgs84Geodesy.ts`)

The verification suite will rigorously validate:
1. **WGS-84 ECEF Reference Benchmarks:** Test equator, poles, Ladakh theater base ($34.1526^\circ\text{N}, 77.5771^\circ\text{E}, 3500\text{ m}$), and airborne node ($34.5000^\circ\text{N}, 78.2000^\circ\text{E}, 12\,000\text{ m}$) against analytical ECEF positions to $< 1\text{ mm}$ error.
2. **3D Round-Trip Invariance:** Bidirectional round-trip error for `geodeticToEcef` $\leftrightarrow$ `ecefToGeodetic` and `geodeticToEnu` $\leftrightarrow$ `enuToGeodetic` across a $300\text{ km}$ AO ($< 10^{-4}\text{ m}$).
3. **2D Surface Projection Invariance:** Surface-constrained `latLonToLocal` $\leftrightarrow$ `localToLatLon` round-trip error $< 10^{-3}\text{ m}$ across a $300\text{ km}$ AO with zero altitude leakage.
4. **Quantified Flat-Earth Equirectangular Drift Elimination:** Demonstrate that at $300\text{ km}$ AO bounds, flat-Earth equirectangular mapping exhibits multiple kilometers of easting distortion, which is fully eliminated by WGS-84 ENU.
5. **Vincenty Inverse Precision:** Test coincident points ($0\text{ m}$), short baselines ($1\text{ km}$), long baselines ($200\text{ km}$), and antipodal edge conditions.
6. **3D Slant Range & Topocentric Look Angles:** Prove horizon curvature elevation dip at $200\text{ km}$ ($u \approx -3.14\text{ km}$, negative elevation angle).
7. **Performance Benchmark:** Execute 10,000 ENU conversions and verify total time $< 50\text{ ms}$ ($< 5\,\mu\text{s}$ per call), safeguarding the 50 Hz discrete simulation loop.
