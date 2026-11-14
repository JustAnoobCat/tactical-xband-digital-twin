/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Polar X-Band SINR Viewshed Engine & 360° Orbit-Integrated Relay Placement Advisor
 *
 * Implements:
 * 1. Zero-allocation Polar X-Band SINR Viewshed Grid (36 azimuths x 16 radial ranges = 576 polar cells).
 * 2. 50 Hz discrete-event slice updates (amortized 6 azimuth rays per 20 ms tick).
 * 3. ITU-R P.526-15 terrain diffraction, ITU-R F.1336 body-fixed 4-sector antenna gain,
 *    ITU-R P.676 altitude gaseous absorption, and contested EW jammer interference coupling.
 * 4. 360° Orbit-Integrated Availability & Optimal Ridgeline Relay Placement Advisor.
 */

import { Position3D } from '../shared/types';
import { RFConfig, EnvironmentConfig } from './config';
import { TerrainEngine, TerrainObstruction } from './terrain';
import { QuadSectorAntennaEngine, AcnAttitudeState } from './antennaArray';
import { LinkBudgetEngine } from './linkBudget';
import type { ACNTrajectory } from './trajectory';

export const NUM_AZIMUTHS = 36; // 10° angular steps: 0°, 10°, ..., 350°
export const NUM_RANGES = 16;   // 16 radial rings: 1,500 m to 24,000 m in 1,500 m steps
export const R_MIN_M = 1500;
export const R_STEP_M = 1500;
export const R_MAX_M = 24000;
export const TOTAL_VIEWSHED_CELLS = NUM_AZIMUTHS * NUM_RANGES; // 576

export interface RelayAdvisorReport {
  readonly optimalPosEnu: Position3D;
  readonly optimalLatDeg: number;
  readonly optimalLonDeg: number;
  readonly elevationMslM: number;
  readonly orbitAvailabilityPct: number;
  readonly groundNodeCoveragePct: number;
  readonly meanSinrToAcnDb: number;
}

export class PolarViewshedEngine {
  // Pre-allocated Float32Array: 0 heap allocations in the 50 Hz discrete simulation loop
  private readonly sinrGridDb = new Float32Array(TOTAL_VIEWSHED_CELLS);
  private nextAzimuthSliceIndex: number = 0;
  private readonly antennaEngine: QuadSectorAntennaEngine;

  constructor(antennaEngine?: QuadSectorAntennaEngine) {
    this.antennaEngine = antennaEngine ?? new QuadSectorAntennaEngine();
    // Initialize with baseline noise floor / outage floor
    this.sinrGridDb.fill(-30.0);
  }

  /**
   * Returns authoritative raw Float32Array buffer of all 576 polar SINR cells (dB).
   */
  public getSinrGrid(): Float32Array {
    return this.sinrGridDb;
  }

