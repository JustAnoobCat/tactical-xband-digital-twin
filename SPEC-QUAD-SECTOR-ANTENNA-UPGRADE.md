<USER_REQUEST>
---

```markdown
# SPEC-QUAD-SECTOR-ANTENNA-UPGRADE: Body-Fixed 4-Sector ACN Antenna Array (0°, 90°, 180°, 270°) & Parallel Per-Sector TDMA

**Status:** AUTHORITATIVE IMPLEMENTATION SPECIFICATION  
**Target Runtime:** TypeScript WebWorker Engine (`src/core/*`, `src/worker/*`, `src/shared/*`, `index.html`)  
**Verification Gate:** `npm run typecheck`, `npm run verify` (`scripts/verify-project.mjs`), `node scripts/run_all_verifications.mjs`

---

## 0. CRITICAL GUARDRAILS (DO NOT VIOLATE)

Before modifying any file, observe these strict compatibility rules enforced by `scripts/verify-project.mjs`, `scripts/verify-browser-ux.mjs`, and the 54 suites in `scripts/run_all_verifications.mjs`:

1. **Preserve Exact Regex Contracts in `scripts/verify-project.mjs`:**
   - In `src/worker/simWorker.ts`:
     - Must keep exact substring: `this.staticScheduler = new LegacyStaticScheduler()`
     - Must keep exact substring: `this.tacScheduler = new TerrainAwareDynamicScheduler(0.008)`
     - Must keep exact substrings:
       - `staticScheduledUlTimeS += reportStatic.totalUlScheduledS`
       - `tacScheduledUlTimeS += reportTac.totalUlScheduledS`
       - `staticPayloadBitsDequeued += reportStatic.totalPayloadBitsDequeued`
       - `tacPayloadBitsDequeued += reportTac.totalPayloadBitsDequeued`
       - `staticDelayDropsThisRun += reportStatic.packetsDroppedDelayThisFrame`
       - `tacOverflowDropsThisRun += reportTac.packetsDroppedOverflowThisFrame`
   - In `src/core/scheduler.ts`:
     - Must keep the exact regex match `/ls\.isOutage\)\)\s*\)\s*\{\s*continue/` inside `TerrainAwareDynamicScheduler.scheduleFrame()`. Do NOT reformat or split `if (!ls || pred.isHardShadow || ls.bitrateBps <= 0 || ls.isOutage) { continue; }`.
2. **Preserve Backwards-Compatible Function Signatures for Unit Tests:**
   - Existing unit tests (`verifyPhysics.ts`, `verifyScheduler.ts`, `verifyVariableTdma.ts`, `verifyRfBandwidth.ts`) call `linkBudgetEngine.evaluateLink(...)` and `scheduler.scheduleFrame(...)` with synthetic mock objects that do NOT include `activeSectorId`.
   - All new parameters on `evaluateLink()` and `scheduleFrame()` MUST be optional, and when `linkStatuses` passed to `scheduleFrame()` have `activeSectorId === undefined` on all entries, the scheduler must gracefully fall back to single-pool scheduling so legacy unit tests pass 100% unmodified.
3. **Preserve Playwright UX Contracts in `scripts/verify-browser-ux.mjs`:**
   - Never introduce any visible DOM text with `font-size < 10px`.
   - Every new `<input>` or `<select>` must have an explicit `aria-label` or `<label for="...">`.
   - Do not cause `#radar-container` to resize when selecting a node.

---

## 1. ARCHITECTURAL OVERVIEW

We are upgrading the Aerial Communication Node (ACN) from a single isotropic antenna to a **Body-Fixed 4-Sector Quadrant Array** mounted at airframe azimuths **0° (Nose/FWD), 90° (Starboard/STBD), 180° (Tail/AFT), and 270° (Port/PORT)** operating in **4-Channel Parallel Per-Sector TDMA**:

1. **Airframe Attitude Coupling (`QuadSectorAntennaEngine`):**
   - At each 20 ms step, the ACN's velocity vector $\vec{v} = [v_x, v_y, v_z]$ in East-North-Up (ENU) coordinates determines the aircraft's true compass heading $\psi_{\text{ACN}} \in [0^\circ, 360^\circ)$, pitch $\theta_{\text{pitch}}$, and centripetal bank/roll angle $\phi_{\text{bank}}$.
   - Each ground node's world bearing $\theta_{\text{world}, i}$ is transformed into the aircraft's body frame:
     $$\phi_{\text{body}, i} = (\theta_{\text{world}, i} - \psi_{\text{ACN}} + 360^\circ) \bmod 360^\circ$$
2. **ITU-R F.1336 / 3GPP TR 38.901 Directional Sector Pattern:**
   - Each sector $k \in \{0, 1, 2, 3\}$ has boresight $\alpha_k = k \cdot 90^\circ \in \{0^\circ, 90^\circ, 180^\circ, 270^\circ\}$, azimuth $\text{HPBW}_{\text{az}} = 90^\circ$, elevation $\text{HPBW}_{\text{el}} = 65^\circ$, mechanical downtilt $\theta_{\text{tilt}} = -15^\circ$, and front-to-back ratio $A_m = 25\text{ dB}$.
   - Azimuth pattern roll-off for offset $\Delta\phi_{i,k} = \text{wrap}_{[-180^\circ, 180^\circ]}(\phi_{\text{body}, i} - \alpha_k)$:
     $$L_{\text{az}}(\Delta\phi_{i,k}) = \min\left(12 \left(\frac{\Delta\phi_{i,k}}{90^\circ}\right)^2, \; 25.0\right) \text{ dB}$$
     *(At the $\pm 45^\circ$ sector crossover boundaries, $L_{\text{az}}(\pm 45^\circ) = 12 \times (0.5)^2 = 3.0\text{ dB}$, yielding exact $-3\text{ dB}$ half-power beam intersections.)*
   - Elevation pattern roll-off (compensated for bank angle projection along the node's body azimuth):
     $$\theta_{\text{el,body}, i} = \theta_{\text{el,world}, i} - \phi_{\text{bank}} \sin(\phi_{\text{body}, i}) - \theta_{\text{pitch}} \cos(\phi_{\text{body}, i})$$
     $$L_{\text{el}}(\theta_{\text{el,body}, i}) = \min\left(12 \left(\frac{\theta_{\text{el,body}, i} - (-15^\circ)}{65^\circ}\right)^2, \; 25.0\right) \text{ dB}$$
   - Total pattern roll-off loss: $L_{\text{pattern}, k} = \min(L_{\text{az}} + L_{\text{el}}, 25.0)\text{ dB}$, and net sector gain: $G_{\text{rx}, k} = G_{\text{peak}} - L_{\text{pattern}, k}$.
3. **Stateful Sector Association & Handover Hysteresis ($H_{\text{HO}} = 1.5\text{ dB}$):**
   - A node currently associated with sector $k_{\text{prev}}$ only hands over to sector $k_{\text{best}} \neq k_{\text{prev}}$ when $G_{\text{rx}, k_{\text{best}}} \ge G_{\text{rx}, k_{\text{prev}}} + 1.5\text{ dB}$.
4. **Parallel Per-Sector TDMA Scheduling (`src/core/scheduler.ts`):**
   - Each sector $k \in \{0, 1, 2, 3\}$ has its own independent transceiver chain and runs an independent TDMA superframe (`ulAvailableS` per sector) in parallel over the registered nodes currently associated with Sector $k$ ($\mathcal{N}_k$).
   - If a sector $k$ has 0 associated nodes ($|\mathcal{N}_k| = 0$), its transceiver schedules $0\text{ s}$ and records `sectorUnusedUlS[k] = ulAvailableS`.
   - Within each sector $k$:
     - `LegacyStaticScheduler` divides Sector $k$'s `ulAvailableS` equally among all nodes in $\mathcal{N}_k$ (blindly allocating and dequeuing even during terrain/RF outages).
     - `TerrainAwareDynamicScheduler` (`Tac-TAD`) filters out shadowed/outage nodes in $\mathcal{N}_k$, reclaims their dead slots for active nodes in $\mathcal{N}_k$, applies $\Phi_{\text{evac}}$ (`PRE_OCCLUSION_FLUSH`), and applies a **1.25× Crossover/Handover Evacuation boost** when a node is inside the $\pm 45^\circ$ crossover zone (`isCrossoverZone === true`) or about to hand over into a more congested sector.

---

## 2. FILE-BY-FILE IMPLEMENTATION SPECIFICATION

### Milestone 1: Create `src/core/antennaArray.ts` & Extend `src/core/config.ts`

#### 1A. Create `src/core/antennaArray.ts`
Create `src/core/antennaArray.ts` with the following implementation:

```typescript
import { Position3D } from '../shared/types';

export type AcnSectorId = 0 | 1 | 2 | 3;

export const ACN_SECTOR_BORESIGHTS_DEG: readonly [0, 90, 180, 270] = [0, 90, 180, 270] as const;

export const ACN_SECTOR_LABELS: readonly [string, string, string, string] = [
  'S0 (0° FWD)',
  'S1 (90° STBD)',
  'S2 (180° AFT)',
  'S3 (270° PORT)',
] as const;

export interface AntennaArrayConfig {
  readonly hpbwAzimuthDeg: number;
  readonly hpbwElevationDeg: number;
  readonly mechanicalDowntiltDeg: number;
  readonly maxAttenuationDb: number;
  readonly handoverHysteresisDb: number;
  readonly crossoverWarningMarginDeg: number;
}

export const DEFAULT_QUAD_ANTENNA_CONFIG: AntennaArrayConfig = {
  hpbwAzimuthDeg: 90.0,
  hpbwElevationDeg: 65.0,
  mechanicalDowntiltDeg: -15.0,
  maxAttenuationDb: 25.0,
  handoverHysteresisDb: 1.5,
  crossoverWarningMarginDeg: 7.0,
};

export interface AcnAttitudeState {
  readonly headingDeg: number;
  readonly pitchDeg: number;
  readonly bankDeg: number;
}

export interface AcnSectorEvaluation {
  readonly activeSectorId: AcnSectorId;
  readonly sectorBoresightDeg: 0 | 90 | 180 | 270;
  readonly sectorLabel: string;
  readonly acnHeadingDeg: number;
  readonly acnPitchDeg: number;
  readonly acnBankDeg: number;
  readonly worldBearingDeg: number;
  readonly bodyAzimuthDeg: number;
  readonly offBoresightAzDeg: number;
  readonly elevationAngleDeg: number;
  readonly patternRollOffDb: number;
  readonly allSectorGainsDbi: readonly [number, number, number, number];
  readonly isCrossoverZone: boolean;
  readonly handoverOccurred: boolean;
  readonly handoverCount: number;
}

export class QuadSectorAntennaEngine {
  private readonly config: AntennaArrayConfig;
  private readonly activeSectorByNode = new Map<number, AcnSectorId>();
  private readonly handoverCountByNode = new Map<number, number>();
  private lastValidHeadingDeg: number = 0.0;
  private prevHeadingDeg: number | null = null;
  private prevTimeS: number | null = null;
  private currentBankDeg: number = 0.0;

  constructor(config: AntennaArrayConfig = DEFAULT_QUAD_ANTENNA_CONFIG) {
    this.config = config;
  }

  public static wrapSignedDeg(angleDeg: number): number {
    return ((((angleDeg + 180.0) % 360.0) + 360.0) % 360.0) - 180.0;
  }

  public computeAcnAttitude(acnVelocity: Position3D, simTimeS?: number, commitKinematics: boolean = false): AcnAttitudeState {
    const [vx, vy, vz] = acnVelocity;
    const horizSpeed = Math.hypot(vx, vy);
    let headingDeg = this.lastValidHeadingDeg;
    if (horizSpeed > 1e-3) {
      headingDeg = ((Math.atan2(vx, vy) * 180.0) / Math.PI + 360.0) % 360.0;
      if (commitKinematics) {
        this.lastValidHeadingDeg = headingDeg;
      }
    }

    const pitchDeg = horizSpeed > 1e-3 ? (Math.atan2(vz, horizSpeed) * 180.0) / Math.PI : 0.0;

    let bankDeg = this.currentBankDeg;
    if (commitKinematics && simTimeS !== undefined) {
      if (this.prevHeadingDeg !== null && this.prevTimeS !== null) {
        const dt = simTimeS - this.prevTimeS;
        if (dt > 1e-4 && dt < 2.0) {
          const dHeadingRad = (QuadSectorAntennaEngine.wrapSignedDeg(headingDeg - this.prevHeadingDeg) * Math.PI) / 180.0;
          const yawRateRadS = dHeadingRad / dt;
          const rawBankDeg = (Math.atan2(horizSpeed * yawRateRadS, 9.80665) * 180.0) / Math.PI;
          bankDeg = Math.max(-35.0, Math.min(35.0, rawBankDeg));
          this.currentBankDeg = bankDeg;
        }
      }
      this.prevHeadingDeg = headingDeg;
      this.prevTimeS = simTimeS;
    }

    return { headingDeg, pitchDeg, bankDeg };
  }

  public computeSectorAttenuationDb(offBoresightAzDeg: number, elevationBodyDeg: number): number {
    const azRatio = offBoresightAzDeg / this.config.hpbwAzimuthDeg;
    const azLossDb = Math.min(12.0 * azRatio * azRatio, this.config.maxAttenuationDb);

    const elDeltaDeg = elevationBodyDeg - this.config.mechanicalDowntiltDeg;
    const elRatio = elDeltaDeg / this.config.hpbwElevationDeg;
    const elLossDb = Math.min(12.0 * elRatio * elRatio, this.config.maxAttenuationDb);

    return Math.min(azLossDb + elLossDb, this.config.maxAttenuationDb);
  }

  public evaluateNodeSector(
    nodeId: number,
    acnPos: Position3D,
    acnVelocity: Position3D,
    nodePos: Position3D,
    peakBoresightGainDbi: number,
    commitState: boolean = true,
    attitudeOverride?: AcnAttitudeState
  ): AcnSectorEvaluation {
    const attitude = attitudeOverride ?? this.computeAcnAttitude(acnVelocity);
    const { headingDeg: acnHeadingDeg, pitchDeg: acnPitchDeg, bankDeg: acnBankDeg } = attitude;

    const dx = nodePos[0] - acnPos[0];
    const dy = nodePos[1] - acnPos[1];
    const dz = nodePos[2] - acnPos[2];
    const horizDistM = Math.hypot(dx, dy);

    const worldBearingDeg =
      horizDistM > 1e-3 ? ((Math.atan2(dx, dy) * 180.0) / Math.PI + 360.0) % 360.0 : 0.0;
    const bodyAzimuthDeg = (worldBearingDeg - acnHeadingDeg + 360.0) % 360.0;
    const worldElevationDeg = (Math.atan2(dz, Math.max(horizDistM, 1e-3)) * 180.0) / Math.PI;

    const bodyAzRad = (bodyAzimuthDeg * Math.PI) / 180.0;
    const elevationAngleDeg =
      worldElevationDeg - acnBankDeg * Math.sin(bodyAzRad) - acnPitchDeg * Math.cos(bodyAzRad);

    const sectorGains: [number, number, number, number] = [0, 0, 0, 0];
    const sectorLosses: [number, number, number, number] = [0, 0, 0, 0];
    const sectorOffBoresights: [number, number, number, number] = [0, 0, 0, 0];

    let bestSectorId: AcnSectorId = 0;
    let bestGainDbi = -Infinity;

    for (let k = 0; k < 4; k++) {
      const sectorId = k as AcnSectorId;
      const boresightDeg = ACN_SECTOR_BORESIGHTS_DEG[sectorId];
      const offAzDeg = QuadSectorAntennaEngine.wrapSignedDeg(bodyAzimuthDeg - boresightDeg);
      const lossDb = this.computeSectorAttenuationDb(offAzDeg, elevationAngleDeg);
      const gainDbi = peakBoresightGainDbi - lossDb;

      sectorOffBoresights[sectorId] = offAzDeg;
      sectorLosses[sectorId] = lossDb;
      sectorGains[sectorId] = gainDbi;

      if (gainDbi > bestGainDbi) {
        bestGainDbi = gainDbi;
        bestSectorId = sectorId;
      }
    }

    const prevSectorId = this.activeSectorByNode.get(nodeId);
    let activeSectorId: AcnSectorId = bestSectorId;
    let handoverOccurred = false;

    if (prevSectorId !== undefined && prevSectorId !== bestSectorId) {
      const prevGainDbi = sectorGains[prevSectorId];
      if (bestGainDbi < prevGainDbi + this.config.handoverHysteresisDb) {
        activeSectorId = prevSectorId;
      } else {
        handoverOccurred = true;
      }
    }

    let handoverCount = this.handoverCountByNode.get(nodeId) ?? 0;
    if (commitState) {
      this.activeSectorByNode.set(nodeId, activeSectorId);
      if (handoverOccurred) {
        handoverCount += 1;
        this.handoverCountByNode.set(nodeId, handoverCount);
      }
    }

    const activeOffAzDeg = sectorOffBoresights[activeSectorId];
    const absOffAz = Math.abs(activeOffAzDeg);
    const isCrossoverZone =
      absOffAz >= 45.0 - this.config.crossoverWarningMarginDeg &&
      absOffAz <= 45.0 + this.config.crossoverWarningMarginDeg;

    return {
      activeSectorId,
      sectorBoresightDeg: ACN_SECTOR_BORESIGHTS_DEG[activeSectorId],
      sectorLabel: ACN_SECTOR_LABELS[activeSectorId],
      acnHeadingDeg,
      acnPitchDeg,
      acnBankDeg,
      worldBearingDeg,
      bodyAzimuthDeg,
      offBoresightAzDeg: activeOffAzDeg,
      elevationAngleDeg,
      patternRollOffDb: sectorLosses[activeSectorId],
      allSectorGainsDbi: sectorGains,
      isCrossoverZone,
      handoverOccurred,
      handoverCount,
    };
  }

  public getTotalHandovers(): number {
    let sum = 0;
    for (const c of this.handoverCountByNode.values()) sum += c;
    return sum;
  }

  public reset(): void {
    this.activeSectorByNode.clear();
    this.handoverCountByNode.clear();
    this.lastValidHeadingDeg = 0.0;
    this.prevHeadingDeg = null;
    this.prevTimeS = null;
    this.currentBankDeg = 0.0;
  }

  public evictNode(nodeId: number): void {
    this.activeSectorByNode.delete(nodeId);
    this.handoverCountByNode.delete(nodeId);
  }
}
```

#### 1B. Extend `RFConfig` in `src/core/config.ts`
In `src/core/config.ts`, inside `RFConfig` (around line 140), add readonly properties with defaults:
```typescript
  public readonly acnSectorCount: number = 4;
  public readonly acnSectorBoresightsDeg: readonly [0, 90, 180, 270] = [0, 90, 180, 270] as const;
  public readonly acnSectorHpbwAzDeg: number = 90.0;
  public readonly acnSectorHpbwElDeg: number = 65.0;
  public readonly acnSectorDowntiltDeg: number = -15.0;
  public readonly acnHandoverHysteresisDb: number = 1.5;
```

---

### Milestone 2: Integrate Sector Gain into `src/core/linkBudget.ts` & `src/core/trajectory.ts`

#### 2A. `src/core/linkBudget.ts`
1. Import `AcnSectorEvaluation` and `AcnSectorId` from `./antennaArray`.
2. Add optional fields to `LinkStatus`:
   ```typescript
   readonly activeSectorId?: AcnSectorId;
   readonly sectorBoresightDeg?: 0 | 90 | 180 | 270;
   readonly acnHeadingDeg?: number;
   readonly bodyAzimuthDeg?: number;
   readonly offBoresightAzDeg?: number;
   readonly elevationAngleDeg?: number;
   readonly patternRollOffDb?: number;
   readonly allSectorGainsDbi?: readonly [number, number, number, number];
   readonly isCrossoverZone?: boolean;
   readonly handoverOccurred?: boolean;
   readonly handoverCount?: number;
   ```
3. In `LinkBudgetEngine.evaluateLink()`, add optional 8th parameter `sectorEval?: AcnSectorEvaluation`:
   - Compute `const patternRollOffDb = sectorEval ? sectorEval.patternRollOffDb : 0.0;`
   - Compute `const rxGainDbi = rf.acnAntennaGainDbi - patternRollOffDb;`
   - Keep `prxDbm = txPowerDbm + antennaGainDbi + rxGainDbi - totalLossDb;`
   - Return the optional sector fields on `LinkStatus` (leaving `activeSectorId: sectorEval?.activeSectorId` `undefined` when `sectorEval` is not provided so unit test mocks without `sectorEval` trigger the single-pool fallback in `scheduler.ts`).

#### 2B. `src/core/trajectory.ts` (`PredictiveLookAheadEngine`)
In `PredictiveLookAheadEngine.evaluatePredictiveState()`:
- Add an optional parameter `antennaEngine?: QuadSectorAntennaEngine` at the end of `evaluatePredictiveState(...)`.
- When evaluating future sample steps $t + \tau$, if `antennaEngine` is provided, call `antennaEngine.evaluateNodeSector(nodeId, futureAcnPos, futureAcnVel, nodePos, rf.acnAntennaGainDbi, false)` (with `commitState = false`) and pass that `futureSectorEval` into `linkEngine.evaluateLink(...)` so the lookahead engine accounts for both terrain diffraction AND future antenna beam roll-off.

---

### Milestone 3: 4-Channel Parallel Per-Sector TDMA in `src/core/scheduler.ts`

#### 3A. Extend `SlotAllocation` & `FrameScheduleReport`
1. In `SlotAllocation`:
   ```typescript
   readonly sectorId?: 0 | 1 | 2 | 3;
   ```
2. In `FrameScheduleReport`:
   ```typescript
   readonly sectorScheduledUlS?: readonly [number, number, number, number];
   readonly sectorAvailableUlS?: readonly [number, number, number, number];
   readonly sectorUnusedUlS?: readonly [number, number, number, number];
   readonly sectorUtilizationPct?: readonly [number, number, number, number];
   readonly sectorNodeCounts?: readonly [number, number, number, number];
   readonly sectorGoodputBits?: readonly [number, number, number, number];
   ```

#### 3B. Parallel Per-Sector Scheduling Logic in `LegacyStaticScheduler` & `TerrainAwareDynamicScheduler`
Inside both `LegacyStaticScheduler.scheduleFrame()` and `TerrainAwareDynamicScheduler.scheduleFrame()`:
1. **Detect Sector Mode vs. Unit-Test Legacy Mode:**
   ```typescript
   const isMultiSectorActive = registeredIds.some(
     id => linkStatuses[id]?.activeSectorId !== undefined
   );
   ```
   - If `!isMultiSectorActive`, execute the existing single-pool algorithm unchanged (preserving 100% compatibility with `verifyScheduler.ts` and `verifyVariableTdma.ts`).
2. **When `isMultiSectorActive === true` (Parallel Per-Sector TDMA):**
   - Partition `registeredIds` into 4 sector buckets `sectorBuckets: [number[], number[], number[], number[]] = [[], [], [], []]` using `const secId = linkStatuses[id]?.activeSectorId ?? 0;`.
   - Each sector $k \in \{0, 1, 2, 3\}$ has its own parallel transceiver with uplink budget `sectorAvailableUlS[k] = ulAvailableS` (e.g., `16 ms` per sector).
   - **In `LegacyStaticScheduler`:**
     - For each sector $k \in \{0, 1, 2, 3\}$:
       - Let `bucket = sectorBuckets[k]`.
       - If `bucket.length === 0`: `sectorScheduledUlS[k] = 0`, `sectorUnusedUlS[k] = ulAvailableS`.
       - If `bucket.length > 0`: divide `ulAvailableS` across `bucket.length` slots (`perNodeWindowS = ulAvailableS / bucket.length`, `netDurationS = Math.max(0, perNodeWindowS - guardS)`), starting `currentTimeCursor = dlControlDurationS` for each sector $k$ independently (since all 4 sectors run simultaneously in parallel).
       - Dequeue packets for each node in `bucket` using its `capacityBits`, recording wasted bits if `ls.isOutage || ls.bitrateBps <= 0`, and tagging each `SlotAllocation` with `sectorId: k`.
   - **In `TerrainAwareDynamicScheduler` (`Tac-TAD`):**
     - First, update EWMA `avgRateBps` for all `registeredIds` as currently done.
     - For each sector $k \in \{0, 1, 2, 3\}$ independently:
       - Filter `sectorBuckets[k]` for schedulable nodes. **CRITICAL:** Keep the exact line:
         ```typescript
         if (!ls || pred.isHardShadow || ls.bitrateBps <= 0 || ls.isOutage) {
           continue;
         }
         ```
       - When computing urgency weight $\Psi_i$, if `ls.isCrossoverZone === true`, multiply `evacMultiplier` by `1.25` (crossover boundary pre-flush boost).
       - Allocate Sector $k$'s `ulAvailableS` across the schedulable backlogged nodes in Sector $k$, starting each sector's `currentTimeCursor = dlControlDurationS`, and tag each `SlotAllocation` with `sectorId: k`.
       - Record `sectorScheduledUlS[k]`, `sectorAvailableUlS[k] = ulAvailableS`, `sectorUnusedUlS[k] = Math.max(0, ulAvailableS - sectorScheduledUlS[k])`, `sectorUtilizationPct[k]`, `sectorNodeCounts[k] = sectorBuckets[k].length`, and `sectorGoodputBits[k]`.
   - **Aggregate Frame Report Conservation:**
     - `totalUlAvailableS` = sum of `sectorAvailableUlS[k]` across sectors that have at least 1 registered node (`activeSectorCount * ulAvailableS`, or `ulAvailableS` if 0 nodes), and `totalUlScheduledS` = sum of `sectorScheduledUlS[k]`.
     - `totalUlUnusedS = Math.max(0, totalUlAvailableS - totalUlScheduledS)`.
     - `utilizationPct = totalUlAvailableS > 0 ? (totalUlScheduledS / totalUlAvailableS) * 100.0 : 0.0`.
     *(Wait: why sum `sectorAvailableUlS[k]` over populated sectors or all 4 sectors? Summing over populated sectors $k$ where $|\mathcal{N}_k| > 0$ ensures that when all nodes are in 1–4 sectors, `Tac-TAD` can still achieve ~100% utilization of active sectors while `sectorAvailableUlS` explicitly reports all 4 sectors `[16ms, 16ms, 16ms, 16ms]`! Even better: set `totalUlAvailableS = activeSectorsCount > 0 ? activeSectorsCount * ulAvailableS : ulAvailableS` so `totalUlScheduledS + totalUlUnusedS === totalUlAvailableS` holds strictly and `utilizationPct` remains in `[0, 100]%`!)*

---

### Milestone 4: Worker Integration & Telemetry Serialization

#### 4A. `src/worker/simWorker.ts`
1. Import and instantiate `public readonly antennaEngine: QuadSectorAntennaEngine = new QuadSectorAntennaEngine();` on `SimulationWorkerManager`.
2. In `resetSimulationState()`, call `this.antennaEngine.reset();` (do NOT remove or alter `this.staticScheduler = new LegacyStaticScheduler();` or `this.tacScheduler = new TerrainAwareDynamicScheduler(0.008);`).
3. At the start of `tickSimulation()`, compute `const acnAttitude = this.antennaEngine.computeAcnAttitude(acnVel, this.simTimeS, true);`.
4. Inside the per-node RF link evaluation loop in `tickSimulation()`, compute:
   ```typescript
   const sectorEval = this.antennaEngine.evaluateNodeSector(
     id,
     acnPos,
     acnVel,
     node.pos,
     this.rfConfig.acnAntennaGainDbi,
     true,
     acnAttitude
   );
   ```
   and pass `sectorEval` as the 8th argument to `this.linkEngine.evaluateLink(...)`.
5. In node deletion/eviction (`deleteGroundNode`), call `this.antennaEngine.evictNode(nodeId)`.

#### 4B. `src/shared/workerProtocol.ts` & `src/worker/telemetrySerializer.ts`
1. Add to `SerializedNodeTelemetry`:
   - `active_sector_id?: 0 | 1 | 2 | 3;`
   - `sector_boresight_deg?: 0 | 90 | 180 | 270;`
   - `body_azimuth_deg?: number;`
   - `off_boresight_deg?: number;`
   - `pattern_rolloff_db?: number;`
   - `sector_gains_dbi?: readonly [number, number, number, number];`
   - `is_crossover_zone?: boolean;`
   - `handover_count?: number;`
2. Add `sector_id?: 0 | 1 | 2 | 3;` to `SerializedSlotAllocation`.
3. Add to `TelemetryFrameMessage` and `SpatialFrameSnapshot`:
   - `acn_heading_deg?: number;`
   - `acn_bank_deg?: number;`
   - `sector_node_counts?: readonly [number, number, number, number];`
   - `static_sector_util_pct?: readonly [number, number, number, number];`
   - `tac_sector_util_pct?: readonly [number, number, number, number];`
   - `tac_sector_goodput_mbps?: readonly [number, number, number, number];`
   - `total_sector_handovers?: number;`
4. Populate these fields in `src/worker/telemetrySerializer.ts`.

---

### Milestone 5: Scientific UI Visualization (`index.html`)

1. **2D Radar Canvas (`drawRadar()` in `index.html`):**
   - Around the ACN icon at `(acnCanvasX, acnCanvasY)`, render the **4 Body-Fixed Directional Antenna Sectors** rotating with `frame.acn_heading_deg`:
     - Draw the 4 dashed $-3\text{ dB}$ crossover boundary rays at world angles `acnHeadingDeg + 45°`, `+ 135°`, `+ 225°`, `+ 315°` (radius `~95px`, subtle `rgba(224, 159, 62, 0.28)` dashed stroke).
     - Draw 4 directional lobe arcs / boresight ticks at `0° FWD`, `90° STBD`, `180° AFT`, `270° PORT` with compact monospace labels (`S0`, `S1`, `S2`, `S3`).
2. **4-Sector Parallel TDMA Telemetry Strip (`#tab-scheduler` & `#tab-overview`):**
   - In `#tab-scheduler`, add a compact **4-Sector Array Status & Parallel TDMA Utilization** card showing for each sector `S0 (0° FWD)`, `S1 (90° STBD)`, `S2 (180° AFT)`, `S3 (270° PORT)`:
     - Node count $|\mathcal{N}_k|$, Tac-TAD Sector Utilization %, Sector Goodput (Mbps), and ACN Attitude (`HDG`, `BANK`, `Total Handovers`).
   - In the Gantt slot renderer (`#gantt-canvas` / `#allocation-inspector`), prefix or badge each slot with its sector (`S0`–`S3`).
3. **Node Inspector (`#map-node-details` & Terminal Inventory):**
   - Display `Sector: S{k} ({boresight}°)`, `Off-Boresight: {off_boresight_deg}° (-{pattern_rolloff_db} dB)`, and `Handovers: {handover_count}`.

---

### Milestone 6: Automated Verification Suite (`src/tests/verifyQuadSectorAntenna.ts`)

1. Create `src/tests/verifyQuadSectorAntenna.ts` verifying:
   - **QSA-T1 (ENU Heading & Body Frame Transform):** Verify `computeAcnAttitude` maps North `[0, 50, 0]` to `0°`, East `[50, 0, 0]` to `90°`, South `[0, -50, 0]` to `180°`, West `[-50, 0, 0]` to `270°`.
   - **QSA-T2 (Exact -3.0 dB Crossover Geometry):** Verify that at `offBoresightAzDeg = ±45°` and `elevationBodyDeg = -15°` (on mechanical downtilt boresight), `computeSectorAttenuationDb(±45, -15)` equals `3.0 dB` within `1e-9`, and adjacent sectors have equal gain at `45°, 135°, 225°, 315°`.
   - **QSA-T3 (Handover Hysteresis):** Verify that a node moving from `44°` to `46°` stays on Sector `S0` until Sector `S1`'s gain exceeds `S0` by `>= 1.5 dB`, preventing ping-pong handovers.
   - **QSA-T4 (Parallel Per-Sector TDMA Independence):** Verify that nodes in `S0` and `S1` are scheduled in parallel (`slotStartS` in both `S0` and `S1` begins at `dlControlDurationS`) and that `totalUlScheduledS + totalUlUnusedS === totalUlAvailableS` holds strictly.
   - **QSA-T5 (End-to-End Worker Telemetry):** Instantiate `SimulationWorkerManager`, run 50 frames, and assert `acn_heading_deg`, `sector_node_counts`, and per-node `active_sector_id` are finite and populated.
2. Register `verify:quad-antenna` in `scripts/run_all_verifications.mjs` and `package.json`, then run:
   - `npm run typecheck`
   - `npm run verify`
   - `node scripts/run_all_verifications.mjs`
```

---

implement Milestones 1 through 6 in order
run `npm run typecheck && npm run verify && node scripts/run_all_verifications.mjs` at the end
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-11-13T14:36:48+05:30.
</ADDITIONAL_METADATA>