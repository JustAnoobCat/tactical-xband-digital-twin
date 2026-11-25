import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEM_QUICK_PRESETS,
  resolveDemQuickPresetById,
  resolveDemQuickPresetFromSector,
  computeAutoCadDimensionGeometry,
  computeAutoCadOrthogonalDelta,
  computeVertexInteriorAngleDeg,
  resolveRulerElevationDeltaM,
  resolveRulerSlantDistanceM,
  computeRfSinrMeterState,
  computeQgisCoverageBreakdown,
  computeAoSwathEdgeDimensions,
  getCadBarrierMaterialStyle,
  computeCadExtrusionShadowOffset,
  computeBarrierWallRotationDeg,
  normalizeBarrierTelemetryNodes,
} from '../ui/toolboxPrecisionSuite';
import { evaluateBarrierLinkIntersections } from '../core/cadObstacleSlicerEngine';

describe('toolboxPrecisionSuite DEM Quick-Switch presets', () => {
  it('exposes Ladakh Alpine, Kargil Corridor, and Thar Desert presets without upload', () => {
    assert.equal(DEM_QUICK_PRESETS.length, 3);
    assert.deepEqual(
      DEM_QUICK_PRESETS.map((p) => p.label),
      ['Ladakh Alpine', 'Kargil Corridor', 'Thar Desert']
    );

    const ladakh = resolveDemQuickPresetById('ladakh');
    assert.ok(ladakh);
    assert.equal(ladakh.terrainMode, 'real');
    assert.equal(ladakh.biomeId, 'alpine_mountain');

    const kargil = resolveDemQuickPresetById('kargil');
    assert.ok(kargil);
    assert.equal(kargil.terrainMode, 'synthetic');
    assert.equal(kargil.biomeId, 'alpine_mountain');

    const thar = resolveDemQuickPresetById('arid_desert');
    assert.ok(thar);
    assert.equal(thar.terrainMode, 'synthetic');
    assert.equal(thar.biomeId, 'arid_desert');

    assert.equal(resolveDemQuickPresetFromSector('alpine_mountain'), 'ladakh');
    assert.equal(resolveDemQuickPresetFromSector('thar'), 'arid_desert');
    assert.equal(resolveDemQuickPresetFromSector('unknown'), null);
  });
});

