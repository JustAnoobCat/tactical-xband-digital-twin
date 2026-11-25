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
import {
  createDefaultWorkspaceTilesState,
  toggleWorkspaceTilesEnabled,
  toggleWorkspaceTile,
  closeWorkspaceTile,
  moveWorkspaceTile,
  toggleWorkspaceTileCollapsed,
  setWorkspaceTilesLayout,
  applyWorkspaceTilesPreset,
  computeWorkspaceGridColumns,
  serializeWorkspaceTilesState,
  deserializeWorkspaceTilesState,
  buildWorkspaceTileTelemetry,
  MAX_OPEN_WORKSPACE_TILES,
} from '../ui/workspaceTilesManager';

describe('workspaceTilesManager state & layout reducers', () => {
  it('initializes with 3 default side-by-side telemetry tiles disabled by default', () => {
    const s0 = createDefaultWorkspaceTilesState();
    assert.equal(s0.enabled, false);
    assert.equal(s0.layout, 'row');
    assert.deepEqual(s0.openTiles, ['transect', 'probe', 'region']);

    const s1 = toggleWorkspaceTilesEnabled(s0);
    assert.equal(s1.enabled, true);
    assert.deepEqual(s1.openTiles, ['transect', 'probe', 'region']);
  });

  it('toggles tiles on/off while enforcing min-1 and max-4 side-by-side limits', () => {
    let s = toggleWorkspaceTilesEnabled(createDefaultWorkspaceTilesState(), true);

    // Add 4th tile ('obstacle')
    s = toggleWorkspaceTile(s, 'obstacle');
    assert.equal(s.openTiles.length, MAX_OPEN_WORKSPACE_TILES);
    assert.ok(s.openTiles.includes('obstacle'));
    assert.equal(s.focusedTile, 'obstacle');

    // Adding a 5th tile ('dem') evicts oldest non-focused tile and keeps length at 4
    s = toggleWorkspaceTile(s, 'dem');
    assert.equal(s.openTiles.length, MAX_OPEN_WORKSPACE_TILES);
    assert.ok(s.openTiles.includes('dem'));
    assert.ok(s.openTiles.includes('obstacle'));

    // Toggle tiles off down to min-1
    s = toggleWorkspaceTile(s, s.openTiles[0]);
    s = toggleWorkspaceTile(s, s.openTiles[0]);
    s = toggleWorkspaceTile(s, s.openTiles[0]);
    assert.equal(s.openTiles.length, 1);

    // Toggling off the final tile keeps at least 1 open
    const lastId = s.openTiles[0];
    s = toggleWorkspaceTile(s, lastId);
    assert.deepEqual(s.openTiles, [lastId]);

    // Explicitly closing the final tile disables Workspace Tiles mode cleanly
    s = closeWorkspaceTile(s, lastId);
    assert.equal(s.enabled, false);
  });

  it('supports reordering tiles, collapsing/expanding, layout switching, and presets', () => {
    let s = applyWorkspaceTilesPreset(createDefaultWorkspaceTilesState(), 'rf_pair');
    assert.equal(s.enabled, true);
    assert.equal(s.layout, 'row');
    assert.deepEqual(s.openTiles, ['transect', 'probe']);

    s = moveWorkspaceTile(s, 'probe', -1);
    assert.deepEqual(s.openTiles, ['probe', 'transect']);

    s = toggleWorkspaceTileCollapsed(s, 'probe');
    assert.deepEqual(s.collapsedTiles, ['probe']);
    s = toggleWorkspaceTileCollapsed(s, 'probe');
    assert.deepEqual(s.collapsedTiles, []);

    s = applyWorkspaceTilesPreset(s, 'full_quad');
    assert.equal(s.layout, 'grid');
    assert.deepEqual(s.openTiles, ['transect', 'probe', 'region', 'obstacle']);

    s = setWorkspaceTilesLayout(s, 'row');
    assert.equal(s.layout, 'row');
  });

  it('computes responsive grid column counts without crushing tiles', () => {
    assert.equal(computeWorkspaceGridColumns(3, 'row', 840), 3);
    assert.equal(computeWorkspaceGridColumns(4, 'row', 840), 4);
    assert.equal(computeWorkspaceGridColumns(4, 'row', 500), 2);
    assert.equal(computeWorkspaceGridColumns(4, 'grid', 800), 2);
    assert.equal(computeWorkspaceGridColumns(1, 'grid', 800), 1);
  });

  it('round-trips serialized state safely and recovers from malformed JSON', () => {
    let s = applyWorkspaceTilesPreset(createDefaultWorkspaceTilesState(), 'full_quad');
    s = toggleWorkspaceTileCollapsed(s, 'region');
    const raw = serializeWorkspaceTilesState(s);
    const parsed = deserializeWorkspaceTilesState(raw);
    assert.deepEqual(parsed, s);

    const recovered = deserializeWorkspaceTilesState('{bad-json');
    assert.deepEqual(recovered, createDefaultWorkspaceTilesState());
  });
});

