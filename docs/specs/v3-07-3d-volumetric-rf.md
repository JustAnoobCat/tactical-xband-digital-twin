# Implementation Specification: V3-07 3D Volumetric RF Visualization & Interactive Raycast Picking

**Document Version:** 1.0.0  
**Status:** Approved for Implementation (Role 2)  
**Authoritative Scope:** Pure headless 3D volumetric RF math, GPU-light Three.js volumetric RF layer, 3D scene controller integration, 3D HUD controls, and Suite 109 verification.

---

## 1. System Architecture & Context

The Tactical X-Band Air-to-Ground Network Digital Twin operates in high-relief mountainous terrain (Ladakh sector). While the authoritative simulation engine advances at 50 Hz in a Web Worker, the main-thread 3D visualization subsystem renders the tactical theater using Three.js.

Feature **V3-07** enhances the 3D scene with:
1. **3D $0.6 F_1$ Fresnel Clearance Ellipsoids**: Visualizing the first Fresnel zone ($0.6 F_1$ knife-edge boundary) between the ACN relay and all active ground terminals.
2. **3D Banking Quad-Sector Antenna Lobes**: Visualizing the 4 directional antenna lobes ($S_0$ Forward, $S_1$ Starboard, $S_2$ Aft, $S_3$ Port) with authentic Tait-Bryan attitude rotation reflecting UAV roll, pitch, and yaw.
3. **3D EW Jammer & Storm Weather Volumes**: Visualizing active electronic warfare jamming bubbles and advecting precipitation cells as translucent volumetric geometries.
4. **Interactive 3D Raycast Picking**: Providing click-vs-drag pointer disambiguation ($< 5\text{ px}$) to select ground terminals directly from the 3D canvas with mountain occlusion culling.
5. **Obsidian 3D HUD Toggles & CVD Calibration**: Three compact matte HUD buttons (`Fresnel`, `Lobes`, `Volumes`) inside `.three-hud-overlay` dynamically synchronized with CVD accessibility palettes.

---

## 2. Coordinate System & Mathematical Formulations

### 2.1 Coordinate Mapping
The Three.js root frame and simulation frames are defined per M6.2:
- **Simulation Frame (ENU)**: $+X$ East (m), $+Y$ North (m), $+Z$ Altitude MSL (m).
- **Three.js Root Frame**: $+X$ East (m), $+Y$ Altitude MSL (m), $+Z$ South ($-Y_{\text{sim}}$ m).
- **worldGroup Orientation**: Rotated $-\pi/2$ around Three.js $X$ axis, so internal local coordinates match simulation coordinates $(X, Y, Z)$.

### 2.2 First Fresnel Zone Radius ($r_{1,\max}$ and $0.6 F_1$)
For carrier frequency $f_c$ (default $8.0\text{ GHz}$, $\lambda = c / f_c \approx 0.037474\text{ m}$) and total slant range $D$, the radius of the $n$-th Fresnel zone at distances $d_1, d_2$ ($d_1 + d_2 = D$) is:
$$r_n(d_1, d_2) = \sqrt{\frac{n \lambda d_1 d_2}{D}}$$

At the midpoint chord position ($d_1 = d_2 = D / 2$):
$$r_{1,\max} = \frac{1}{2}\sqrt{\lambda D}$$
The authoritative $0.6 F_1$ clearance radius required for diffraction-free line-of-sight propagation is:
$$r_{0.6 F_1} = 0.6 \cdot r_{1,\max} = 0.3 \sqrt{\lambda D}$$

For $D = 40\,000\text{ m}$ at $f_c = 8.0\text{ GHz}$:
$$r_{1,\max} = \frac{1}{2}\sqrt{0.037474057 \times 40000} = \frac{1}{2}\sqrt{1498.962} \approx 19.358\text{ m}$$
$$r_{0.6 F_1} = 0.6 \times 19.3582 = 11.615\text{ m}$$

### 2.3 Orthonormal Chord Basis Construction
Given transmitter position $\mathbf{p}_{\text{tx}}$ and receiver position $\mathbf{p}_{\text{rx}}$:
- Center: $\mathbf{c} = \frac{1}{2}(\mathbf{p}_{\text{tx}} + \mathbf{p}_{\text{rx}})$
- Chord vector: $\mathbf{v} = \mathbf{p}_{\text{rx}} - \mathbf{p}_{\text{tx}}$
- Chord length: $L = \|\mathbf{v}\|$
- Unit chord: $\mathbf{a}_y = \mathbf{v} / L$

To construct an exact right-handed orthonormal basis $\mathbf{B} = [\mathbf{a}_x, \mathbf{a}_y, \mathbf{a}_z]$ such that $\mathbf{B}^\top \mathbf{B} = \mathbf{I}$ and $\det(\mathbf{B}) = +1$:
1. Select reference vector:
   $$\mathbf{u}_{\text{ref}} = \begin{cases} [1, 0, 0]^\top & \text{if } |a_{y,x}| < 0.9 \\ [0, 0, 1]^\top & \text{otherwise} \end{cases}$$
