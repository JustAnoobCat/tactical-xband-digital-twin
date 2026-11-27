import { describe, expect, it } from 'vitest';
import {
  GEODESY_ORIGIN_LAT_DEG,
  GEODESY_ORIGIN_LON_DEG,
  WGS84_A_M,
  WGS84_B_M,
  ecefToGeodetic,
  enuToGeodetic,
  geodeticToCartesian,
  geodeticToEcef,
  geodeticToEnu,
  latLonToLocal,
  localToLatLon,
  wgs84LocalRadii,
  wgs84SlantRangeAndLookAngles,
  wgs84VincentyInverse,
} from '../core/geodesy';
import { EnvironmentConfig, RFConfig } from '../core/config';
import { LinkBudgetEngine } from '../core/linkBudget';
import { BIOME_DEM_METADATA, TerrainEngine, generateAridDesertElevationGrid } from '../core/terrain';
import { THEATER_BIOMES, type AdvectingWeatherCell } from '../core/biomePhysics';
import { worldLosToBodyFrame } from '../core/antennaArray';
import { PolarViewshedEngine } from '../core/viewshedEngine';
import { DEFAULT_CALIBRATION_PARAMS, evaluateTwinCalibrationTrace, type FlightTestTraceSample } from '../core/digitalTwinCalibrationEngine';
import type { Position3D } from '../shared/types';