describe('toolboxPrecisionSuite CAD / GIS / RF instrument helpers', () => {
  it('computes upright AutoCAD dimension geometry and metric ruler scale ticks', () => {
    const geom = computeAutoCadDimensionGeometry({ x: 100, y: 100 }, { x: 300, y: 100 }, 10000, true);
    assert.equal(geom.screenLengthPx, 200);
    assert.equal(geom.midX, 200);
    assert.equal(geom.midY, 100);
    assert.ok(geom.textAngleRad >= -Math.PI / 2 && geom.textAngleRad <= Math.PI / 2);
    assert.ok(geom.ticks.length >= 3);
    assert.ok(geom.ticks.some((t) => t.major && t.label !== null));

    const flipped = computeAutoCadDimensionGeometry({ x: 300, y: 100 }, { x: 100, y: 120 }, 5000, false);
    assert.ok(flipped.textAngleRad >= -Math.PI / 2 && flipped.textAngleRad <= Math.PI / 2);
    assert.equal(flipped.ticks.length, 0);
  });

  it('computes AutoCAD MEASUREGEOM orthogonal ΔX/ΔY/ΔZ and 3D slant distance', () => {
    const delta = computeAutoCadOrthogonalDelta({ xM: 1000, yM: 2000 }, { xM: 4000, yM: 6000 }, 3500, 3500);
    assert.equal(delta.deltaXM, 3000);
    assert.equal(delta.deltaYM, 4000);
    assert.equal(delta.deltaZM, 0);
    assert.equal(delta.dist2dM, 5000);
    assert.equal(delta.slant3dM, 5000);
    assert.ok(delta.azimuthDeg > 36 && delta.azimuthDeg < 37);
  });

  it('computes true interior bend angle at polyline vertices across acute, right, obtuse, straight, and degenerate cases', () => {
    const deg45 = computeVertexInteriorAngleDeg({ xM: 1000, yM: 0 }, { xM: 0, yM: 0 }, { xM: 1000, yM: 1000 });
    assert.ok(deg45 !== null && Math.abs(deg45 - 45) < 1e-6);

    const deg90 = computeVertexInteriorAngleDeg({ xM: 0, yM: 1000 }, { xM: 0, yM: 0 }, { xM: 1000, yM: 0 });
    assert.ok(deg90 !== null && Math.abs(deg90 - 90) < 1e-6);

    const deg135 = computeVertexInteriorAngleDeg({ xM: -1000, yM: 0 }, { xM: 0, yM: 0 }, { xM: 1000, yM: 1000 });
    assert.ok(deg135 !== null && Math.abs(deg135 - 135) < 1e-6);

    const deg180 = computeVertexInteriorAngleDeg({ xM: -1000, yM: 0 }, { xM: 0, yM: 0 }, { xM: 1000, yM: 0 });
    assert.ok(deg180 !== null && Math.abs(deg180 - 180) < 1e-6);

    const degZero = computeVertexInteriorAngleDeg({ xM: 1000, yM: 0 }, { xM: 0, yM: 0 }, { xM: 2000, yM: 0 });
    assert.ok(degZero !== null && Math.abs(degZero) < 1e-6);

    assert.equal(computeVertexInteriorAngleDeg({ xM: 0, yM: 0 }, { xM: 0, yM: 0 }, { xM: 100, yM: 0 }), null);
  });

  it('resolves GeodeticRulerMetrics groundElevationDeltaM and slantDistance3DM without falling back to zero', () => {
    assert.equal(resolveRulerElevationDeltaM({ groundElevationDeltaM: -412.5, deltaZM: -420.5 }), -412.5);
    assert.equal(resolveRulerElevationDeltaM({ deltaZM: 185.2 }), 185.2);
    assert.equal(resolveRulerElevationDeltaM({ antennaElevationDeltaM: 74 }), 74);
    assert.equal(resolveRulerElevationDeltaM({ elevationDeltaM: -33 }), -33);
    assert.equal(resolveRulerElevationDeltaM(null), null);

    assert.equal(resolveRulerSlantDistanceM({ slantDistance3DM: 12345.6 }), 12345.6);
    assert.equal(resolveRulerSlantDistanceM({ d3dM: 9876.5 }), 9876.5);
    assert.equal(resolveRulerSlantDistanceM({ slantDistanceM: 4321 }), 4321);
    assert.equal(resolveRulerSlantDistanceM(undefined), null);
  });

  it('classifies Keysight RF SINR meter states across outage, QPSK, 16-QAM, and 64-QAM', () => {
    const standby = computeRfSinrMeterState(null, true);
    assert.equal(standby.bandLabel, 'STANDBY');
    assert.equal(standby.fillPct, 0);

    const shadowed = computeRfSinrMeterState(-4, false);
    assert.equal(shadowed.tone, 'shadowed');
    assert.equal(shadowed.bandLabel, 'OUTAGE');

    const marginal = computeRfSinrMeterState(5, true);
    assert.equal(marginal.tone, 'marginal');
    assert.equal(marginal.bandLabel, 'QPSK');

    const strong = computeRfSinrMeterState(22, true);
    assert.equal(strong.tone, 'clear');
    assert.equal(strong.bandLabel, '64-QAM');
    assert.equal(strong.fillPct, 80);
  });

  it('computes QGIS 3-class coverage breakdown summing to 100%', () => {
    const cov = computeQgisCoverageBreakdown(68, 22);
    assert.equal(cov.clearPct, 68);
    assert.equal(cov.marginalPct, 10);
    assert.equal(cov.deadZonePct, 22);
    assert.equal(cov.clearPct + cov.marginalPct + cov.deadZonePct, 100);
  });

  it('computes AO swath width, height, and area from any corner ordering', () => {
    const dims = computeAoSwathEdgeDimensions({ x1: 8000, y1: 6000, x2: 0, y2: 0 });
    assert.equal(dims.minX, 0);
    assert.equal(dims.maxX, 8000);
    assert.equal(dims.widthKm, 8);
    assert.equal(dims.heightKm, 6);
    assert.equal(dims.areaKm2, 48);
  });

  it('resolves distinct CAD barrier material styles and 2.5D extrusion shadow offsets', () => {
    const g = getCadBarrierMaterialStyle('granite');
    const c = getCadBarrierMaterialStyle('concrete');
    const f = getCadBarrierMaterialStyle('foliage');
    assert.notEqual(g.stroke, c.stroke);
    assert.notEqual(c.stroke, f.stroke);
    assert.match(g.label, /GRANITE/i);
    assert.match(c.label, /CONCRETE/i);
    assert.match(f.label, /FOLIAGE/i);

    const low = computeCadExtrusionShadowOffset(100);
    const high = computeCadExtrusionShadowOffset(900);
    assert.ok(high.dxPx > low.dxPx);
    assert.ok(high.dyPx > low.dyPx);
  });

  it('computes CCW barrier wall rotation matching obstacle local +Y axis across all 4 quadrants', () => {
    const cases = [
      { a: { x: 0, y: 0 }, b: { x: 3000, y: 4000 } },     // Q1 NE
      { a: { x: 0, y: 0 }, b: { x: -3000, y: 4000 } },    // Q2 NW
      { a: { x: 0, y: 0 }, b: { x: -3000, y: -4000 } },   // Q3 SW
      { a: { x: 0, y: 0 }, b: { x: 3000, y: -4000 } },    // Q4 SE
      { a: { x: 1000, y: 1000 }, b: { x: 5000, y: 1000 } }, // Pure East
      { a: { x: 1000, y: 1000 }, b: { x: 1000, y: 5000 } }, // Pure North
    ];
    for (const tc of cases) {
      const rotDeg = computeBarrierWallRotationDeg(tc.a, tc.b);
      const rad = (rotDeg * Math.PI) / 180;
      // Local +Y unit vector in obstacles.ts is (-sin(rad), cos(rad))
      const axisX = -Math.sin(rad);
      const axisY = Math.cos(rad);
      const dx = tc.b.x - tc.a.x;
      const dy = tc.b.y - tc.a.y;
      const len = Math.hypot(dx, dy);
      assert.ok(Math.abs(axisX - dx / len) < 1e-6, `X axis mismatch for rot=${rotDeg}`);
      assert.ok(Math.abs(axisY - dy / len) < 1e-6, `Y axis mismatch for rot=${rotDeg}`);
    }
  });

  it('normalizes raw telemetry nodes so barrier intersection math never yields NaN', () => {
    const rawTelemetry = [
      {
        node_id: 1,
        x_m: 10000,
        y_m: 10000,
        terrain_elevation_msl_m: 3200,
        agl_m: 1.8,
      },
      {
        node_id: 2,
        position: [12000, 14000, 3300],
        agl_m: 2.0,
      },
    ];
    const normalized = normalizeBarrierTelemetryNodes(rawTelemetry);
    assert.equal(normalized.length, 2);
    assert.equal(normalized[0].nodeId, 1);
    assert.equal(normalized[0].xM, 10000);
    assert.equal(normalized[0].yM, 10000);
    assert.equal(normalized[0].groundElevM, 3200);
    assert.equal(normalized[1].nodeId, 2);
    assert.equal(normalized[1].xM, 12000);
    assert.equal(normalized[1].yM, 14000);

    const report = evaluateBarrierLinkIntersections(
      { x: 7000, y: 5000 },
      { x: 13000, y: 5000 },
      1200,
      'wall',
      'granite',
      normalized,
      { x: 10000, y: 0, z: 4500 },
      () => 3200
    );
    assert.equal(report.intersections.length, 2);
    assert.ok(report.slicedNodeIds.includes(1));
    assert.equal(report.intersections[0].sliceVerdict, 'SLICED_BLOCKED');
    assert.ok(Number.isFinite(report.maxRequiredHeightToSliceAllM));
    assert.ok(Number.isFinite(report.recommendedAutoHeightM));
    assert.ok(report.recommendedAutoHeightM > 0);
  });
});

