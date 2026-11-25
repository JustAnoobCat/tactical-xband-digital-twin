import assert from 'node:assert/strict';

let suitePassed = 0;
let suiteFailed = 0;

function describe(name: string, fn: () => void): void {
  console.log(`\n▶ ${name}`);
  fn();
}

function it(name: string, fn: () => void): void {
  try {
    fn();
    suitePassed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    suiteFailed++;
    console.error(`  ✖ ${name}`);
    console.error(err);
  }
}

import { EnvironmentConfig, RFConfig } from '../core/config';
import {
  computeSiteProbeViewshed,
  type ToolboxSimulationContext,
} from '../ui/terrainToolboxAnalysis';
import {
  encodeProbeSignalHeatmapRgba,
  sampleProbeSignalAtWorldPoint,
} from '../ui/terrainToolboxCharts';

function createRidgeContext(ridgeHeightM = 1400): ToolboxSimulationContext {
  const inBounds = (xM: number, yM: number) => Math.abs(xM) <= 40000 && Math.abs(yM) <= 40000;
  const getElev = (xM: number, _yM: number) => {
    // Steep north-south ridge along x = +5000 m, flat valley on the west (x < 0)
    if (xM > 3500 && xM < 6500) {
      const t = 1 - Math.abs(xM - 5000) / 1500;
      return 3500 + ridgeHeightM * Math.max(0, t);
    }
    return 3500;
  };
  const terrainEngine = {
    terrainMode: 'real',
    hasRealDem: true,
    realDemGrid: new Float32Array(1),
    isWithinDemCoverage: inBounds,
    getDemElevation: getElev,
    getBounds: () => ({ minX: -40000, maxX: 40000, minY: -40000, maxY: 40000 }),
    getElevation: getElev,
    computeSlantGeometry: (p1: [number, number, number], p2: [number, number, number]) => {
      const d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const dz = p2[2] - p1[2];
      return {
        distance2D: d2,
        distance3D: Math.hypot(d2, dz),
        elevationDeg: d2 > 0 ? (Math.atan2(dz, d2) * 180) / Math.PI : 90,
      };
    },
    obstacleField: { all: [] },
    getMetadata: () => ({ source: 'Synthetic Ridge Test' }),
  } as any;

  return {
    terrainEngine,
    envConfig: new EnvironmentConfig(),
    rfConfig: new RFConfig(),
    acnPositionMslM: [0, 0, 7500],
    acnOrbitCenterM: [0, 0],
    acnOrbitRadiusM: 12000,
    acnAltitudeMslM: 7500,
    groundNodes: [],
    isHistoricalInspecting: false,
    spatialLocked: false,
  } as any;
}

