# SPEC-WALKABLE-TERRAIN-PATHFINDER-AND-OBSTACLE-AVOIDANCE: Step-by-Step Intermediate Slope Audit, Vehicle Incline Limits & 3D Barrier Detour Routing

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity per AGENTS.md)  
**Target Runtimes:** `src/core/tacticalAiPathfinder.ts`, `src/shared/workerProtocol.ts`, `src/worker/simWorker.ts`, `src/worker/telemetrySerializer.ts`, `index.html`, `src/tests/verifyWalkablePathfinderAndObstacleAvoidance.ts`, `scripts/run_all_verifications.mjs`, `package.json`, `README.md`  

---

## 1. Executive Summary & Operational Context

In extreme high-relief alpine environments like the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$), tactical ground nodes—whether dismounted soldier squads or heavy wheeled Mobile Command Posts (MCP)—navigate treacherous micro-topography. While a macro-level recovery waypoint may exhibit a seemingly benign net average slope (e.g. $1.4^\circ$ over $400\text{ m}$), intermediate micro-terrain features such as vertical razorback cliffs ($> 60^\circ$ pitch) or user-placed 3D barrier obstacles (fortified walls, communication blocks, barbed radar screens) present impassable and lethal physical barriers.

Previously, the Edge-AI pathfinder evaluated only the endpoint-to-endpoint chord slope and ray LoS clearance against airborne relay nodes. 

This specification upgrades the Edge-AI pathfinder to guarantee **100% step-by-step intermediate terrain walkability and 3D obstacle avoidance**:
1. **Intermediate $30\text{ m}$ Ground Step Slope Audit:** Every proposed ground path leg is discretized into intermediate steps $\Delta s \le 30.0\text{ m}$. At each step $k$, the local gradient $\theta_{\text{step}, k} = |\text{atan2}(\Delta z_k, \Delta s_k) \cdot \frac{180}{\pi}|$ is audited against unit-specific physical thresholds ($\le 30.0^\circ$ for dismounted soldiers, $\le 18.0^\circ$ for wheeled MCP vehicles).
2. **2D Ground Footprint Obstacle Collision Check:** All candidate path legs are tested against user-placed 3D obstacle footprints (`cuboid`, `cone`, `pyramid`). Any direct crossing is strictly marked blocked (`blockedByObstacle = true`).
3. **2-Segment Lateral Dogleg Detour & Contour Routing:** When a direct line encounters an intermediate cliff or 3D barrier, the engine automatically synthesizes two $\pm 40^\circ$ lateral detour dogleg paths $[P_{\text{start}}, P_{\text{mid}}, P_{\text{target}}]$ around the barrier or cliff along gentler contours. If neither direct nor detour paths are walkable, the candidate site is strictly rejected.
4. **Authoritative Segment-by-Segment Worker Traverse:** In `simWorker.ts`, moving units navigate sequentially through all path waypoints ($P_0 \to P_1 \to P_2$), adjusting velocity dynamically via Tobler's Hiking Function for each segment's local grade.
5. **Multi-Waypoint Visual Footpath:** `#radar-canvas` renders the full polyline connecting all waypoints, with intermediate cyan turn vertices `[WP1]` and real-time walkability metrics `[WALKABLE: Max Slope θ° ≤ θ_max°]`.

---

## 2. Mathematical Formulations & Physical Limits

### 2.1 Unit-Specific Maximum Slope Constraints
Physical mobility limits depend fundamentally on propulsion kinematics:
- **Dismounted Infantry (`SOLDIER` / `INFANTRY`):**
  $$\theta_{\max, \text{SOLDIER}} = 30.0^\circ \quad (57.7\% \text{ grade})$$
  Slopes exceeding $30.0^\circ$ present severe fall hazards and scree instability for combat-loaded infantry carrying tactical radio gear.
- **Wheeled Mobile Command Post (`MCP` / `VEHICLE`):**
  $$\theta_{\max, \text{MCP}} = 18.0^\circ \quad (32.5\% \text{ grade})$$
  Heavy 6x6 / 8x8 tactical wheeled vehicles suffer rollover, traction loss, and transmission overheating on continuous grades $> 18.0^\circ$.

```typescript
export function getMaxPassableSlopeDeg(nodeType: string = 'SOLDIER'): number {
  const norm = nodeType.toUpperCase();
  if (norm === 'MCP' || norm === 'VEHICLE') {
    return 18.0;
  }
  return 30.0;
}
```

### 2.2 Intermediate $30\text{ m}$ Step Discretization & Tobler Integration
Given a proposed polyline leg from $P_m = (x_m, y_m, z_m)$ to $P_{m+1} = (x_{m+1}, y_{m+1}, z_{m+1})$:
$$d_{\text{leg}} = \sqrt{(x_{m+1} - x_m)^2 + (y_{m+1} - y_m)^2}$$
$$N_{\text{steps}} = \max\left(2, \left\lceil \frac{d_{\text{leg}}}{30.0\text{ m}} \right\rceil\right), \quad \Delta s_k = \frac{d_{\text{leg}}}{N_{\text{steps}}} \le 30.0\text{ m}$$

For each step $k \in \{1, \dots, N_{\text{steps}}\}$:
$$u_k = \frac{k}{N_{\text{steps}}}$$
$$x_k = x_m + u_k (x_{m+1} - x_m), \quad y_k = y_m + u_k (y_{m+1} - y_m)$$
$$z_k = \text{getElevationAt}(x_k, y_k), \quad \Delta z_k = z_k - z_{k-1}$$
$$\theta_{\text{step}, k} = \left| \text{atan2}(\Delta z_k, \Delta s_k) \cdot \frac{180^\circ}{\pi} \right|$$

