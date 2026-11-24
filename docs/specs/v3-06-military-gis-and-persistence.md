# SPEC-V3-06: Military Tactical GIS, Cartographic Overlays, GeoTIFF DEM & Mission Persistence

**Document ID:** `docs/specs/v3-06-military-gis-and-persistence.md`  
**Classification:** UNCLASSIFIED // NATO / DEFENSE STANDARD ALIGNED  
**Module Code:** `src/core/militaryGisEngine.ts`, `src/ui/cartographyRenderer.ts`  
**Status:** IMPLEMENTATION DRAFT (V3-06)  
**Authoritative References:** DMA TM 8358.1 / NGA.STND.0037_2.0.0 (MGRS), OGC 07-147r2 (KML 2.2), DoD CoT v2.0 (MIL-STD-2525), OGC 19-008 (GeoTIFF 1.1)

---

## 1. Architectural Scope & Operating Invariants

This specification governs the addition of military-grade Geographic Information System (GIS) capabilities, cartographic telemetry projection, GeoTIFF DEM ingestion, and persistent mission interchange to the Tactical X-Band Air-to-Ground Digital Twin.

### Architectural Invariants:
1. **Zero-Side-Effect Pure Engine:** All math in `src/core/militaryGisEngine.ts` and `src/ui/cartographyRenderer.ts` is 100% pure, deterministic, and free of mutable module state or `Math.random()`.
2. **Worker Isolation:** The authoritative 50 Hz simulation worker (`src/worker/simWorker.ts`) remains untouched and unaware of UI-thread GIS projections.
3. **Execution Latency:** MGRS coordinate transformations must execute in $< 3\ \mu\text{s/call}$ to support 60 fps cursor tracking on the UI thread without measurable frame time jitter.
4. **Security & Injection Protection:**
   - All user-controlled text strings exported into KML or CoT XML must pass strict XML entity escaping (`&`, `<`, `>`, `"`, `'`).
   - All imported Scenario JSON must undergo schema validation, prototype pollution neutralization (stripping/rejecting `__proto__`, `constructor`, `prototype`), and numeric bounding.
5. **Zero-Slop UI Mandate:** Zero emojis, fonts $\ge 10\text{px}$, paired `<label for="...">` and `aria-label` attributes on all inputs, zero duplicate DOM IDs.

---

## 2. Mathematical Formulations: WGS-84 $\leftrightarrow$ UTM $\leftrightarrow$ MGRS

### 2.1 WGS-84 Transverse Mercator (Forward Projection)

Given geodetic latitude $\phi$ and longitude $\lambda$ on the WGS-84 ellipsoid:
- Semi-major axis: $a = 6\,378\,137.0\text{ m}$
- Flattening: $f = 1 / 298.257223563$
- First eccentricity squared: $e^2 = 2f - f^2 \approx 0.00669437999014$
- Second eccentricity squared: $e'^2 = \frac{e^2}{1 - e^2} \approx 0.00673949674228$
- Scale factor on central meridian: $k_0 = 0.9996$
- False Easting: $E_0 = 500\,000.0\text{ m}$
- False Northing: $N_0 = 0.0\text{ m}$ (Northern Hemisphere) or $10\,000\,000.0\text{ m}$ (Southern Hemisphere)

#### 2.1.1 Zone Number & Central Meridian
The standard UTM 6° longitudinal zone is:
$$\text{Zone} = \lfloor \frac{\lambda + 180^\circ}{6^\circ} \rfloor + 1$$
Central meridian:
$$\lambda_0 = (\text{Zone} - 1) \times 6^\circ - 180^\circ + 3^\circ$$

**Special Longitudinal Zone Overrides (NGA STND.0037):**
- **Norway Exception ($56^\circ\text{N} \le \phi < 64^\circ\text{N}$):**
  If $3^\circ\text{E} \le \lambda < 12^\circ\text{E}$, $\text{Zone} = 32$ ($\lambda_0 = 9^\circ\text{E}$).
- **Svalbard Exception ($72^\circ\text{N} \le \phi < 84^\circ\text{N}$):**
  - $0^\circ \le \lambda < 9^\circ$: $\text{Zone} = 31$ ($\lambda_0 = 3^\circ$)
  - $9^\circ \le \lambda < 21^\circ$: $\text{Zone} = 33$ ($\lambda_0 = 15^\circ$)
  - $21^\circ \le \lambda < 33^\circ$: $\text{Zone} = 35$ ($\lambda_0 = 27^\circ$)
  - $33^\circ \le \lambda < 42^\circ$: $\text{Zone} = 37$ ($\lambda_0 = 37.5^\circ$)

#### 2.1.2 Transverse Mercator Equations (Krüger / Redfearn Series)
Let $\Delta \lambda = \lambda - \lambda_0$ (in radians).
The radius of curvature in the prime vertical:
$$\nu = \frac{a}{\sqrt{1 - e^2 \sin^2 \phi}}$$

