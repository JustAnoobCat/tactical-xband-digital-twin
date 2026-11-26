/**
 * Fixed-capacity direct-mapped ray-march obstruction cache extracted from SimulationWorkerManager.
 * Preserves deterministic spatial-revision and parameter-hash invalidation with zero per-tick allocations.
 */

import type { TerrainEngine, TerrainObstruction } from '../core/terrain';

interface RayMarchSlot {
  valid: boolean;
  nx: number;
  ny: number;
  nz: number;
  qAx: number;
  qAy: number;
  qAz: number;
  rev: number;
  obs: unknown;
  biome: string;
  mode: string;
  dem: unknown;
  wl: number;
  rEff: number;
  step: number;
  pert: number;
  res: TerrainObstruction;
}

export class RayMarchCache {
  public hits: number = 0;
  public misses: number = 0;
  private readonly slots: RayMarchSlot[] = Array.from({ length: 4096 }, () => ({
    valid: false,
    nx: 0,
    ny: 0,
    nz: 0,
    qAx: 0,
    qAy: 0,
    qAz: 0,
    rev: 0,
    obs: null as unknown,
    biome: '',
    mode: '',
    dem: null as unknown,
    wl: 0,
    rEff: 0,
    step: 0,
    pert: 0,
    res: null as unknown as TerrainObstruction,
  }));

  public clear(): void {
    this.hits = 0;
    this.misses = 0;
    for (let i = 0; i < 4096; i++) {
      this.slots[i].valid = false;
    }
  }

  public installOnTerrainEngine(
    terrainEngine: TerrainEngine,
    getSpatialRevision: () => number
  ): void {
    const rawEval = terrainEngine.evaluateTerrainObstruction.bind(terrainEngine);
    terrainEngine.evaluateTerrainObstruction = (
      nodePos,
      acnPos,
      rf,
      env,
      stepIntervalM = 100.0,
      pert = 0.0
    ) => {
      const nx = nodePos[0];
      const ny = nodePos[1];
      const nz = nodePos[2];
      const qAx = Math.round(acnPos[0] * 0.125);
      const qAy = Math.round(acnPos[1] * 0.125);
      const qAz = Math.round(acnPos[2] * 0.5);
      const obs = (terrainEngine.obstacleField as unknown as { values: unknown }).values;
      const dem = terrainEngine.realDemGrid;
      const biome = terrainEngine.activeBiomeId;
      const mode = terrainEngine.terrainMode;
      const rev = getSpatialRevision();

      const slotIdx =
        ((Math.imul((nx | 0) ^ ((ny | 0) * 31), 2654435761) ^
          Math.imul(qAx ^ (qAy * 31), 2246822519) ^
          (stepIntervalM | 0)) >>>
          0) &
        4095;
      const s = this.slots[slotIdx];

      if (
        s.valid &&
        s.nx === nx &&
        s.ny === ny &&
        s.nz === nz &&
        s.qAx === qAx &&
        s.qAy === qAy &&
        s.qAz === qAz &&
        s.rev === rev &&
        s.obs === obs &&
        s.biome === biome &&
        s.mode === mode &&
        s.dem === dem &&
        s.wl === rf.wavelengthM &&
        s.rEff === env.effectiveEarthRadiusM &&
        s.step === stepIntervalM &&
        s.pert === pert
      ) {
        this.hits++;
        return s.res;
      }

      const res = rawEval(nodePos, acnPos, rf, env, stepIntervalM, pert);
      this.misses++;
      if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(qAx) && Number.isFinite(qAy)) {
        s.valid = true;
        s.nx = nx;
        s.ny = ny;
        s.nz = nz;
        s.qAx = qAx;
        s.qAy = qAy;
        s.qAz = qAz;
        s.rev = rev;
        s.obs = obs;
        s.biome = biome;
        s.mode = mode;
        s.dem = dem;
        s.wl = rf.wavelengthM;
        s.rEff = env.effectiveEarthRadiusM;
        s.step = stepIntervalM;
        s.pert = pert;
        s.res = res;
      }
      return res;
    };
  }
}
