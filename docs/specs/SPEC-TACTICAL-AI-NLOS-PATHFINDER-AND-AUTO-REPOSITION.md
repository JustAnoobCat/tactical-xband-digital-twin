# SPEC-TACTICAL-AI-NLOS-PATHFINDER-AND-AUTO-REPOSITION: 100% Local, Ultra-Lightweight Edge-AI NLoS Link-Recovery Pathfinder & Autonomous Self-Healing Engine

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity per AGENTS.md)  
**Target Runtimes:** `src/core/tacticalAiPathfinder.ts`, `src/shared/workerProtocol.ts`, `src/worker/simWorker.ts`, `src/worker/telemetrySerializer.ts`, `index.html`, `src/tests/verifyTacticalAiPathfinder.ts`, `scripts/run_all_verifications.mjs`, `package.json`, `README.md`  

---

## 1. Executive Summary & Operational Context

In high-relief mountainous topography such as the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$), tactical airborne relay networks frequently suffer from severe Non-Line-of-Sight (NLoS) link dropouts caused by ridgeline occlusion, deep re-entrants, and knife-edge diffraction shadow zones. When a dismounted soldier squad or Mobile Command Post (MCP) is occluded by steep mountain ridges, high-bandwidth X-band ($8.0\text{ GHz}$) communications drop into deep outage ($<-10\text{ dB}$ SINR), cutting off vital C2 command, voice PTT, and ISR video telemetry.

Historically, stranded ground units either had to guess where to move to regain signal or stay stationary while waiting for an airborne relay (ACN) orbit to clear the crest. 

This specification introduces a **100% local, ultra-lightweight (< 16 KB RAM, < 0.25 ms CPU time)** Edge-AI NLoS Link-Recovery Pathfinder and Autonomous Squad Self-Healing Engine. It operates completely self-contained within the digital twin runtime with **zero external dependencies, zero network requests, and zero alterations to the global page layout**:
1. **DEM Topographic Gradient Pre-Pruning ($\nabla z$):** Evaluates local slope gradients $\frac{\partial z}{\partial x}, \frac{\partial z}{\partial y}$ to identify candidate micro-terrain sites along ridge shoulders and ACN line-of-sight vectors, pruning search space down to only 24 candidate sites.
2. **Online Tabular Q-Learning (`Float32Array(256)`):** Pre-allocates a single $1\text{ KB}$ ($16\text{ nodes} \times 16\text{ compass sectors}$) Q-table in memory that reinforces spatial bearings that reliably yield high SINR links over time.
3. **Tobler's Hiking Function (1993):** Calculates human and vehicle biomechanical walking/driving speeds and traversal times ($v(S) = v_{\max} e^{-3.5|S+0.05|}$), enforcing realistic foot-mobility constraints and marking cliffs $>35^\circ$ impassable.
4. **Authoritative Autonomous Worker Repositioning:** Dispatches micro-movements on the 50 Hz discrete-event loop inside `simWorker.ts` upon operator command or autonomous squad self-healing trigger.
5. **On-Canvas Guidance & C2 Directives:** Displays crisp tactical radio directives and renders glowing `[★ AI-SAFE]` beacons with directional chevrons on `#radar-canvas`.

---

## 2. Mathematical Formulations & Biomechanics

### 2.1 Tobler's Hiking Function (1993)
Ground node traverse velocity across mountainous terrain is modeled via Waldo Tobler's empirical hiking function, parametrized by slope ratio $S = \frac{\Delta z}{\max(d_{\text{horiz}}, 1.0)}$:
$$\theta_{\text{slope}} = \text{atan2}(\Delta z, \max(d_{\text{horiz}}, 1.0)) \cdot \frac{180^\circ}{\pi}$$
$$v_{\text{Tobler}}(S) = v_{\max} \cdot \exp\big(-3.5 \cdot |S + 0.05|\big)$$
where base maximum velocity $v_{\max}$ is:
- $v_{\max} = 2.2\text{ m/s}$ ($7.92\text{ km/h}$) for dismounted soldier units (`SOLDIER` / `INFANTRY`)
- $v_{\max} = 8.5\text{ m/s}$ ($30.6\text{ km/h}$) for vehicular command posts (`MCP` / `VEHICLE`)

**Impassable Cliff Constraint:**
$$\text{isPassable} = |\theta_{\text{slope}}| \le 35.0^\circ$$
Any slope steeper than $35.0^\circ$ is marked impassable, preventing the AI pathfinder from suggesting lethal vertical cliff descents or ascents.

