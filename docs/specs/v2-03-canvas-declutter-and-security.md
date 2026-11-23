# V2-03: 2D Canvas Label De-Cluttering Engine, `domSafety.ts` URL-Scheme Security Guard & Air-Gap Tile Notice

**Specification Identifier:** `SPEC-V2-03-CANVAS-DECLUTTER-AND-SECURITY`  
**Milestone:** V2-03 (Frontier Milestone 3)  
**Parent Framework:** `AGENTS.md` (Physical & Scientific Rigor, Zero-Randomness Invariants, SE Architecture)  
**Status:** **APPROVED FOR IMPLEMENTATION**  

---

## 1. Executive Summary & Problem Formulation

### 1.1 Context
In the Tactical X-Band Air-to-Ground Network Digital Twin, the 2D Tactical Radar Canvas renders high-density tactical overlays in real time (50 Hz discrete simulation loop, 60 fps canvas presentation). These overlays include:
- ACN (Airborne Communications Node) positional & heading tags.
- Precision Geodetic Ruler summary callout pills and blocking crest indicators (`[PEAK] BLOCKING PEAK [...]`).
- Precision Cursor RF Probe 360° viewshed horizon masks (`360° SKY: ...%` and `MASK: ... | EL: ... | CLR: ...`) and pinned differential callouts (`ΔSINR: ... | ΔElev: ...`).
- Precision Area of Operations (AO) Swath extrema badges (`▲ SUMMIT`, `▼ VALLEY`, `[DEAD ZONE]`).
- Tactical barrier and transect markers.

When multiple tactical elements cluster in close spatial proximity (e.g. ACN orbiting above a valley while an operator runs a geodetic ruler transect and cursor probe), screen-space label bounding boxes collide. Without deterministic de-confliction:
1. Callout pills overlap illegibly, obscuring critical elevation, link margin, and line-of-sight status.
2. Floating labels drift underneath fixed HUD controls (left tool rail, bottom cursor coordinate HUD, bottom-right layer switcher).

Furthermore, the front-end application environment requires strict defensive hardening against cross-site scripting (XSS) and protocol injection:
1. `src/ui/domSafety.ts` must provide authoritative URL-scheme validation (`isSafeUrl`) that rejects script execution schemes (`javascript:`, `vbscript:`, executable `data:` types such as `text/html` and `image/svg+xml`) and protocol-relative URLs (`//...`) while safely permitting tactical imagery (`https:`, `http:`, `blob:`, raster `data:image/(png|jpeg|webp)`) and relative navigational paths.
2. `createSafeElement` must enforce schema-level attribute guards, rejecting `srcdoc` and inline `on*` event handlers, and vetting all resource URL attributes (`href`, `src`, `action`, `formaction`, `xlink:href`, `poster`).
3. In secure air-gapped field deployments or restrictive CSP environments where external satellite tile servers are unreachable, MapLibre must gracefully alert operators via `#map-renderer-notice` with a clean, terse message:
   `Air-gap mode: external map tiles blocked/offline — switch to Radar / SRTM DEM`.

---

## 2. Architectural Invariants & Scope Boundaries

1. **Active Authoritative Runtime:** All changes reside in `src/ui/` and `index.html`. No modifications to `src/worker/*`, `src/core/*`, `src/types/*`, or legacy prototypes.
2. **Deterministic & Pure Execution:** Zero `Math.random()`, zero module-level mutable state in `canvasLabelPlacer.ts` and `domSafety.ts`.
3. **Execution Budget:** 2D label de-confliction for 25 simultaneous callouts must execute in $< 50\,\mu\text{s}$ per frame ($< 50\,\text{ms}$ for 1,000 frames), ensuring negligible overhead within the 60 fps / 16.6 ms rendering budget.
4. **Zero-Slop UI Gate:** Zero emojis, zero duplicate DOM IDs, zero external CDN dependencies.

---

## 3. Mathematical Formulation & Technical Specifications

### 3.1 2D Label De-Cluttering Engine (`src/ui/canvasLabelPlacer.ts`)