describe('Probe RF Signal Propagation Heat Map', () => {
  it('computes physical 8 GHz SINR & RSSI grids with clear valley > ridge shadow and exact +10 dB MCP TX gain', () => {
    const ctx = createRidgeContext(1400);
    const vsSoldier = computeSiteProbeViewshed(ctx, {
      xM: 0,
      yM: 0,
      observerAglM: 10,
      radiusM: 16000,
      targetMode: 'ground_agl',
      targetAglM: 2,
      includeObstacles: false,
      txPowerDbm: 30,
    });

    assert.equal(vsSoldier.isSiteWithinCoverage, true);
    assert.equal(vsSoldier.txPowerDbm, 30);
    assert.equal(vsSoldier.sinrGrid.length, vsSoldier.nAzimuths * vsSoldier.nRings);
    assert.equal(vsSoldier.rssiGridDbm.length, vsSoldier.nAzimuths * vsSoldier.nRings);
    assert.ok(vsSoldier.signalSummary.usableCoveragePct > 0);
    assert.ok(vsSoldier.signalSummary.outageCoveragePct > 0);

    // West (clear valley at x = -10000) vs East (behind 1400m ridge at x = +10000)
    const westClear = sampleProbeSignalAtWorldPoint(vsSoldier, -10000, 0);
    const eastShadow = sampleProbeSignalAtWorldPoint(vsSoldier, 10000, 0);
    assert.ok(westClear, 'expected valid sample in clear west valley');
    assert.ok(eastShadow, 'expected valid sample behind east ridge');
    assert.ok(
      westClear.sinrDb > eastShadow.sinrDb + 15,
      `expected clear valley SINR (${westClear.sinrDb.toFixed(1)} dB) to exceed ridge shadow (${eastShadow.sinrDb.toFixed(1)} dB) by > 15 dB`
    );

    // Near clear cell vs far clear cell (FSPL distance decay)
    const nearWest = sampleProbeSignalAtWorldPoint(vsSoldier, -2000, 0);
    const farWest = sampleProbeSignalAtWorldPoint(vsSoldier, -14000, 0);
    assert.ok(nearWest && farWest);
    assert.ok(
      nearWest.sinrDb > farWest.sinrDb + 10,
      `expected near clear SINR (${nearWest.sinrDb.toFixed(1)} dB) > far clear SINR (${farWest.sinrDb.toFixed(1)} dB)`
    );

    // 40 dBm MCP vs 30 dBm Soldier shifts SINR and RSSI up by +10 dB
    const vsMcp = computeSiteProbeViewshed(ctx, {
      xM: 0,
      yM: 0,
      observerAglM: 10,
      radiusM: 16000,
      targetMode: 'ground_agl',
      targetAglM: 2,
      includeObstacles: false,
      txPowerDbm: 40,
    });
    assert.equal(vsMcp.txPowerDbm, 40);
    assert.ok(vsMcp.signalSummary.meanSinrDb !== null && vsSoldier.signalSummary.meanSinrDb !== null);
    assert.ok(
      Math.abs((vsMcp.signalSummary.meanSinrDb! - vsSoldier.signalSummary.meanSinrDb!) - 10) < 0.05,
      `expected MCP mean SINR delta to be +10.0 dB, got ${(vsMcp.signalSummary.meanSinrDb! - vsSoldier.signalSummary.meanSinrDb!).toFixed(3)} dB`
    );
    const westMcp = sampleProbeSignalAtWorldPoint(vsMcp, -10000, 0);
    assert.ok(westMcp);
    assert.ok(Math.abs((westMcp.rssiDbm - westClear.rssiDbm) - 10) < 0.05);
  });

  it('handles out-of-coverage probe sites gracefully', () => {
    const ctx = createRidgeContext(1000);
    const vsOut = computeSiteProbeViewshed(ctx, {
      xM: 150000,
      yM: 150000,
      observerAglM: 5,
      radiusM: 10000,
      targetMode: 'ground_agl',
      targetAglM: 2,
      includeObstacles: false,
    });

    assert.equal(vsOut.isSiteWithinCoverage, false);
    assert.equal(vsOut.signalSummary.usableCoveragePct, 0);
    assert.equal(sampleProbeSignalAtWorldPoint(vsOut, 150000, 150000), null);
  });

  it('rasterizes distinct palettes, discrete LoS mode, outer circle transparency, and iso-dB contours', () => {
    const ctx = createRidgeContext(1200);
    const vs = computeSiteProbeViewshed(ctx, {
      xM: 0,
      yM: 0,
      observerAglM: 10,
      radiusM: 18000,
      targetMode: 'ground_agl',
      targetAglM: 2,
      includeObstacles: false,
      txPowerDbm: 30,
    });

    const size = 96;
    const rfNoIso = encodeProbeSignalHeatmapRgba(vs, size, {
      mode: 'signal',
      palette: 'rf_spectrum',
      showContours: false,
    });
    const rfWithIso = encodeProbeSignalHeatmapRgba(vs, size, {
      mode: 'signal',
      palette: 'rf_spectrum',
      showContours: true,
    });
    const thermal = encodeProbeSignalHeatmapRgba(vs, size, {
      mode: 'signal',
      palette: 'thermal',
      showContours: false,
    });
    const viridis = encodeProbeSignalHeatmapRgba(vs, size, {
      mode: 'signal',
      palette: 'viridis',
      showContours: false,
    });
    const viewshed = encodeProbeSignalHeatmapRgba(vs, size, {
      mode: 'viewshed',
    });

    assert.equal(rfNoIso.length, size * size * 4);
    // Corner pixel outside circular footprint must be fully transparent
    assert.equal(rfNoIso[3], 0);
    // Center pixel inside footprint must be visible
    const centerIdx = ((size >> 1) * size + (size >> 1)) * 4;
    assert.ok(rfNoIso[centerIdx + 3] > 180);

    // Palettes must differ visibly
    const diffCount = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) {
          n++;
        }
      }
      return n;
    };

    assert.ok(diffCount(rfNoIso, thermal) > 200, 'thermal palette should differ from rf_spectrum');
    assert.ok(diffCount(rfNoIso, viridis) > 200, 'viridis palette should differ from rf_spectrum');
    assert.ok(diffCount(rfNoIso, viewshed) > 200, 'viewshed discrete mode should differ from continuous signal mode');
    assert.ok(diffCount(rfNoIso, rfWithIso) > 20, 'iso-dB contours should alter contour boundary pixels');

    // Out-of-radius sampling returns null
    assert.equal(sampleProbeSignalAtWorldPoint(vs, 25000, 0), null);
  });
});

console.log(`\nℹ tests ${suitePassed + suiteFailed} | pass ${suitePassed} | fail ${suiteFailed}`);
if (suiteFailed > 0) {
  throw new Error(`${suiteFailed} test(s) failed`);
}