describe('workspaceTilesManager live concurrent telemetry formatting', () => {
  it('formats live telemetry across all 5 tools with zero NaN values', () => {
    const input = {
      activeMode: 'transect',
      radarRangeM: 60000,
      backdropMode: 'relief',
      terrainSector: 'ladakh',
      terrainElevMinM: 1985,
      terrainElevMaxM: 7386,
      terrainGridSize: '512×512',
      groundNodeCount: 16,
      transectResult: {
        totalHorizontalM: 72970,
        azimuthDeg: 125.4,
        elevDeltaM: -120,
        minFresnelClearanceM: -582.2,
        estSnrDb: -25.6,
        isObstructed: true,
        estModcod: 'OUTAGE',
      },
      probeSite: { xM: 1000, yM: 2000 },
      viewshedResult: {
        acnLink: {
          estSinrDb: 18.4,
          isLos: true,
          slantRangeM: 13790,
          elevationAngleDeg: 14.2,
          modcod: '16-QAM',
        },
        skyOpenPct: 84,
      },
      aoSwathBox: { x1: -6000, y1: -6000, x2: 6000, y2: 6000 },
      aoSwathReport: {
        losCoveragePct: 68,
        deadZonePct: 22,
        meanSinrDb: 11.2,
        summitPeak: { zMslM: 4329 },
        valleyFloor: { zMslM: 2936 },
      },
      obstacles: [
        { id: 'obs-1', depthM: 1600, widthM: 45, heightM: 420 },
      ],
      obsSelectedId: 'obs-1',
      cadObstacleReport: {
        intersections: [{ nodeId: 1 }, { nodeId: 2 }],
        slicedNodeIds: [1],
        maxRequiredHeightToSliceAllM: 510,
        midTopElevM: 4164,
      },
    };

    const dem = buildWorkspaceTileTelemetry('dem', input);
    assert.equal(dem.heroValue, 'Ladakh Alpine');
    assert.equal(dem.metrics[0].value, '1985–7386 m');

    const line = buildWorkspaceTileTelemetry('transect', input);
    assert.equal(line.heroValue, '72.97 km');
    assert.equal(line.statusLabel, 'BLOCKED');
    assert.equal(line.tone, 'blocked');

    const probe = buildWorkspaceTileTelemetry('probe', input);
    assert.equal(probe.heroValue, '18.4 dB');
    assert.equal(probe.tone, 'clear');
    assert.ok((probe.meterPct ?? 0) > 50);

    const region = buildWorkspaceTileTelemetry('region', input);
    assert.equal(region.heroValue, '68%');
    assert.equal(region.statusLabel, '144 km²');
    assert.deepEqual(region.coverageBar, { clearPct: 68, marginalPct: 10, deadZonePct: 22 });

    const obs = buildWorkspaceTileTelemetry('obstacle', input);
    assert.equal(obs.heroValue, '1.60 km');
    assert.equal(obs.statusLabel, '1/2 Blocked');
    assert.equal(obs.tone, 'blocked');

    // Ensure zero NaN anywhere across all formatted outputs
    for (const tile of [dem, line, probe, region, obs]) {
      assert.ok(!JSON.stringify(tile).includes('NaN'));
    }
  });

  it('maps live runtime shapes (cursorProbeLive, rulerMetrics/rulerEvaluation, fractional deadZonePct)', () => {
    const runtimeInput = {
      activeMode: 'probe',
      radarRangeM: 60000,
      backdropMode: 'relief',
      terrainSector: 'kargil',
      rulerMetrics: {
        horizontalDistanceM: 34120,
        azimuthDeg: 118.4,
        cardinalOctant: 'ESE',
        elevationDeltaM: 612.8,
      },
      rulerEvaluation: {
        isLineOfSightClear: false,
        minClearanceM: -144.6,
      },
      transectSnrLabel: '-14.2 dB / OUTAGE',
      transectFresnelLabel: '-145 m (0%)',
      probeSite: { xM: -4200, yM: 3800 },
      cursorProbeLive: {
        estSinrDb: 12.6,
        isLos: true,
        modcodName: 'QPSK 3/4',
        d3dKm: 19.42,
        elToAcnDeg: 11.7,
        skyOpennessPct: 76.4,
      },
      aoSwathBox: { x1: -6000, y1: -6000, x2: 6000, y2: 6000 },
      aoSwathReport: {
        losCoveragePct: 39.0625,
        deadZonePct: 60.9375,
        meanSinrDb: 4.5,
        summitPeak: { zMslM: 5102 },
        valleyFloor: { zMslM: 2840 },
      },
    };

    const line = buildWorkspaceTileTelemetry('transect', runtimeInput);
    assert.equal(line.heroValue, '34.12 km');
    assert.equal(line.statusLabel, 'BLOCKED');
    assert.equal(line.metrics[0].value, '118° ESE');
    assert.equal(line.metrics[1].value, '+613 m');
    assert.equal(line.metrics[2].value, '-145 m');
    assert.equal(line.metrics[3].value, '-14.2 dB');

    const probe = buildWorkspaceTileTelemetry('probe', runtimeInput);
    assert.equal(probe.heroValue, '12.6 dB');
    assert.equal(probe.tone, 'clear');
    assert.equal(probe.metrics[0].value, 'QPSK 3/4');
    assert.equal(probe.metrics[1].value, '19.4 km');
    assert.equal(probe.metrics[2].value, '+11.7°');
    assert.equal(probe.metrics[3].value, '76%');

    const region = buildWorkspaceTileTelemetry('region', runtimeInput);
    assert.equal(region.heroValue, '39%');
    assert.equal(region.metrics[2].value, '61%');
    assert.ok(!region.metrics[2].value.includes('.'));
  });
});

console.log(`\nℹ tests ${suitePassed + suiteFailed} | pass ${suitePassed} | fail ${suiteFailed}`);
if (suiteFailed > 0) {
  throw new Error(`${suiteFailed} test(s) failed`);
}