2. Orthogonalize via Gram-Schmidt:
   $$\mathbf{w} = \mathbf{u}_{\text{ref}} - (\mathbf{u}_{\text{ref}} \cdot \mathbf{a}_y) \mathbf{a}_y, \quad \mathbf{a}_x = \frac{\mathbf{w}}{\|\mathbf{w}\|}$$
3. Complete right-handed basis:
   $$\mathbf{a}_z = \mathbf{a}_x \times \mathbf{a}_y$$
This guarantees $\det([\mathbf{a}_x, \mathbf{a}_y, \mathbf{a}_z]) = +1$ and $|\mathbf{B}^\top \mathbf{B} - \mathbf{I}| < 10^{-12}$ for all chord orientations, including vertical chords.

### 2.4 Tait-Bryan Quad-Sector Antenna Lobes
The ACN carries 4 directional horn/patch sector antennas with $90^\circ$ azimuth spacing and $-15^\circ$ elevation downtilt:
- $S_0$ (Forward): Boresight azimuth $0^\circ$
- $S_1$ (Starboard): Boresight azimuth $+90^\circ$
- $S_2$ (Aft): Boresight azimuth $180^\circ$
- $S_3$ (Port): Boresight azimuth $270^\circ$ ($-90^\circ$)

Given Tait-Bryan attitude angles $(\psi, \theta, \phi)$ (Yaw, Pitch, Roll):
- In level flight ($\theta = 0, \phi = 0$), all 4 lobes point downward with elevation $-\sin(15^\circ)$, resulting in identical world Y components.
- During a right bank ($\phi > 0$):
  - Starboard wing drops: Starboard lobe $S_1$ tilts downward ($\text{dir}_{Y, S1} = -\sin(15^\circ + \phi) < -\sin(15^\circ)$).
  - Port wing rises: Port lobe $S_3$ tilts upward ($\text{dir}_{Y, S3} = \sin(\phi - 15^\circ) > -\sin(15^\circ)$).

### 2.5 3D Raycast Picking Disambiguation
To prevent accidental node selection during camera orbit/pan gestures:
- Measure cursor displacement $\Delta d = \sqrt{(x_{\text{up}} - x_{\text{down}})^2 + (y_{\text{up}} - y_{\text{down}})^2}$.
- If $\Delta d \ge 5.0\text{ px}$, the interaction is classified as a drag gesture and raycast picking is suppressed.
- If $\Delta d < 5.0\text{ px}$, a 3D ray is cast from camera through normalized device coordinates (NDC).
- Ground terminal selection prioritizes nearest visible node marker within picking radius, provided the ray is not occluded by intervening terrain geometry.

---

## 3. GPU Pooling & Resource Lifecycle

To meet the 50 Hz real-time budget ($< 20\text{ ms}$) and prevent garbage collection pauses:
1. **Shared Unit Geometries**:
   - `THREE.SphereGeometry(1, 16, 12)` shared across all 16 link Fresnel ellipsoids.
   - `THREE.ConeGeometry(1, 1, 16)` shared across all 4 sector lobes.
   - `THREE.CylinderGeometry(1, 1, 1, 24)` shared across weather and threat cylinders.
2. **Fixed Object Pools**:
   - Pre-allocated mesh instances updated in-place via matrix transformations (`position`, `quaternion`, `scale`).
   - Toggled via `mesh.visible = false` when links or volumes are inactive.
   - Zero per-frame `new THREE.Mesh()`, `new THREE.BufferGeometry()`, or `new THREE.Material()` inside the render or telemetry update loop.
3. **Clean Disposal**:
   - Explicit `dispose()` method freeing all pooled geometries, materials, and child groups.

---

## 4. Verification & Test Strategy (Suite 109)

Suite 109 (`src/tests/verifyThreeVolumetricRf.ts`) verifies:
- **[VRF-T1] Exact Analytical Fresnel Ellipsoid Geometry & Orthonormality**: Tests $r_{1,\max}$ and $0.6 F_1$ against analytical values at $40\text{ km}$, and tests basis orthogonality $|\mathbf{B}^\top \mathbf{B} - \mathbf{I}| < 10^{-12}$ and $\det(\mathbf{B}) = +1$ across horizontal, slanted, and vertical chords.
- **[VRF-T2] 3D Banking Quad-Sector Lobe Attitude Physics**: Proves level symmetry and right bank asymmetry ($S_1$ tilts down, $S_3$ tilts up).
- **[VRF-T3] Threat/Weather Volumes, CVD Color Mapping & Raycast Picking**: Verifies dome/cylinder scale descriptors, CVD palette mapping, and deterministic nearest-node distance picking.
- **[VRF-T4] Layer Lifecycle, Zero-Allocation Micro-Benchmark & UI Contract**: Verifies pool stability across 100 update cycles, `< 30\text{ ms}` benchmark for 1,000 updates, and presence of `#btn-3d-fresnel`, `#btn-3d-lobes`, `#btn-3d-volumes` with proper ARIA attributes in `index.html`.