#### Factory Interface
```typescript
export interface PlacedLabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly displaced: boolean;
  readonly displacementPx: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface CanvasLabelPlacer {
  reserveRect(x: number, y: number, width: number, height: number): void;
  placeLabel(
    preferredX: number,
    preferredY: number,
    width: number,
    height: number,
    anchorX?: number,
    anchorY?: number
  ): PlacedLabelBox;
  getPlacedCount(): number;
  computeTotalOverlapArea(): number;
}

export function createLabelPlacer(
  viewportWidth: number,
  viewportHeight: number,
  paddingPx = 4,
  marginPx = 3
): CanvasLabelPlacer;
```

#### Axis-Aligned Bounding Box (AABB) Collision & Overlap
For candidate box $A = (x_A, y_A, w_A, h_A)$ with margin buffer $m = \text{marginPx}$, and existing box $B = (x_B, y_B, w_B, h_B)$:
$$\text{Overlap}_X = \max\left(0, \min(x_A + w_A + m, x_B + w_B + m) - \max(x_A - m, x_B - m)\right)$$
$$\text{Overlap}_Y = \max\left(0, \min(y_A + h_A + m, y_B + h_B + m) - \max(y_A - m, y_B - m)\right)$$
Boxes collide if and only if $\text{Overlap}_X > 0$ and $\text{Overlap}_Y > 0$.

#### Viewport Clamping Bounds
Given viewport dimensions $(W_v, H_v)$ and padding $p = \text{paddingPx}$:
$$x_{\text{min}} = p, \quad x_{\text{max}} = \max(x_{\text{min}}, W_v - w_A - p)$$
$$y_{\text{min}} = p, \quad y_{\text{max}} = \max(y_{\text{min}}, H_v - h_A - p)$$
Candidate top-left coordinates are clamped:
$$\text{clamp}_X(x) = \min(x_{\text{max}}, \max(x_{\text{min}}, x)), \quad \text{clamp}_Y(y) = \min(y_{\text{max}}, \max(y_{\text{min}}, y))$$

#### Expanding 8-Direction Ring Placement Algorithm
1. **Initial Evaluation:** Test preferred position $(x_0, y_0) = (\text{clamp}_X(\text{preferredX}), \text{clamp}_Y(\text{preferredY}))$. If clear of all placed labels and reserved rects, place immediately with $\text{displaced} = \text{false}$, $\text{displacementPx} = 0$.
2. **Ring Expansion:** If $(x_0, y_0)$ collides, search expanding concentric rings $r \in \{1, 2, 3, 4\}$.
   Step sizes:
   $$\Delta x_r = r \cdot (w_A + 2m), \quad \Delta y_r = r \cdot (h_A + 2m)$$
   Candidate offsets $(dx, dy)$ in order:
   - Up: $(0, -\Delta y_r)$
   - Down: $(0, \Delta y_r)$
   - Right: $(\Delta x_r, 0)$
   - Left: $(-\Delta x_r, 0)$
   - Up-Right: $(\Delta x_r, -\Delta y_r)$
   - Up-Left: $(-\Delta x_r, -\Delta y_r)$
   - Down-Right: $(\Delta x_r, \Delta y_r)$
   - Down-Left: $(-\Delta x_r, \Delta y_r)$
3. **Selection Criterion:** Evaluate candidate box $(x_c, y_c) = (\text{clamp}_X(\text{preferredX} + dx), \text{clamp}_Y(\text{preferredY} + dy))$.
   - Identify candidate with zero overlap having minimum Euclidean distance from preferred position:
     $$d(x_c, y_c) = \sqrt{(x_c - \text{preferredX})^2 + (y_c - \text{preferredY})^2}$$
   - If completely saturated (all candidates in rings $1..4$ collide), select candidate minimizing total overlap area.