**Passability Rule:**
If $\exists k : \theta_{\text{step}, k} > \theta_{\max}(\text{nodeType})$, the path leg is rejected:
$$\text{isWalkable} = \text{false}, \quad \text{exceededSlopeLimit} = \text{true}$$

For all passable steps, instantaneous walking speed is integrated via Waldo Tobler's Hiking Function:
$$S_k = \frac{\Delta z_k}{\Delta s_k}$$
$$v_k = v_{\max} \cdot \exp\big(-3.5 \cdot |S_k + 0.05|\big)$$
$$\Delta t_k = \frac{\Delta s_k}{\max(v_k, 0.1\text{ m/s})}$$
$$\text{totalEtaSeconds} = \sum_k \Delta t_k, \quad \theta_{\max, \text{observed}} = \max_k \theta_{\text{step}, k}$$

### 2.3 3D Obstacle Ground Footprint Collision Check
For each leg $\overline{P_m P_{m+1}}$ and each obstacle $O_j \in \mathcal{O}$:
$$\text{intersectsFootprint} = \text{footprintInterval}(O_j, P_m, P_{m+1}) \neq \text{null} \lor \text{containsPoint}(O_j, P_m) \lor \text{containsPoint}(O_j, P_{m+1})$$
If any obstacle collides with the ground leg:
$$\text{isWalkable} = \text{false}, \quad \text{blockedByObstacle} = \text{true}$$

### 2.4 2-Segment Lateral Dogleg Detour Synthesis
When direct path $[P_{\text{start}}, P_{\text{target}}]$ is blocked by an obstacle or intermediate cliff:
1. Compute midpoint $M = \frac{1}{2}(P_{\text{start}} + P_{\text{target}})$.
2. Calculate perpendicular normal vector $\hat{n} = (-\hat{u}_y, \hat{u}_x)$ where $\hat{u} = \frac{P_{\text{target}} - P_{\text{start}}}{\|P_{\text{target}} - P_{\text{start}}\|}$.
3. Calculate lateral offset distance $L = \max(0.5 \cdot d \cdot \tan(40^\circ), R_{\text{obs}} + 20.0\text{ m})$.
4. Generate two detour midpoints $P_{\text{mid}, \pm} = M \pm L \hat{n}$, with $z_{\text{mid}, \pm} = \text{getElevationAt}(P_{\text{mid}, \pm})$.
5. Evaluate both candidate 3-waypoint doglegs $[P_{\text{start}}, P_{\text{mid}, \pm}, P_{\text{target}}]$.
6. If a detour path is walkable, adopt it with `detouredAroundObstacle = true`. If neither direct nor detour paths are walkable, strictly reject candidate site $P_{\text{target}}$.

---

## 3. Data Structures & Architectural Seams

### 3.1 `src/core/tacticalAiPathfinder.ts`
```typescript
export interface GroundPathWalkabilityResult {
  readonly isWalkable: boolean;
  readonly totalPathDistM: number;
  readonly totalEtaSeconds: number;
  readonly maxStepSlopeDeg: number;
  readonly maxAllowedSlopeDeg: number;
  readonly blockedByObstacle: boolean;
  readonly exceededSlopeLimit?: boolean;
  readonly failedLegIndex?: number;
  readonly failedStepIndex?: number;
}

export function getMaxPassableSlopeDeg(nodeType?: string): number;
export function evaluateGroundPathWalkability(
  waypoints: readonly Position3D[],
  nodeType?: string,
  getElevationAt: (x: number, y: number) => number,
  obstacles?: readonly any[]
): GroundPathWalkabilityResult;
```

### 3.2 Protocol & Telemetry Contracts (`src/shared/workerProtocol.ts`, `src/worker/telemetrySerializer.ts`)
Extended telemetry fields:
- `readonly ai_walk_path_enu?: readonly Position3D[];`
- `readonly ai_max_step_slope_deg?: number;`

### 3.3 Authoritative Web Worker Traverse (`src/worker/simWorker.ts`)
- Supplies `this.terrainEngine.obstacleField.all` to `computeAiRecoveryAdvisory`.
- Manages sequential traversal across `waypoints` in `aiActiveMovements`.
- Dynamically recalculates Tobler velocity for each segment based on that segment's specific grade.

### 3.4 Canvas Visual Footpath (`index.html`)
- Renders multi-segment polyline with dashed emerald styling `#10b981`.
- Renders intermediate cyan dots `#06b6d4` with `[WPk]` badges at turn vertices.
- Updates `#ai-directive-readout` with `Max Slope: ${ai_max_step_slope_deg}° [WALKABLE]`.

---

## 4. Verification Suite Matrix (Suite 82: WPO-T1–T4)

| Test ID | Name | Verification Objective |
|---|---|---|
| **WPO-T1** | Intermediate Cliff Rejection | Synthetic terrain with average slope $1.4^\circ$ but vertical cliff $>60^\circ$ at $x=200\text{m}$. Straight path rejected; routes via walkable contour/bearing where all 30m steps $\le 30^\circ$. |
| **WPO-T2** | Unit Slope Limits | $24^\circ$ slope accepted as walkable for `SOLDIER` ($\le 30^\circ$) but rejected for wheeled `MCP` ($> 18^\circ$). |
| **WPO-T3** | 3D Barrier Collision & Detour | 3D obstacle wall directly between node and target. Direct path flagged `blockedByObstacle = true`; advisory discovers walkable detour around wall. |
| **WPO-T4** | Invariance & Spec Persistence | Spec exists on disk, linked in `README.md`, and `c2-console-theme.css` is untouched. |