Traversal time estimate:
$$\text{ETA}_{\text{seconds}} = \frac{d_{\text{horiz}}}{\max(v_{\text{Tobler}}(S), 0.1)}$$

### 2.2 Topographic Gradient DEM Pre-Pruning ($\nabla z$) & Fast 10-Step Ray March
Instead of brute-force grid evaluations, the algorithm samples 4 cardinal DEM neighbors ($\pm 50\text{ m}$) around the stranded unit $(x_0, y_0)$ to compute the local uphill gradient vector:
$$\frac{\partial z}{\partial x} = \frac{z(x_0 + 50, y_0) - z(x_0 - 50, y_0)}{100.0}$$
$$\frac{\partial z}{\partial y} = \frac{z(x_0, y_0 + 50) - z(x_0, y_0 - 50)}{100.0}$$
$$\theta_{\text{uphill}} = \big(\text{atan2}(\frac{\partial z}{\partial x}, \frac{\partial z}{\partial y}) \cdot \frac{180}{\pi} + 360\big) \pmod{360}$$

Simultaneously, the bearing from the stranded unit to the airborne ACN is computed:
$$\theta_{\text{acn}} = \big(\text{atan2}(x_{\text{acn}} - x_0, y_{\text{acn}} - y_0) \cdot \frac{180}{\pi} + 360\big) \pmod{360}$$

The search space is pruned to **exactly 24 candidate micro-terrain sites**:
- **8 Priority Bearings:** Centered around $\theta_{\text{acn}}$, $\theta_{\text{acn}} \pm 45^\circ$, $\theta_{\text{acn}} \pm 90^\circ$, $\theta_{\text{uphill}}$, $\theta_{\text{uphill}} \pm 45^\circ$.
- **3 Radial Distances:** $r \in \{120\text{ m}, 320\text{ m}, 650\text{ m}\}$.

For each candidate $\vec{r}_c = (x_c, y_c, z_c + 2.0\text{ m})$, a fast 10-step curved-Earth ray march is performed against the ACN coordinates $(x_{\text{acn}}, y_{\text{acn}}, z_{\text{acn}})$, incorporating 4/3 effective Earth radius curvature bulge ($R_{\text{eff}} \approx 8,494,667\text{ m}$) and ITU-R P.526 knife-edge Fresnel diffraction parameters ($\nu$).

### 2.3 Pre-Allocated Online Tabular Q-Learning (`Float32Array(256)`)
To learn optimal evasion and recovery directions across repeated missions without costly neural networks, the engine maintains an ultra-compact Q-table stored in a single flat buffer:
$$\text{Buffer Size} = 16\text{ nodes} \times 16\text{ compass sectors} \times 4\text{ bytes} = 1,024\text{ bytes (1 KB!)}$$

Each sector spans $\frac{360^\circ}{16} = 22.5^\circ$. Upon node arrival or link evaluation, the Q-value is updated via temporal difference with learning rate $\alpha = 0.15$:
$$Q[nodeId, s] \leftarrow (1 - \alpha) Q[nodeId, s] + \alpha \cdot \text{clamp}_{[-10, 30]}(\text{observedSinrDb})$$

### 2.4 Multi-Objective Recovery Utility Function
Candidate sites are scored using the multi-objective utility function:
$$U(\vec{r}_c) = 2.5 \cdot \text{candSinrDb} + (\text{candIsLoS} ? 35.0 : 0.0) + 0.5 \cdot Q[nodeId, s] - 0.08 \cdot \text{ETA}_{\text{seconds}}$$
If a candidate is impassable ($|\theta_{\text{slope}}| > 35^\circ$), $U(\vec{r}_c) \leftarrow -\infty$.

The candidate maximizing $U(\vec{r}_c)$ is selected as the winning recovery waypoint $\vec{r}^* = (x^*, y^*, z^*)$.

---

## 3. Architecture & Seam Specifications

### 3.1 `src/core/tacticalAiPathfinder.ts`
Exports:
- `computeToblerWalkingSpeedMs(horizDistM, deltaElevM, nodeType)`
- `EdgeAiQTable` class wrapping `Float32Array(256)`
- `computeAiRecoveryAdvisory(params: AiRecoveryAdvisoryParams): AiNodeRecoveryRecommendation`
- `formatAiDirectiveText(...)` helper

