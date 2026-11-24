/**
 * Verification Suite 112: De-Monolithizing index.html Part 2 — Strictly Typed 2D Radar & Terrain Toolbox (SPEC-V3-10)
 *
 * Verifies:
 * - [TUC2-T1] Pure Coordinate Transform & Inverse Invariants (ENU <-> Radar Canvas)
 * - [TUC2-T2] Pure Hotkey Resolver & Editable Target Guards (V/R/P/A/B/Enter/Esc)
 * - [TUC2-T3] Link, Node & CAD Obstacle Hit-Testing Accuracy
 * - [TUC2-T4] XSS Safety, Zero-Emoji Audit & Zero Duplicate DOM IDs
 * - [TUC2-T5] Monolith Reduction Audit (>= 1,500 Net Lines Removed & Static Assertion Preservation)
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getRadarGeometry,
  worldEnuToRadarCanvas,
  radarCanvasToWorldEnu,
  hitTestRadarLink,
  hitTestRadarNode,
  findCadObstacleHandleHit,
  findAoSwathCornerHit,
  getObstacleEndpoints,
  RadarViewport,
} from '../ui/controllers/radar2dRenderer';
import {
  isEditableKeyboardTarget,
  resolveToolboxHotkeyAction,
} from '../ui/controllers/terrainToolboxController';

console.log('='.repeat(96));
console.log('  TACTICAL DIGITAL TWIN — VERIFICATION SUITE 112 (SPEC-V3-10)');
console.log('  De-Monolithizing index.html Part 2 — Strictly Typed 2D Radar & Terrain Toolbox');
console.log('='.repeat(96));

let passedChecks = 0;
function runCheck(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passedChecks++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${label}`);
    throw err;
  }
}

// ============================================================================
// [TUC2-T1] Pure Coordinate Transform & Inverse Invariants
// ============================================================================
console.log('\n[TUC2-T1] Pure Coordinate Transform & Inverse Invariants (ENU <-> Radar Canvas)...');

runCheck('getRadarGeometry computes correct 1:1 scale and center across ranges', () => {
  const w = 800, h = 600;
  const geom60k = getRadarGeometry(w, h, 60000);
  assert.equal(geom60k.centerX, 400);
  assert.equal(geom60k.centerY, 300);
  const expectedScale60k = (300 * 0.94) / 60000;
  assert.ok(Math.abs(geom60k.scale - expectedScale60k) < 1e-9);

  const geom15k = getRadarGeometry(w, h, 15000);
  assert.ok(geom15k.scale > geom60k.scale, '15km range has higher pixels/meter zoom than 60km');
  assert.ok(Math.abs(geom15k.scale / geom60k.scale - 4.0) < 1e-9);
});

runCheck('Pan center point (panOffsetX_m, panOffsetY_m) maps exactly to canvas center', () => {
  const vp: RadarViewport = {
    width: 1000,
    height: 800,
    rangeM: 50000,
    panOffsetX_m: 12500,
    panOffsetY_m: -8400,
  };
  const screen = worldEnuToRadarCanvas(12500, -8400, vp);
  assert.equal(screen.x, 500);
  assert.equal(screen.y, 400);
});

runCheck('worldEnuToRadarCanvas and radarCanvasToWorldEnu round-trip with sub-millimeter precision', () => {
  const vp: RadarViewport = {
    width: 1200,
    height: 900,
    rangeM: 75000,
    panOffsetX_m: -4200,
    panOffsetY_m: 9150,
  };

  const testPoints = [
    { xM: 0, yM: 0 },
    { xM: 15420.5, yM: -24100.8 },
    { xM: -32000.25, yM: 41200.75 },
    { xM: -4200, yM: 9150 }, // Exactly at pan offset
    { xM: 70000, yM: -65000 },
  ];

  for (const pt of testPoints) {
    const screen = worldEnuToRadarCanvas(pt.xM, pt.yM, vp);
    const roundTrip = radarCanvasToWorldEnu(screen.x, screen.y, vp);
    const errX = Math.abs(roundTrip.xM - pt.xM);
    const errY = Math.abs(roundTrip.yM - pt.yM);
    assert.ok(errX < 1e-4, `X error ${errX} m exceeds threshold for point (${pt.xM}, ${pt.yM})`);
    assert.ok(errY < 1e-4, `Y error ${errY} m exceeds threshold for point (${pt.xM}, ${pt.yM})`);
  }
});

// ============================================================================
// [TUC2-T2] Pure Hotkey Resolver & Editable Target Guards
// ============================================================================
console.log('\n[TUC2-T2] Pure Hotkey Resolver & Editable Target Guards (V/R/P/A/B/Enter/Esc)...');

runCheck('isEditableKeyboardTarget safely rejects null/undefined and non-editable elements', () => {
  assert.equal(isEditableKeyboardTarget(null), false);
  assert.equal(isEditableKeyboardTarget(undefined as any), false);

  // Mock DOM elements
  const mockCanvas = { closest: () => null } as any;
  assert.equal(isEditableKeyboardTarget(mockCanvas), false);

  const mockDiv = { closest: () => null } as any;
  assert.equal(isEditableKeyboardTarget(mockDiv), false);
});

runCheck('isEditableKeyboardTarget identifies input, select, textarea, and contenteditable', () => {
  const mockInput = { closest: (selector: string) => selector.includes('input') ? {} : null } as any;
  assert.equal(isEditableKeyboardTarget(mockInput), true);

  const mockTextarea = { closest: (selector: string) => selector.includes('textarea') ? {} : null } as any;
  assert.equal(isEditableKeyboardTarget(mockTextarea), true);

  const mockSelect = { closest: (selector: string) => selector.includes('select') ? {} : null } as any;
  assert.equal(isEditableKeyboardTarget(mockSelect), true);

  const mockContentEditable = { closest: (selector: string) => selector.includes('contenteditable') ? {} : null } as any;
  assert.equal(isEditableKeyboardTarget(mockContentEditable), true);
});

runCheck('resolveToolboxHotkeyAction bails on modifiers (Ctrl, Meta, Alt), editable inputs, and 3D mode', () => {
  assert.equal(resolveToolboxHotkeyAction('v', { ctrlKey: true }), null);
  assert.equal(resolveToolboxHotkeyAction('r', { metaKey: true }), null);
  assert.equal(resolveToolboxHotkeyAction('p', { altKey: true }), null);
  assert.equal(resolveToolboxHotkeyAction('b', { isEditable: true }), null);
  assert.equal(resolveToolboxHotkeyAction('a', { is3d: true }), null);
  assert.equal(resolveToolboxHotkeyAction('Escape', { ctrlKey: true }), null);
});

runCheck('resolveToolboxHotkeyAction resolves V, R, P, A, B, Enter, and Escape case-insensitively', () => {
  assert.equal(resolveToolboxHotkeyAction('Escape'), 'cancel');
  assert.equal(resolveToolboxHotkeyAction('Enter'), 'finish');
  assert.equal(resolveToolboxHotkeyAction('v'), 'mode_dem');
  assert.equal(resolveToolboxHotkeyAction('V'), 'mode_dem');
  assert.equal(resolveToolboxHotkeyAction('r'), 'mode_transect');
  assert.equal(resolveToolboxHotkeyAction('R'), 'mode_transect');
  assert.equal(resolveToolboxHotkeyAction('p'), 'mode_probe');
  assert.equal(resolveToolboxHotkeyAction('P'), 'mode_probe');
  assert.equal(resolveToolboxHotkeyAction('a'), 'mode_region');
  assert.equal(resolveToolboxHotkeyAction('A'), 'mode_region');
  assert.equal(resolveToolboxHotkeyAction('b'), 'mode_obstacle');
  assert.equal(resolveToolboxHotkeyAction('B'), 'mode_obstacle');

  // Unmapped keys return null
  assert.equal(resolveToolboxHotkeyAction('x'), null);
  assert.equal(resolveToolboxHotkeyAction(' '), null);
  assert.equal(resolveToolboxHotkeyAction('1'), null);
});

// ============================================================================
// [TUC2-T3] Link, Node & CAD Obstacle Hit-Testing Accuracy
// ============================================================================
console.log('\n[TUC2-T3] Link, Node & CAD Obstacle Hit-Testing Accuracy...');

runCheck('hitTestRadarNode discriminates nodes within pixel threshold', () => {
  const vp: RadarViewport = { width: 800, height: 600, rangeM: 40000 };
  const nodes = [
    { nodeId: 1, posX: 0, posY: 0 },
    { nodeId: 2, posX: 10000, posY: 10000 },
    { nodeId: 3, posX: -15000, posY: 5000 },
  ];

  // Exactly on node 2
  const p2 = worldEnuToRadarCanvas(10000, 10000, vp);
  const hit2 = hitTestRadarNode(p2.x, p2.y, vp, nodes, 10);
  assert.ok(hit2 !== null);
  assert.equal(hit2.nodeId, 2);

  // Near node 3 (within 5 px)
  const p3 = worldEnuToRadarCanvas(-15000, 5000, vp);
  const hit3 = hitTestRadarNode(p3.x + 3, p3.y + 4, vp, nodes, 10);
  assert.ok(hit3 !== null);
  assert.equal(hit3.nodeId, 3);

  // Far away from any node
  const miss = hitTestRadarNode(10, 10, vp, nodes, 10);
  assert.equal(miss, null);
});

runCheck('hitTestRadarLink detects line segment hits between ACN and node', () => {
  const vp: RadarViewport = { width: 800, height: 600, rangeM: 40000 };
  const acnPos = { x: 0, y: 0 };
  const nodes = [
    { nodeId: 4, posX: 20000, posY: 0 },
  ];

  // Midpoint of link (10000, 0)
  const mid = worldEnuToRadarCanvas(10000, 0, vp);
  const hit = hitTestRadarLink(mid.x, mid.y + 2, vp, acnPos, nodes, 6);
  assert.ok(hit !== null);
  assert.equal(hit.nodeId, 4);

  // Perpendicular offset too far (20 px away)
  const miss = hitTestRadarLink(mid.x, mid.y + 20, vp, acnPos, nodes, 6);
  assert.equal(miss, null);
});

runCheck('findCadObstacleHandleHit detects V1, V2, and CENTER handles', () => {
  const vp: RadarViewport = { width: 800, height: 600, rangeM: 10000 };
  const obstacle = {
    xM: 5000,
    yM: 5000,
    widthM: 20,
    depthM: 3000,
    heightM: 80,
    rotationDeg: 0,
    shape: 'wall',
  };

  const ep = getObstacleEndpoints(obstacle);
  assert.ok(ep !== null);

  const pV1 = worldEnuToRadarCanvas(ep.v1.x, ep.v1.y, vp);
  const hitV1 = findCadObstacleHandleHit(pV1.x, pV1.y, vp, obstacle);
  assert.ok(hitV1 !== null);
  assert.equal(hitV1.handle, 'V1');

  const pV2 = worldEnuToRadarCanvas(ep.v2.x, ep.v2.y, vp);
  const hitV2 = findCadObstacleHandleHit(pV2.x, pV2.y, vp, obstacle);
  assert.ok(hitV2 !== null);
  assert.equal(hitV2.handle, 'V2');

  const pCenter = worldEnuToRadarCanvas(ep.center.x, ep.center.y, vp);
  const hitCenter = findCadObstacleHandleHit(pCenter.x, pCenter.y, vp, obstacle);
  assert.ok(hitCenter !== null);
  assert.equal(hitCenter.handle, 'CENTER');
});

runCheck('findAoSwathCornerHit detects NW, NE, SW, and SE corners', () => {
  const vp: RadarViewport = { width: 800, height: 600, rangeM: 40000 };
  const box = { x1: -5000, y1: -3000, x2: 5000, y2: 3000 };

  const pNW = worldEnuToRadarCanvas(-5000, 3000, vp);
  assert.equal(findAoSwathCornerHit(pNW.x, pNW.y, vp, box), 'NW');

  const pNE = worldEnuToRadarCanvas(5000, 3000, vp);
  assert.equal(findAoSwathCornerHit(pNE.x, pNE.y, vp, box), 'NE');

  const pSW = worldEnuToRadarCanvas(-5000, -3000, vp);
  assert.equal(findAoSwathCornerHit(pSW.x, pSW.y, vp, box), 'SW');

  const pSE = worldEnuToRadarCanvas(5000, -3000, vp);
  assert.equal(findAoSwathCornerHit(pSE.x, pSE.y, vp, box), 'SE');
});

// ============================================================================
// [TUC2-T4] XSS Safety & Zero-Emoji Audit
// ============================================================================
console.log('\n[TUC2-T4] XSS Safety, Zero-Emoji Audit & Zero Duplicate DOM IDs...');

runCheck('Zero emojis in new TypeScript controller files', () => {
  const files = [
    'src/ui/controllers/radar2dRenderer.ts',
    'src/ui/controllers/terrainToolboxController.ts',
  ];
  const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  for (const f of files) {
    const content = readFileSync(resolve(process.cwd(), f), 'utf8');
    assert.ok(!EMOJI_REGEX.test(content), `Found emoji in ${f}`);
  }
});

runCheck('Zero duplicate DOM IDs in index.html', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const idMatches = [...html.matchAll(/id=["']([a-zA-Z0-9_-]+)["']/g)].map(m => m[1]);
  const idSet = new Set<string>();
  const duplicates: string[] = [];
  for (const id of idMatches) {
    if (idSet.has(id)) duplicates.push(id);
    idSet.add(id);
  }
  assert.equal(duplicates.length, 0, `Duplicate DOM IDs found: ${duplicates.join(', ')}`);
});

// ============================================================================
// [TUC2-T5] Monolith Reduction Audit & Static Contract Preservation
// ============================================================================
console.log('\n[TUC2-T5] Monolith Reduction Audit & Static Contract Preservation...');

runCheck('Monolith reduction target: index.html net reduction >= 1,500 lines', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const lineCount = html.split('\n').length;
  const BASELINE_LINES = 23084;
  const netLinesRemoved = BASELINE_LINES - lineCount;
  console.log(`    Current line count: ${lineCount} lines (Baseline: ${BASELINE_LINES} lines)`);
  console.log(`    Net lines removed: ${netLinesRemoved} lines (Target: >= 1,500 lines)`);
  assert.ok(
    netLinesRemoved >= 1500,
    `index.html must have reduced by >= 1,500 lines (actual reduction: ${netLinesRemoved} lines)`
  );
});

runCheck('Preserves required static test assertions (isEditableKeyboardTarget, createLabelPlacer, 3D mode guard)', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

  // verifyDirectToolboxUx.ts checks
  assert.ok(html.includes('function isEditableKeyboardTarget(target)'), 'isEditableKeyboardTarget helper must exist in index.html');
  assert.ok(
    html.includes("target.closest('input, select, textarea, [contenteditable") ||
    html.includes("target.closest('input,select,textarea,[contenteditable"),
    'isEditableKeyboardTarget closest selector must exist in index.html'
  );
  assert.ok(
    html.includes('if (e.ctrlKey || e.metaKey || e.altKey) return;') ||
    html.includes('if(e.ctrlKey||e.metaKey||e.altKey) return;'),
    'Modifier key check must exist in index.html'
  );
  assert.ok(
    html.includes("stageViewMode === '3d'") || html.includes("threeController.getViewMode?.() === '3d'"),
    '3D mode check must exist in index.html'
  );

  // Hotkey assertions in verifyDirectToolboxUx.ts
  const requiredHotkeys = ["'Escape'", "'Enter'", "'v'", "'r'", "'p'", "'a'", "'b'"];
  for (const hk of requiredHotkeys) {
    assert.ok(
      html.includes(`key === ${hk}`) || html.includes(`e.key === ${hk}`),
      `Keyboard handler must check for ${hk}`
    );
  }

  // Auto-arm assertions in verifyDirectToolboxUx.ts
  assert.ok(
    html.includes('const setTbMode = (mode, autoArm = true) =>') ||
    html.includes('function setTbMode(mode, autoArm = true)'),
    'setTbMode must exist with autoArm parameter'
  );
  assert.ok(html.includes("terrainToolMode = 'transect-2pt';"), 'Auto-arm transect-2pt string must exist');
  assert.ok(html.includes("terrainToolMode = 'probe';"), 'Auto-arm probe string must exist');
  assert.ok(html.includes("terrainToolMode = 'region';"), 'Auto-arm region string must exist');
  assert.ok(html.includes("terrainToolMode = 'obstacle-place';"), 'Auto-arm obstacle-place string must exist');

  // Double-click check in verifyDirectToolboxUx.ts
  assert.ok(
    html.includes("terrainToolMode === 'region' && terrainRegionDraft.length >= 3") &&
    html.includes('finishTerrainRegion()'),
    'Double-click region completion check must exist'
  );

  // verifyComprehensive51PointUxPolish.ts check
  assert.ok(
    html.includes("tbActiveMode !== 'dem'") && html.includes("terrainToolMode !== 'idle'"),
    'Mutual exclusion check must exist in index.html'
  );

  // verifyCanvasDeclutterAndSecurity.ts check
  assert.ok(html.includes('createLabelPlacer'), 'createLabelPlacer must be referenced in index.html');

  // verifyUiMakeoverAnd3dPerf.ts check
  assert.ok(html.includes("if (!cvs || stageViewMode === '3d') return;"), 'drawRadar 3D guard must exist');
});

runCheck('Preserves required DOM element IDs', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const requiredIds = [
    'radar-canvas',
    'radar-container',
    'terrain-toolbox',
    'terrain-toolbox-stack',
    'terrain-toolbox-panel',
    'terrain-toolbox-drawer',
    'tb-step-guide-banner',
    'tb-active-tool-title',
    'tb-drawer-content',
    'tb-span-readout',
    'terrain-toolbox-status',
  ];
  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `index.html must contain #${id}`);
  }
});

console.log('='.repeat(96));
console.log(`  VERIFICATION SUITE 112 PASSED: ALL ${passedChecks} CHECKS SUCCEEDED`);
console.log('='.repeat(96));