  /**
   * Evaluates single-cell physical link budget and SINR (dB) from a ground position to the ACN.
   *
   * Formulations:
   * 1. 3D Slant range & line-of-sight vector from ACN to ground cell.
   * 2. Body-fixed 4-sector antenna gain G_acn(theta_body, theta_el_body) via computeSectorAttenuationDb.
   * 3. FSPL (Friis) + ITU-R P.676-13 altitude gas loss + ITU-R P.838-3 rain loss + ITU-R P.526-15 diffraction loss.
   * 4. Contested EW Jammer interference I_J coupling into active ACN sector.
   * 5. Effective SINR = P_rx - 10*log10(P_noise + P_jammer).
   */
  public computeCellSinr(
    worldBearingDeg: number,
    rangeM: number,
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number]
  ): number {
    const radBearing = (worldBearingDeg * Math.PI) / 180.0;
    const sinB = Math.sin(radBearing);
    const cosB = Math.cos(radBearing);

    const cellX = acnPos[0] + rangeM * sinB;
    const cellY = acnPos[1] + rangeM * cosB;

    let zGround = terrain.getElevation(cellX, cellY);
    if (!Number.isFinite(zGround)) {
      zGround = 0.0;
    }
    const cellZ = zGround + 2.0; // Standard ground terminal height 2.0 m AGL
    const cellPos: Position3D = [cellX, cellY, cellZ];

    const dx = cellX - acnPos[0];
    const dy = cellY - acnPos[1];
    const dz = cellZ - acnPos[2];
    const horizDistM = Math.max(rangeM, 1.0);
    const slantDistM = Math.max(Math.hypot(dx, dy, dz), 1.0);

    // 1. Terrain diffraction obstruction
    const obs = terrain.evaluateTerrainObstruction(cellPos, acnPos, rf, env, 150.0);
    let diffLossDb = 0.0;
    if (obs.obstacleBlocked) {
      diffLossDb = 35.0;
    } else if (Number.isFinite(obs.diffractionLossDb)) {
      diffLossDb = obs.diffractionLossDb!;
    } else if (obs.isHardShadow || !obs.isCoverageComplete) {
      diffLossDb = 45.0;
    }

    // 2. ACN Attitude and Sector Antenna Gain
    const attitude = attitudeOverride ?? this.antennaEngine.computeAcnAttitude(acnVel);
    const { headingDeg: acnHeadingDeg, pitchDeg: acnPitchDeg, bankDeg: acnBankDeg } = attitude;

    const bodyAzimuthDeg = (((worldBearingDeg - acnHeadingDeg) % 360.0) + 360.0) % 360.0;
    const worldElevationDeg = (Math.atan2(dz, horizDistM) * 180.0) / Math.PI;

    const bodyAzRad = (bodyAzimuthDeg * Math.PI) / 180.0;
    const elevationAngleDeg =
      worldElevationDeg - acnBankDeg * Math.sin(bodyAzRad) - acnPitchDeg * Math.cos(bodyAzRad);

    // Evaluate 4-sector antenna roll-off to find best active sector
    let minAttenDb = Number.POSITIVE_INFINITY;
    let activeSectorId = 0;
    for (let s = 0; s < 4; s++) {
      const boresightDeg = s * 90;
      const offBoresightAzDeg = QuadSectorAntennaEngine.wrapSignedDeg(bodyAzimuthDeg - boresightDeg);
      const attenDb = this.antennaEngine.computeSectorAttenuationDb(offBoresightAzDeg, elevationAngleDeg);
      if (attenDb < minAttenDb) {
        minAttenDb = attenDb;
        activeSectorId = s;
      }
    }
    const rxGainDbi = rf.acnAntennaGainDbi - minAttenDb;

    // 3. Propagation losses
    const fsplDb = LinkBudgetEngine.computeFsplDb(slantDistM, rf.carrierFrequencyHz, rf.speedOfLight);
    const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(slantDistM, cellZ, acnPos[2], rf.carrierFrequencyHz);
    const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(slantDistM, env, cellZ, acnPos[2]);
    const totalLossDb =
      fsplDb +
      diffLossDb +
      gasLossDb +
      rainLossDb +
      rf.cableLossDb +
      rf.implementationMarginDb;

    // Standard soldier transmitter parameters: 30 dBm (1 W), 0 dBi antenna
    const txPowerDbm = 30.0;
    const txGainDbi = 0.0;
    const prxDbm = txPowerDbm + txGainDbi + rxGainDbi - totalLossDb;

    // Thermal noise & sky temperature coupling
    const { pNoiseDbm: pNoiseThermalDbm } = LinkBudgetEngine.computeThermalNoiseFloorDbm(
      rf.channelBandwidthHz,
      rf.acnNoiseFigureDb,
      env.atmosphericTemperatureK,
      rf.boltzmannConstant
    );
    const aAtm = gasLossDb + rainLossDb;
    const Tm = 275.0;
    const skyTemperatureK = Tm * (1.0 - Math.pow(10.0, -aAtm / 10.0));
    const noiseFactor = Math.pow(10.0, rf.acnNoiseFigureDb / 10.0);
    const skyNoiseIncreaseDb = 10.0 * Math.log10(1.0 + skyTemperatureK / (290.0 * noiseFactor));
    const pNoiseDbm = pNoiseThermalDbm + skyNoiseIncreaseDb;

    // Contested EW Jammer interference coupling into active sector
    let pNoiseAndInterferenceDbm = pNoiseDbm;
    if (env.jammerEnabled && jammerInterferenceBySector !== undefined) {
      const jammerInterferenceDbm = jammerInterferenceBySector[activeSectorId];
      if (Number.isFinite(jammerInterferenceDbm)) {
        const pNoiseMw = Math.pow(10.0, pNoiseDbm / 10.0);
        const pJammerMw = Math.pow(10.0, jammerInterferenceDbm / 10.0);
        pNoiseAndInterferenceDbm = 10.0 * Math.log10(pNoiseMw + pJammerMw);
      }
    }

    return prxDbm - pNoiseAndInterferenceDbm;
  }

  /**
   * Computes an entire radial azimuth ray (all 16 range bins) in a single pass.
   */
  public computeAzimuthRay(
    azimuthIndex: number,
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number]
  ): void {
    const bearingDeg = (azimuthIndex * 10) % 360;
    const baseOffset = azimuthIndex * NUM_RANGES;

    for (let j = 0; j < NUM_RANGES; j++) {
      const rangeM = (j + 1) * R_STEP_M;
      const sinrDb = this.computeCellSinr(
        bearingDeg,
        rangeM,
        acnPos,
        acnVel,
        terrain,
        rf,
        env,
        attitudeOverride,
        jammerInterferenceBySector
      );
      this.sinrGridDb[baseOffset + j] = sinrDb;
    }
  }

  /**
   * Amortized discrete-event viewshed sweep. Updates `sliceCount` (e.g. 6) azimuth rays per 20 ms tick,
   * completing a full 360° sweep (36 rays) every 6 ticks (120 ms) with zero garbage collection allocations.
   */
  public updateSlice(
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    sliceCount: number = 6,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number]
  ): void {
    const startAz = this.nextAzimuthSliceIndex;
    for (let k = 0; k < sliceCount; k++) {
      const azIdx = (startAz + k) % NUM_AZIMUTHS;
      this.computeAzimuthRay(
        azIdx,
        acnPos,
        acnVel,
        terrain,
        rf,
        env,
        attitudeOverride,
        jammerInterferenceBySector
      );
    }
    this.nextAzimuthSliceIndex = (startAz + sliceCount) % NUM_AZIMUTHS;
  }

  /**
   * Synchronous evaluation of all 36 azimuth rays (576 cells). Useful for scenario initialization
   * or verification testing.
   */
  public computeFullViewshed(
    acnPos: Position3D,
    acnVel: Position3D,
    terrain: TerrainEngine,
    rf: RFConfig,
    env: EnvironmentConfig,
    attitudeOverride?: AcnAttitudeState,
    jammerInterferenceBySector?: readonly [number, number, number, number]
  ): Float32Array {
    for (let a = 0; a < NUM_AZIMUTHS; a++) {
      this.computeAzimuthRay(
        a,
        acnPos,
        acnVel,
        terrain,
        rf,
        env,
        attitudeOverride,
        jammerInterferenceBySector
      );
    }
    return this.sinrGridDb;
  }

  /**
   * 360° Orbit-Integrated Availability & Optimal Ridgeline Relay Placement Advisor.
   *
   * Samples high-prominence ridgeline points around the tactical theater (24 azimuths x 8 radii within [2 km, 14 km])
   * and scores each candidate relay point by:
   * 1. 360° ACN Orbit Visibility %: fraction of 12 equidistant orbital phases where candidate has unobstructed LoS (SINR >= 10 dB).
   * 2. Ground Squad Line-of-Sight Coverage %: fraction of active ground terminals with LoS or closing diffraction (SINR >= 4 dB).
   *
   * Returns an authoritative RelayAdvisorReport with optimal ridgeline coordinate and coverage metrics.
   */
  public computeOptimalRelayPlacement(
    trajectoryEngine: ACNTrajectory,
    terrain: TerrainEngine,
    groundNodes: readonly { position: readonly [number, number] | Position3D; nodeId: number }[],
    rf: RFConfig,
    env: EnvironmentConfig,
    orbitPhasesCount: number = 12
  ): RelayAdvisorReport {
    // 1. Calculate ground node mean elevation & center
    let meanGroundElev = 0.0;
    let validNodeCount = 0;
    for (const node of groundNodes) {
      const pos = node.position;
      const elev = pos.length >= 3 && Number.isFinite(pos[2])
        ? pos[2]
        : (terrain.getElevation(pos[0], pos[1]) || 3500.0);
      meanGroundElev += elev;
      validNodeCount++;
    }
    meanGroundElev = validNodeCount > 0 ? meanGroundElev / validNodeCount : 3500.0;

    // 2. Pre-sample 12 equidistant ACN orbital phases
    let orbitPeriodS =
      (trajectoryEngine as { orbitPeriodS?: number }).orbitPeriodS ??
      (trajectoryEngine.totalLengthM > 0 && trajectoryEngine.targetSpeedMps > 0
        ? trajectoryEngine.totalLengthM / trajectoryEngine.targetSpeedMps
        : 300.0);
    if (!Number.isFinite(orbitPeriodS) || orbitPeriodS <= 0.0) {
      orbitPeriodS = 300.0;
    }
    const orbitalAcnPositions: Position3D[] = [];
    const orbitalAcnVelocities: Position3D[] = [];
    for (let m = 0; m < orbitPhasesCount; m++) {
      const phaseTimeS = (m * orbitPeriodS) / orbitPhasesCount;
      orbitalAcnPositions.push(trajectoryEngine.getAcnPosition(phaseTimeS));
      orbitalAcnVelocities.push(trajectoryEngine.getAcnVelocity(phaseTimeS));
    }

    // 3. Candidate sampling grid: 24 azimuths x 8 radial steps between 2 km and 14 km from center
    const CAND_AZIMUTHS = 24; // 15° steps
    const CAND_RADII = 8;
    const R_START_M = 2000.0;
    const R_END_M = 14000.0;
    const rStep = (R_END_M - R_START_M) / (CAND_RADII - 1);

    let bestScore = -Infinity;
    let bestCandPos: Position3D = [0, 0, meanGroundElev + 500];
    let bestOrbitAvail = 0.0;
    let bestGroundCov = 0.0;
    let bestMeanSinr = 0.0;

    for (let a = 0; a < CAND_AZIMUTHS; a++) {
      const azRad = (a * 15.0 * Math.PI) / 180.0;
      const sinA = Math.sin(azRad);
      const cosA = Math.cos(azRad);

      for (let r = 0; r < CAND_RADII; r++) {
        const radM = R_START_M + r * rStep;
        const candX = radM * sinA;
        const candY = radM * cosA;
        const candElev = terrain.getElevation(candX, candY);
        if (!Number.isFinite(candElev)) continue;

        // Mounted on 3 m mast on ridge
        const candZ = candElev + 3.0;
        const candPos: Position3D = [candX, candY, candZ];

        // Criterion 1: ACN Orbit Visibility across the 12 phases
        let visiblePhasesCount = 0;
        let sumSinrToAcn = 0.0;
        for (let m = 0; m < orbitPhasesCount; m++) {
          const acnPos = orbitalAcnPositions[m];
          const acnVel = orbitalAcnVelocities[m];
          const dM = Math.max(Math.hypot(acnPos[0] - candX, acnPos[1] - candY, acnPos[2] - candZ), 1.0);

          const obs = terrain.evaluateTerrainObstruction(candPos, acnPos, rf, env, 200.0);
          const diffLossDb = obs.obstacleBlocked
            ? 35.0
            : (Number.isFinite(obs.diffractionLossDb) ? obs.diffractionLossDb! : (obs.isLos ? 0.0 : 45.0));

          // Slant link budget to ACN
          const fsplDb = LinkBudgetEngine.computeFsplDb(dM, rf.carrierFrequencyHz, rf.speedOfLight);
          const gasLossDb = LinkBudgetEngine.computeGaseousAttenuationDb(dM, candZ, acnPos[2], rf.carrierFrequencyHz);
          const rainLossDb = LinkBudgetEngine.computeRainAttenuationDb(dM, env, candZ, acnPos[2]);
          const totalLossDb = fsplDb + diffLossDb + gasLossDb + rainLossDb + rf.cableLossDb + rf.implementationMarginDb;

          // Relay transmitter: 30 dBm, 5 dBi directional antenna, ACN 15 dBi
          const pRxDbm = 30.0 + 5.0 + rf.acnAntennaGainDbi - totalLossDb;
          const pNoiseDbm = -105.0;
          const sinrDb = pRxDbm - pNoiseDbm;

          sumSinrToAcn += sinrDb;
          if (sinrDb >= 10.0) {
            visiblePhasesCount++;
          }
        }
        const orbitAvailPct = (visiblePhasesCount / orbitPhasesCount) * 100.0;
        const meanSinrDb = sumSinrToAcn / orbitPhasesCount;

        // Criterion 2: Ground squad coverage
        let coveredGroundCount = 0;
        for (const gNode of groundNodes) {
          const gnPos = gNode.position;
          const gnElev = terrain.getElevation(gnPos[0], gnPos[1]);
          const terrainSurfaceZ = (Number.isFinite(gnElev) ? gnElev : 3500.0) + 2.0;
          const gnZ = gnPos.length >= 3 && Number.isFinite(gnPos[2])
            ? Math.max(gnPos[2], terrainSurfaceZ)
            : terrainSurfaceZ;
          const gNodePos: Position3D = [gnPos[0], gnPos[1], gnZ];

          const dGroundM = Math.max(Math.hypot(candX - gnPos[0], candY - gnPos[1], candZ - gnZ), 1.0);
          const obsNode = terrain.evaluateTerrainObstruction(gNodePos, candPos, rf, env, 200.0);
          const diffLossDb = obsNode.obstacleBlocked
            ? 35.0
            : (Number.isFinite(obsNode.diffractionLossDb) ? obsNode.diffractionLossDb! : (obsNode.isLos ? 0.0 : 45.0));

          const fsplDb = LinkBudgetEngine.computeFsplDb(dGroundM, rf.carrierFrequencyHz, rf.speedOfLight);
          const pRxGroundDbm = 30.0 + 0.0 + 5.0 - (fsplDb + diffLossDb + rf.cableLossDb + rf.implementationMarginDb);
          const groundSinrDb = pRxGroundDbm - (-105.0);

          if (groundSinrDb >= 4.0 || obsNode.isLos) {
            coveredGroundCount++;
          }
        }
        const groundCovPct = groundNodes.length > 0 ? (coveredGroundCount / groundNodes.length) * 100.0 : 100.0;

        // Composite Prominence Score
        // High orbit availability (>= 80%) is primary objective; elevation above mean valley awards prominence.
        const elevationBonus = Math.max(0.0, candElev - meanGroundElev);
        const prominenceFactor = candElev > meanGroundElev + 150.0 ? 1.5 + (candElev - meanGroundElev) / 1000.0 : 0.3;
        const score = (
          (orbitAvailPct >= 80.0 ? 600.0 : 0.0) +
          orbitAvailPct * 4.0 +
          groundCovPct * 3.0 +
          (elevationBonus / 20.0) +
          meanSinrDb * 0.5
        ) * prominenceFactor;

        if (score > bestScore) {
          bestScore = score;
          bestCandPos = candPos;
          bestOrbitAvail = orbitAvailPct;
          bestGroundCov = groundCovPct;
          bestMeanSinr = meanSinrDb;
        }
      }
    }

    const geo = terrain.worldToLatLon(bestCandPos[0], bestCandPos[1]);
    return {
      optimalPosEnu: bestCandPos,
      optimalLatDeg: Number(geo.latDeg.toFixed(5)),
      optimalLonDeg: Number(geo.lonDeg.toFixed(5)),
      elevationMslM: Math.round(bestCandPos[2]),
      orbitAvailabilityPct: Number(bestOrbitAvail.toFixed(1)),
      groundNodeCoveragePct: Number(bestGroundCov.toFixed(1)),
      meanSinrToAcnDb: Number(bestMeanSinr.toFixed(1)),
    };
  }
}