4. **Leader Line Rule:** When a placed label is displaced by $> 8\,\text{px}$, the renderer projects a 1px leader line from $(\text{anchorX}, \text{anchorY})$ to the closest point $(x_{\text{edge}}, y_{\text{edge}})$ on the label's bounding box:
   $$x_{\text{edge}} = \max(x, \min(x + w, \text{anchorX})), \quad y_{\text{edge}} = \max(y, \min(y + h, \text{anchorY}))$$

---

### 3.2 URL-Scheme & `srcdoc` Security Guard (`src/ui/domSafety.ts`)

#### `isSafeUrl(value: unknown): boolean`
1. Rejects non-strings and empty/whitespace-only values.
2. Strips all ASCII control characters (`\x00-\x1F`, `\x7F`) and whitespace sequences.
3. Protocol-Relative URL Blocking: Rejects strings beginning with `//` or `\\`.
4. Scheme Extraction: Identifies delimiter character index $\min(i_{:}, i_{/}, i_{?}, i_{\#})$.
   - If delimiter is `:`, scheme is extracted and matched against allowlist:
     - `http`, `https`, `mailto`, `blob`: Allowed.
     - `data`: Allowed strictly for safe raster images: `^data:image\/(?:png|jpeg|jpg|webp)(?:;charset=[^;]+)?(?:;base64)?,`
     - All other schemes (`javascript`, `vbscript`, `data:text/html`, `data:image/svg+xml`, `file`, etc.): Blocked (`false`).
   - If no `:` delimiter exists before `/`, `?`, or `#`: Valid relative URL path/fragment (e.g. `/assets/tile.png`, `./local`, `#anchor`, `?query`): Allowed (`true`).

#### `createSafeElement<K>(tag, attrs?, textContent?): HTMLElementTagNameMap[K]`
1. Case-insensitively discards any attribute starting with `on` (e.g. `onclick`, `onload`, `onerror`).
2. Case-insensitively discards `srcdoc` attribute to prevent nested sandboxed frame bypasses.
3. For URL-bearing attributes (`href`, `src`, `action`, `formaction`, `xlink:href`, `poster`), verifies value via `isSafeUrl(val)`. Rejects attribute if unsafe.
4. Safely assigns `textContent` if provided.

---

### 3.3 MapLibre Air-Gap Failure Notice (`index.html`)

In `index.html`, when MapLibre satellite imagery tile fetches fail (offline status, CSP violation, or tile load error), `#map-renderer-notice` displays:
```
Air-gap mode: external map tiles blocked/offline — switch to Radar / SRTM DEM
```
This ensures clear operational status for tactical mission commanders operating in air-gapped environments.

---

## 4. Verification Test Plan (Suite 102)

| Test ID | Gate Name | Assertion Criteria |
| :--- | :--- | :--- |
| **CDS-T1** | 2D Label De-Cluttering Zero-Overlap & Exclusion Zones | 12 identical-anchor labels placed at $(400, 300)$ inside $800 \times 600$ with reserved left rail ($0..48 \times 0..600$): `computeTotalOverlapArea() === 0`, 100% viewport containment, zero collisions with reserved rail, accurate `displaced` and `displacementPx`, deterministic output. |
| **CDS-T2** | 60 fps Performance Micro-Benchmark | 1,000 frames $\times$ 25 overlapping labels executes in $< 50\,\text{ms}$ ($< 50\,\mu\text{s}/\text{frame}$). |
| **CDS-T3** | `domSafety.ts` URL-Scheme & `srcdoc` Penetration Tests | `isSafeUrl` and `createSafeElement` strictly neutralize `javascript:alert(1)`, `JaVaScRiPt:alert(1)`, `\u0000\t\njavascript:alert(1)`, `vbscript:msgbox(1)`, `data:text/html,<script>alert(1)</script>`, `data:image/svg+xml,<svg onload=alert(1)>`, `//evil.com/x`, and `srcdoc`. Cleanly allows `https://`, `/local/path`, `#anchor`, `mailto:`, `blob:`. |
| **CDS-T4** | Integration & Zero-Slop Gate | Verifies `index.html` wires `createLabelPlacer` cleanly with zero emojis, zero duplicate DOM IDs, and valid air-gap notice. |