The meridional arc distance from the equator:
$$M = a \left( \alpha \phi - \beta \sin(2\phi) + \gamma \sin(4\phi) - \delta \sin(6\phi) + \epsilon \sin(8\phi) \right)$$
where coefficients $\alpha, \beta, \gamma, \delta, \epsilon$ are derived from the third flattening $n = \frac{f}{2 - f}$.

Let $T = \tan^2 \phi$, $C = e'^2 \cos^2 \phi$, $A = \Delta \lambda \cos \phi$:
$$x = E_0 + k_0 \nu \left( A + (1 - T + C) \frac{A^3}{6} + (5 - 18T + T^2 + 72C - 58e'^2) \frac{A^5}{120} \right)$$
$$y = N_0 + k_0 \left( M + \nu \tan \phi \left( \frac{A^2}{2} + (5 - T + 9C + 4C^2) \frac{A^4}{24} + (61 - 58T + T^2 + 600C - 330e'^2) \frac{A^6}{720} \right) \right)$$

### 2.2 Latitude Bands
UTM divides latitudes between $80^\circ\text{S}$ and $84^\circ\text{N}$ into 20 bands of $8^\circ$ (with band `X` extending $12^\circ$ from $72^\circ\text{N}$ to $84^\circ\text{N}$), designated by letters `C` through `X` (omitting `I` and `O`).

### 2.3 MGRS 100,000-Metre Square Identification
MGRS subdivides each UTM zone into $100\text{ km} \times 100\text{ km}$ squares identified by a two-letter pair $(C_1, C_2)$:
- **Column Letter $C_1$:**
  Columns cycle through letters `A` to `Z` (omitting `I` and `O`).
  Columns are organized into 3 sets depending on $\text{Zone} \pmod 3$:
  - Set 1 ($\text{Zone} \pmod 3 = 1$): `A` to `H`
  - Set 2 ($\text{Zone} \pmod 3 = 2$): `J` to `R`
  - Set 3 ($\text{Zone} \pmod 3 = 0$): `S` to `Z`
  $$\text{ColIndex} = \lfloor \frac{x}{100\,000} \rfloor$$
- **Row Letter $C_2$:**
  Rows cycle through a 20-letter sequence `A` to `V` (omitting `I` and `O`).
  For odd-numbered zones, the sequence begins at `A` at the equator.
  For even-numbered zones, the sequence is offset by 5 letters (begins at `F` at the equator):
  $$\text{RowIndex} = (\lfloor \frac{y}{100\,000} \rfloor + \text{offset}) \pmod{20}$$

#### 2.3.1 Numerical Coordinates & Precision
Within the 100 km square, easting and northing remainders $e_{\text{rem}} = x \pmod{100\,000}$ and $n_{\text{rem}} = y \pmod{100\,000}$ are truncated/formatted to $k \in [1..5]$ digits:
- Precision 5: $1\text{ m}$ (5 digits easting, 5 digits northing, e.g. `"43S FR 37612 81204"`)
- Precision 4: $10\text{ m}$ (4 digits)
- Precision 3: $100\text{ m}$ (3 digits)
- Precision 2: $1\text{ km}$ (2 digits)
- Precision 1: $10\text{ km}$ (1 digit)

### 2.4 Inverse Projection: MGRS $\to$ UTM $\to$ Geodetic
1. Parse Grid Zone Designator (e.g. `43S`), 100 km identifier (`FR`), and numerical coordinates.
2. Determine base easting and northing offsets from zone rules and row cycle.
3. Compute full UTM easting and northing centered on the precision cell:
   $$x_c = x_{\text{base}} + e_{\text{rem}} + 0.5 \times 10^{5 - k}$$
   $$y_c = y_{\text{base}} + n_{\text{rem}} + 0.5 \times 10^{5 - k}$$
4. Reconcile northing within the latitude band bounds $[N_{\min}, N_{\max}]$.
5. Invert Transverse Mercator using footprint latitude $\phi_1$ to recover exact WGS-84 $(\phi, \lambda)$ with $< 0.01\text{ m}$ error.

---

## 3. Uncompressed GeoTIFF DEM Ingestion

The engine implements a lightweight, pure TypeScript parser for uncompressed GeoTIFF elevation grids (16-bit signed/unsigned integer and 32-bit floating point).

### 3.1 TIFF Header & Tag Specification
- **Header:** Bytes 0–1: `0x4949` (Little-Endian) or `0x4D4D` (Big-Endian). Bytes 2–3: Magic number `42`. Bytes 4–7: Offset to Image File Directory 0 (IFD0).
- **Core IFD0 Tags:**
  - `256` (ImageWidth)
  - `257` (ImageLength)
  - `258` (BitsPerSample: 16 or 32)
  - `259` (Compression: 1 = uncompressed)
  - `273` (StripOffsets)
  - `278` (RowsPerStrip)
  - `279` (StripByteCounts)
  - `339` (SampleFormat: 1 = uint, 2 = int, 3 = float)
- **GeoTIFF Tags:**
  - `33550` (`ModelPixelScaleTag`): $[S_x, S_y, S_z]$
  - `33922` (`ModelTiepointTag`): $[I, J, K, X, Y, Z]$

### 3.2 Elevation Normalization & Safety Bounds
- Converts raw strip data into a contiguous `Float32Array`.
- Values matching standard NoData indicators (`-32768`, `-9999`, `NaN`) are masked or clamped.
- Non-throwing parser: truncated or unsupported TIFF files return `{ ok: false, error: string }`.

---

## 4. Tactical Data Serialization Formats

### 4.1 ATAK Cursor-on-Target (CoT) XML v2.0
Emits standard DoD CoT messages formatted as:
```xml
<?xml version="1.0" standalone="yes"?>
<events version="2.0">
  <event version="2.0" uid="ACN-1" type="a-f-A-M-F-Q" time="2026-11-24T00:00:00.000Z" start="2026-11-24T00:00:00.000Z" stale="2026-11-24T00:05:00.000Z" how="m-g">
    <point lat="34.15260" lon="77.57710" hae="5000.0" ce="10.0" le="15.0"/>
    <detail>
      <contact callsign="VIPER-01"/>
      <remarks>Tactical X-Band Airborne Relay Node</remarks>
    </detail>
  </event>
</events>
```
Standard MIL-STD-2525 CoT types:
- Airborne Relay (ACN): `a-f-A-M-F-Q` (Friendly Military Airborne Drone/Aircraft)
- Soldier Terminal: `a-f-G-U-C-I` (Friendly Ground Infantry)
- Command Post (MCP): `a-f-G-U-C-H` (Friendly Headquarters)
- Convoy / Mobile: `a-f-G-E-V-A` (Friendly Armored/Ground Vehicle)
- Hostile EW Jammer: `a-h-G-E-V-E` (Hostile Ground Electronic Warfare)

### 4.2 OGC KML 2.2
Emits standard KML 2.2 `<kml xmlns="http://www.opengis.net/kml/2.2">` with:
- `<Style>` elements for tactical entity markers and RF link status lines.
- `<Placemark>` points for ACN and ground nodes with `<LookAt>` and `<coordinates>`.
- `<LineString>` geometries for active communications links with altitude mode `absolute`.
- `<Polygon>` geometries for 3D terrain obstacle footprints with extrusion.

### 4.3 Mission Scenario JSON v3 Schema
```typescript
export interface MissionScenarioV3 {
  schemaVersion: "xband-dt-scenario-v3";
  title: string;
  timestamp: string;
  theater: {
    biomeId: string;
    centerLatDeg: number;
    centerLonDeg: number;
  };
  acn: {
    callsign: string;
    cruiseAltMslM: number;
    cruiseAirspeedMs: number;
    orbitPattern: string;
    waypoints: Array<{ xM: number; yM: number; altM: number }>;
  };
  nodes: Array<{
    id: number;
    callsign: string;
    xM: number;
    yM: number;
    aglM: number;
    tacticalPriority: number;
  }>;
  obstacles: Array<{
    id: string;
    name: string;
    type: string;
    points: Array<{ x: number; y: number }>;
    heightM: number;
  }>;
  rfConfig: Record<string, number | boolean | string>;
}
```

---

## 5. 2D Cartographic UI Overlays

### 5.1 True North Compass Rose
Rendered in top-right of 2D radar display using `src/ui/canvasTheme.ts` colors:
- Matte obsidian dial with directional ticks at $0^\circ, 90^\circ, 180^\circ, 270^\circ$.
- Stylized North pointer (`N`) with high-visibility accent color.

### 5.2 Dynamic 1-2-5 Metric Scale Bar
Rendered at bottom-center:
- Selects nice metric intervals: $100\text{ m}, 200\text{ m}, 500\text{ m}, 1\text{ km}, 2\text{ km}, 5\text{ km}, 10\text{ km}, 20\text{ km}, 50\text{ km}$.
- Renders alternating dual-segment bar with exact pixel length $L_{\text{px}} = \text{StepM} / \text{metersPerPixel}$.
- Labeled with $0$, $\text{Step}/2$, and $\text{Step}$ values.

### 5.3 Optional MGRS Tactical Grid Overlay
When activated:
- Computes visible screen bounds in theater coordinates.
- Draws grid lines at $10\text{ km}$ or $20\text{ km}$ spacing with subtle major/minor strokes.
- Renders MGRS 100 km and 10 km square labels along canvas borders.