describe('Core Physics, ITU-R Propagation, DCM Kinematics & WGS-84 Geodesy', () => {
  it('round-trips WGS-84 ECEF, 3D ENU, 2D surface projection, and Vincenty geodesy accurately', () => {
    const eqEcef = geodeticToEcef(0.0, 0.0, 0.0);
    expect(Math.abs(eqEcef.x - WGS84_A_M)).toBeLessThan(1e-4);
    expect(Math.abs(eqEcef.y)).toBeLessThan(1e-4);
    expect(Math.abs(eqEcef.z)).toBeLessThan(1e-4);

    const npEcef = geodeticToEcef(90.0, 0.0, 0.0);
    expect(Math.abs(npEcef.z - WGS84_B_M)).toBeLessThan(1e-4);

    const theaterPoints = [
      { lat: 34.5, lon: 76.5, alt: 0 },
      { lat: 34.5, lon: 76.5, alt: 3500 },
      { lat: 35.8, lon: 78.1, alt: 12000 },
      { lat: 33.1, lon: 74.9, alt: 8000 },
    ];
    for (const pt of theaterPoints) {
      const ecef = geodeticToEcef(pt.lat, pt.lon, pt.alt);
      const recEcef = ecefToGeodetic(ecef.x, ecef.y, ecef.z);
      expect(Math.abs(recEcef.latDeg - pt.lat)).toBeLessThan(1e-9);
      expect(Math.abs(recEcef.lonDeg - pt.lon)).toBeLessThan(1e-9);
      expect(Math.abs(recEcef.altM - pt.alt)).toBeLessThan(1e-4);

      const enu = geodeticToEnu(pt.lat, pt.lon, pt.alt);
      const recEnu = enuToGeodetic(enu.eastM, enu.northM, enu.upM);
      expect(Math.abs(recEnu.latDeg - pt.lat)).toBeLessThan(1e-9);
      expect(Math.abs(recEnu.lonDeg - pt.lon)).toBeLessThan(1e-9);
      expect(Math.abs(recEnu.altM - pt.alt)).toBeLessThan(1e-4);
    }

    const geo = localToLatLon(150000, -150000, GEODESY_ORIGIN_LAT_DEG, GEODESY_ORIGIN_LON_DEG, 0);
    const local = latLonToLocal(geo.latDeg, geo.lonDeg, GEODESY_ORIGIN_LAT_DEG, GEODESY_ORIGIN_LON_DEG);
    expect(Math.hypot(local.xM - 150000, local.yM - (-150000))).toBeLessThan(1e-3);

    const flat = geodeticToCartesian(35.85, 78.13, 'equirectangular');
    const wgs = geodeticToCartesian(35.85, 78.13, 'wgs84-enu');
    expect(flat.xM - wgs.xM).toBeGreaterThan(2000.0);

    const vBench = wgs84VincentyInverse(-37.951033416667, 144.424867888889, -37.652821138889, 143.926495527778);
    expect(Math.abs(vBench.distanceM - 54972.271)).toBeLessThan(0.005);
    expect(Math.abs(vBench.initialBearingDeg - 306.868158)).toBeLessThan(0.005);

    const vAntipodal = wgs84VincentyInverse(0.0, 0.0, 0.0, 180.0);
    expect(vAntipodal.distanceM).toBeGreaterThan(19_900_000.0);
    expect(vAntipodal.converged).toBe(false);

    const radii = wgs84LocalRadii(34.5);
    expect(radii.Rm).toBeGreaterThan(6_300_000);
    const look = wgs84SlantRangeAndLookAngles(34.5, 76.5, 0, 34.5, 78.68, 0);
    expect(look.elevationDeg).toBeLessThan(-0.5);
  });

  it('enforces ITU-R P.526 diffraction, P.676 gaseous scaling, P.838/P.839 biome freezing isotherm & P.618 sky-noise', () => {
    const rf = new RFConfig();
    const wl = rf.wavelengthM;

    const radii = [2.0, 10.0, 50.0, 100.0, 200.0, 300.0];
    const crestLosses = radii.map((r) => TerrainEngine.computeCrestCurvatureLossDb(r, 1000.0, 1000.0, 10.0, wl));
    expect(crestLosses[0]).toBeLessThan(2.0);
    expect(crestLosses[crestLosses.length - 1]).toBeGreaterThan(8.0);
    for (let i = 1; i < crestLosses.length; i++) {
      expect(crestLosses[i]).toBeGreaterThan(crestLosses[i - 1]);
    }

    const j1 = TerrainEngine.computeKnifeEdgeLossDb(200.0, 3000.0, 7000.0, wl);
    const j2 = TerrainEngine.computeKnifeEdgeLossDb(200.0, 7000.0, 3000.0, wl);
    const bull = TerrainEngine.computeBullingtonApex(0, 0, 10000.0, 200.0 / 3000.0, 200.0 / 3000.0, 3000.0, 7000.0);
    const jBull = TerrainEngine.computeKnifeEdgeLossDb(bull.hBull, bull.sBull, 10000.0 - bull.sBull, wl);
    expect(bull.sBull).toBeGreaterThan(3000.0);
    expect(bull.sBull).toBeLessThan(7000.0);
    expect(jBull).toBeGreaterThan(Math.max(j1, j2));

    const seaGas = LinkBudgetEngine.computeGaseousAttenuationDb(20000.0, 0.0, 500.0);
    const ladakhGas = LinkBudgetEngine.computeGaseousAttenuationDb(20000.0, 3500.0, 5500.0);
    expect(ladakhGas).toBeLessThan(seaGas);
    expect((seaGas - ladakhGas) / seaGas).toBeGreaterThan(0.4);

    const engine = new LinkBudgetEngine();
    const rainEnv = new EnvironmentConfig({ rainRateMmH: 30.0 });
    const maritime = engine.evaluateLink({
      nodeType: 'soldier',
      slantRangeM: 10000,
      rf,
      env: rainEnv,
      nodeAltM: 4800,
      acnAltM: 5400,
      biomeId: 'maritime_littoral',
    });
    const alpine = engine.evaluateLink({
      nodeType: 'soldier',
      slantRangeM: 10000,
      rf,
      env: rainEnv,
      nodeAltM: 4800,
      acnAltM: 5400,
      biomeId: 'alpine_mountain',
    });
    expect(maritime.rainLossDb).toBeGreaterThan(alpine.rainLossDb * 5.0);
    expect(maritime.skyNoiseIncreaseDb ?? 0).toBeGreaterThan(0.5);
  });

  it('matches LinkBudgetEngine EvaluateLinkOptions to positional call and localizes weather cells', () => {
    const rf = new RFConfig();
    const env = new EnvironmentConfig({ rainRateMmH: 20.0 });
    const engine = new LinkBudgetEngine();

    const posRes = engine.evaluateLink('soldier', 10000, 2.5, rf, env, false, 38.0, undefined, 3200, 5000);
    const optRes = engine.evaluateLink({
      nodeType: 'soldier',
      slantRangeM: 10000,
      diffractionLossDb: 2.5,
      rf,
      env,
      obstacleBlocked: false,
      customTxPowerDbm: 38.0,
      nodeAltM: 3200,
      acnAltM: 5000,
    });
    expect(optRes.snrDb).toBe(posRes.snrDb);
    expect(optRes.rainLossDb).toBe(posRes.rainLossDb);
    expect(optRes.prxDbm).toBe(posRes.prxDbm);

    const stormCell: AdvectingWeatherCell = {
      id: 'storm-east',
      centerX0M: 5000,
      centerY0M: 0,
      velocityXMps: 0,
      velocityYMps: 0,
      radiusM: 2000,
      peakRainRateMmH: 50,
    };
    const dryEnv = new EnvironmentConfig({ rainRateMmH: 0 });
    const thruStorm = engine.evaluateLink({
      nodeType: 'soldier',
      slantRangeM: 10000,
      rf,
      env: dryEnv,
      nodeAltM: 100,
      acnAltM: 1000,
      txX: 0,
      txY: 0,
      rxX: 10000,
      rxY: 0,
      biomeEmParams: {
        enableBiomeEmPhysics: true,
        biomeId: 'open_plains',
        weatherCells: [stormCell],
        simTimeSec: 0,
      },
    });
    const clearWest = engine.evaluateLink({
      nodeType: 'soldier',
      slantRangeM: 10000,
      rf,
      env: dryEnv,
      nodeAltM: 100,
      acnAltM: 1000,
      txX: -15000,
      txY: 0,
      rxX: -5000,
      rxY: 0,
      biomeEmParams: {
        enableBiomeEmPhysics: true,
        biomeId: 'open_plains',
        weatherCells: [stormCell],
        simTimeSec: 0,
      },
    });
    expect(thruStorm.weatherCellRainMmH ?? 0).toBeGreaterThan(10.0);
    expect(thruStorm.rainLossDb).toBeGreaterThan(0.5);
    expect(clearWest.weatherCellRainMmH).toBe(0.0);
    expect(clearWest.rainLossDb).toBe(0.0);
  });

  it('verifies passive NED->FRD worldLosToBodyFrame DCM orthogonality, det=+1, and right-wing-down roll', () => {
    for (const yawDeg of [0, 37, 145, 290]) {
      for (const pitchDeg of [-20, 0, 18]) {
        for (const rollDeg of [-35, 0, 30]) {
          const att = { yawDeg, pitchDeg, rollDeg };
          const c0 = worldLosToBodyFrame(0, 1, 0, att);
          const c1 = worldLosToBodyFrame(1, 0, 0, att);
          const c2 = worldLosToBodyFrame(0, 0, -1, att);
          const R = [
            [c0.bodyForward, c1.bodyForward, c2.bodyForward],
            [c0.bodyRight, c1.bodyRight, c2.bodyRight],
            [c0.bodyDown, c1.bodyDown, c2.bodyDown],
          ];
          for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
              const dot = R[0][i] * R[0][j] + R[1][i] * R[1][j] + R[2][i] * R[2][j];
              expect(Math.abs(dot - (i === j ? 1.0 : 0.0))).toBeLessThan(1e-12);
            }
          }
          const det =
            R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
            R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
            R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
          expect(Math.abs(det - 1.0)).toBeLessThan(1e-12);
        }
      }
    }

    const nadirRoll30 = worldLosToBodyFrame(0, 0, -1, { yawDeg: 0, pitchDeg: 0, rollDeg: 30 });
    expect(Math.abs(nadirRoll30.bodyForward)).toBeLessThan(1e-12);
    expect(Math.abs(nadirRoll30.bodyRight - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(nadirRoll30.bodyDown - Math.cos(Math.PI / 6))).toBeLessThan(1e-12);
  });

  it('maintains < 1.0 dB PolarViewshedEngine fast-vs-parity agreement', () => {
    const terrain = new TerrainEngine({ customElevationFn: () => 3200.0 });
    const viewshed = new PolarViewshedEngine();
    const rf = new RFConfig();
    const env = new EnvironmentConfig();
    const acnPos: Position3D = [0, 0, 5000];
    const acnVel: Position3D = [0, 60, 0];

    for (const b of [0, 35, 90, 180, 270]) {
      const fastSinr = viewshed.computeCellSinr(b, 7500, acnPos, acnVel, terrain, rf, env, { headingDeg: 0, pitchDeg: 5, bankDeg: 18 }, undefined, 'fast');
      const paritySinr = viewshed.computeCellSinr(b, 7500, acnPos, acnVel, terrain, rf, env, { headingDeg: 0, pitchDeg: 5, bankDeg: 18 }, undefined, 'link-budget-parity');
      expect(Math.abs(fastSinr - paritySinr)).toBeLessThan(1.0);
    }
  });

  it('verifies TerrainEngine non-Ladakh biome bounds, worldToLatLon round-trip, and calibration rain loss', () => {
    const te = new TerrainEngine({ terrainMode: 'real' });
    te.setBiome('arid_desert');
    const desertCenter = te.worldToLatLon(0, 0);
    expect(Math.abs(desertCenter.latDeg - THEATER_BIOMES.arid_desert.centerLatDeg)).toBeLessThan(0.05);
    expect(Math.abs(desertCenter.lonDeg - THEATER_BIOMES.arid_desert.centerLonDeg)).toBeLessThan(0.05);

    const roundTrip = te.latLonToWorld(desertCenter.latDeg, desertCenter.lonDeg);
    expect(Math.hypot(roundTrip.xM, roundTrip.yM)).toBeLessThan(1e-3);

    const desertMeta = BIOME_DEM_METADATA.arid_desert;
    const directGrid = generateAridDesertElevationGrid(512);
    expect(Math.abs(te.getElevation(desertMeta.minX!, desertMeta.maxY!) - directGrid[0])).toBeLessThan(1e-3);
    expect(Math.abs(te.getElevation(desertMeta.minX!, desertMeta.minY!) - directGrid[511 * 512])).toBeLessThan(1e-3);

    te.setBiome('maritime_littoral');
    expect(te.getElevation(-80000, 0)).toBe(0.0);
    expect(te.getElevation(80000, 0)).toBeGreaterThan(50.0);

    const baseParams = { ...DEFAULT_CALIBRATION_PARAMS, rainAttenScale: 1.0 };
    const drySamples: FlightTestTraceSample[] = [
      { timeS: 0, slantRangeM: 12000, txAltM: 4200, rxAltM: 3000, measuredSnrDb: 15.0, rainRateMmH: 0 },
    ];
    const wetSamples: FlightTestTraceSample[] = [
      { timeS: 0, slantRangeM: 12000, txAltM: 4200, rxAltM: 3000, measuredSnrDb: 15.0, rainRateMmH: 25 },
    ];
    const dryReport = evaluateTwinCalibrationTrace(drySamples, baseParams);
    const wetReport = evaluateTwinCalibrationTrace(wetSamples, baseParams);
    expect(dryReport.points[0].predictedSnrDb - wetReport.points[0].predictedSnrDb).toBeGreaterThan(0.5);
  });
});