### 3.2 Protocol & Inbound Commands (`src/shared/workerProtocol.ts`)
Inbound commands:
- `TRIGGER_AI_NODE_REPOSITION`: `{ type: 'TRIGGER_AI_NODE_REPOSITION'; nodeId: number }`
- `SET_AI_AUTO_HEAL`: `{ type: 'SET_AI_AUTO_HEAL'; enabled: boolean }`

Telemetry extension in `NodeTelemetryItem`:
- `ai_needs_reposition?: boolean;`
- `ai_target_pos_enu?: readonly [number, number, number];`
- `ai_move_dist_m?: number;`
- `ai_move_bearing_deg?: number;`
- `ai_move_cardinal?: string;`
- `ai_delta_elev_m?: number;`
- `ai_slope_deg?: number;`
- `ai_eta_s?: number;`
- `ai_predicted_sinr_db?: number;`
- `ai_predicted_modcod?: string;`
- `ai_predicted_bitrate_mbps?: number;`
- `ai_directive_text?: string;`
- `ai_is_moving?: boolean;`

Telemetry frame extension:
- `ai_auto_heal_enabled?: boolean;`
- `ai_active_repositions_count?: number;`

### 3.3 Authoritative Web Worker Loop (`src/worker/simWorker.ts`)
- Manages pre-allocated `EdgeAiQTable` instance.
- Caches per-node recovery advisory and throttles evaluations to $\ge 50$ ticks ($1.0\text{ s}$) between calls when in outage or degraded ($< 8\text{ dB}$).
- Handles `TRIGGER_AI_NODE_REPOSITION` and autonomous squad self-healing:
  Smoothly interpolates node position along `(x, y)` at Tobler walking speed on each 20 ms tick across `nodesStatic`, `nodesTac`, and `nodesReactive`, clamping $z = \text{terrainElevation}(x, y) + \text{aglM}$.
  When node reaches within $2.0\text{ m}$ of target, movement is finalized and Q-table is updated with the restored link SINR.

### 3.4 Main Thread UI & Canvas Visualizations (`index.html`)
- **Radar Canvas Guidance Vectors:**
  Draws a dashed cyan/emerald line from stranded node to target waypoint with directional arrow chevrons `▸▸`.
  Draws a glowing emerald beacon: `[★ AI-SAFE +XX.XdB]` and distance/bearing readout.
- **Node Inspector Card (`#ai-pathfinder-card`):**
  Houses `#ai-directive-readout`, `#btn-ai-reposition-node`, and `#btn-ai-auto-heal-toggle`.
- **Global Layout Invariance:**
  `.rail`, `.topbar`, `.app-shell`, `#radar-container`, and `frontend/c2-console-theme.css` remain 100% untouched.

---

## 4. Verification Protocol & Acceptance Criteria

Automated verification suite `src/tests/verifyTacticalAiPathfinder.ts` (registered as Suite 81 in `scripts/run_all_verifications.mjs` and `package.json`):
1. **AIP-T1 (Tobler Biomechanics & Execution Budget):**
   - Asserts Tobler hiking speed decreases with positive slope and peaks around $S = -0.05$.
   - Asserts slopes $> 35^\circ$ are marked impassable.
   - Asserts single `computeAiRecoveryAdvisory` call executes in $< 1.0\text{ ms}$ (target $< 0.25\text{ ms}$).
2. **AIP-T2 (NLoS Recovery Waypoint Discovery & Q-Learning):**
   - In an occluded shadow zone behind a ridge, finds a valid walkable recovery coordinate with predicted SINR improvement $> +5\text{ dB}$.
   - Asserts `EdgeAiQTable` updates in-place inside `Float32Array(256)`.
3. **AIP-T3 (Worker Autonomous Node Repositioning):**
   - Dispatches `TRIGGER_AI_NODE_REPOSITION` in `SimulationWorkerManager`.
   - Steps simulation loop and verifies node position moves towards target and improves SINR.
4. **AIP-T4 (DOM Controls, Spec Persistence & Global Layout Invariance):**
   - Asserts `#ai-pathfinder-card`, `#ai-directive-readout`, `#btn-ai-reposition-node`, and `#btn-ai-auto-heal-toggle` exist in `index.html`.
   - Asserts `frontend/c2-console-theme.css` has zero git diff.
   - Asserts specification file exists on disk and is linked in Section 7 of `README.md`.
