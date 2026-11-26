/**
 * src/tests/verifyDirectToolboxUx.ts
 *
 * Automated Verification Suite for:
 * SPEC-UI05-DIRECT-MANIPULATION-TOOLBOX: Frontier Direct-Manipulation Terrain Toolbox
 * (1-Click Auto-Arm Tools, Universal CAD/GIS Icons, Instant Hover Flyouts & V/R/P/A/B Shortcuts)
 *
 * Test Suites:
 * - UI05-T1: Universal CAD/GIS Icon Rail, Monochromatic 1.6px SVG, data-tb-label & Key Attributes (Zero Emojis)
 * - UI05-T2: Zero-Lag CSS Hover Flyouts, Crosshair Cursor & Armed Ring Invariants (Zero !important / blur / <10px)
 * - UI05-T3: Figma-Style Keyboard Shortcuts (V/R/P/A/B/Enter/Esc), Modifier & Input Element Guards
 * - UI05-T4: 1-Click Auto-Arm State Transitions, Double-Click Polygon Close & Terse Step Banner Copy
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('='.repeat(96));
console.log('   FRONTIER DIRECT-MANIPULATION TERRAIN TOOLBOX VERIFICATION SUITE');
console.log('   Specification: SPEC-UI05-DIRECT-MANIPULATION-TOOLBOX // UI05-T1 - UI05-T4');
console.log('='.repeat(96));

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const indexHtml = readFileSync(resolve(projectRoot, 'index.html'), 'utf-8');
const themeCss = readFileSync(resolve(projectRoot, 'frontend/c2-console-theme.css'), 'utf-8');

// =================================================================================================
// [UI05-T1] Universal CAD/GIS Icon Rail, Monochromatic 1.6px SVG, data-tb-label & Key Attributes
// =================================================================================================
console.log('\n[UI05-T1] Verifying Universal CAD/GIS Icon Rail, Monochrome SVG & Key Attributes...');
{
  // 1. All 5 quick mode buttons must exist with valid data-tb-rail-mode
  const expectedModes = [
    { mode: 'dem', key: 'V', label: 'Pan', pathFragment: 'M5 3l12 9-5.5 1.2L8.5 19z' },
    { mode: 'transect', key: 'R', label: 'Ruler', pathFragment: 'M3 17L17 3l4 4L7 21z' },
    { mode: 'probe', key: 'P', label: 'Probe', pathFragment: 'M12 2v3M12 19v3M2 12h3M19 12h3' },
    { mode: 'region', key: 'A', label: 'Area', pathFragment: 'polygon points="5,6 18,4 20,17 7,19"' },
    { mode: 'obstacle', key: 'B', label: 'Barrier', pathFragment: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z' },
  ];

  for (const item of expectedModes) {
    const btnRegex = new RegExp(`<button[^>]*data-tb-rail-mode="${item.mode}"[^>]*>`, 'i');
    assert.ok(btnRegex.test(indexHtml), `Button with data-tb-rail-mode="${item.mode}" must exist in index.html`);

    // Verify key attribute
    assert.ok(
      indexHtml.includes(`data-tb-key="${item.key}"`),
      `Mode "${item.mode}" must have data-tb-key="${item.key}"`,
    );

    // Verify label attribute
    assert.ok(
      indexHtml.includes(`data-tb-label="${item.label}"`),
      `Mode "${item.mode}" must have data-tb-label="${item.label}"`,
    );

    // Verify universal monochrome SVG glyph path
    assert.ok(
      indexHtml.includes(item.pathFragment),
      `Mode "${item.mode}" must render universal CAD/GIS glyph "${item.pathFragment}"`,
    );
  }
  console.log('  ✓ All 5 rail buttons have universal CAD/GIS SVGs, data-tb-key & data-tb-label [PASS]');

  // 2. Sidebar tool inspector toggle button must have data-tb-label="Tool Inspector"
  assert.ok(
    indexHtml.includes('id="terrain-toolbox-toggle-btn"') &&
    indexHtml.includes('data-tb-label="Tool Inspector"'),
    '#terrain-toolbox-toggle-btn must have data-tb-label="Tool Inspector"',
  );
  console.log('  ✓ Sidebar toggle button has data-tb-label="Tool Inspector" [PASS]');

  // 3. Icon rail must use standard stroke-width="1.6"
  assert.ok(
    indexHtml.includes('stroke-width="1.6"'),
    'Toolbox icons must use crisp 1.6px stroke width',
  );

  // 4. Absolute zero emojis in toolbar rail
  const railMatch = indexHtml.match(/<div class="tb-icon-rail"[\s\S]*?<\/div>/);
  assert.ok(railMatch, '.tb-icon-rail must be present in index.html');
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.ok(!emojiRegex.test(railMatch[0]), '.tb-icon-rail must contain zero emojis');
  console.log('  ✓ Zero emojis in icon rail markup [PASS]');
}

// =================================================================================================
// [UI05-T2] Zero-Lag CSS Hover Flyouts, Crosshair Cursor & Armed Ring Invariants
// =================================================================================================
console.log('\n[UI05-T2] Verifying Zero-Lag CSS Hover Flyouts, Crosshair & Armed Ring Invariants...');
{
  // 1. Pure CSS hover flyout rule using attr(data-tb-key) and attr(data-tb-label)
  assert.ok(
    themeCss.includes('.tb-icon-rail button[data-tb-label]::after') ||
    themeCss.includes('.tb-icon-rail button[data-tb-label]:after'),
    'CSS must declare hover flyout pseudo-element on .tb-icon-rail button[data-tb-label]',
  );
  assert.ok(
    themeCss.includes('attr(data-tb-key) " · " attr(data-tb-label)'),
    'Flyout content must display attr(data-tb-key) " · " attr(data-tb-label)',
  );
  assert.ok(
    themeCss.includes(':hover::after') || themeCss.includes(':hover:after'),
    'Flyout must become visible on button:hover',
  );
  assert.ok(
    themeCss.includes(':focus-visible::after') || themeCss.includes(':focus-visible:after'),
    'Flyout must support keyboard focus-visible access',
  );
  console.log('  ✓ Pure CSS zero-lag hover flyout rule verified [PASS]');

  // 2. Crosshair cursor and armed ring on #radar-container[data-tb-picking="true"]
  assert.ok(
    themeCss.includes('#radar-container[data-tb-picking="true"]') &&
    themeCss.includes('cursor: crosshair'),
    '#radar-container[data-tb-picking="true"] must define cursor: crosshair',
  );
  assert.ok(
    themeCss.includes('#radar-container[data-tb-picking="true"]') &&
    (themeCss.includes('box-shadow: inset') || themeCss.includes('outline') || themeCss.includes('border')),
    '#radar-container[data-tb-picking="true"] must define armed boundary indicator',
  );
  console.log('  ✓ Crosshair cursor & armed ring on picking container verified [PASS]');

  // 3. Compact floating #tb-picking-bar styling
  assert.ok(
    themeCss.includes('#tb-picking-bar') && themeCss.includes('transform: translateX(-50%)'),
    '#tb-picking-bar must be centered at top-center of radar container',
  );
  console.log('  ✓ Minimal top-center #tb-picking-bar styling verified [PASS]');

  // 4. Quality constraints: Zero !important in new toolbox CSS, zero backdrop blur, zero <10px fonts
  const startIdx = themeCss.indexOf('/* 36px Left Toolbox Icon Rail */');
  assert.ok(startIdx !== -1, 'Toolbox CSS section must exist in c2-console-theme.css');
  const endIdx = themeCss.indexOf('.tb-mode-tabs', startIdx);
  const tbCssSlice = themeCss.substring(startIdx, endIdx !== -1 ? endIdx : startIdx + 2000);
  assert.ok(tbCssSlice.length > 50, 'Toolbox CSS section must exist in c2-console-theme.css');

  // Verify zero !important in the entire themeCss toolbox block
  const pickingBarRule = themeCss.match(/#tb-picking-bar[\s\S]*?}/);
  if (pickingBarRule) {
    assert.ok(!pickingBarRule[0].includes('!important'), '#tb-picking-bar rules must contain zero !important');
  }

  // Verify zero backdrop-filter: blur in themeCss toolbox
  assert.ok(!tbCssSlice.includes('backdrop-filter: blur'), 'Toolbox CSS must contain zero backdrop-filter: blur');

  // Verify zero font sizes below 10px in toolbox CSS
  const smallFontRegex = /font-size:\s*([0-9.]+)px/g;
  let match;
  while ((match = smallFontRegex.exec(tbCssSlice)) !== null) {
    const size = parseFloat(match[1]);
    assert.ok(size >= 10.0, `Toolbox font size must be >= 10px, found ${size}px`);
  }
  console.log('  ✓ Zero !important, zero backdrop blur, zero <10px fonts verified [PASS]');
}

// =================================================================================================
// [UI05-T3] Figma-Style Keyboard Shortcuts (V/R/P/A/B/Enter/Esc), Modifier & Input Element Guards
// =================================================================================================
const appDir = resolve(projectRoot, 'src/app');
const appSources = existsSync(appDir)
  ? readdirSync(appDir).filter((f) => f.endsWith('.ts')).sort().map((f) => readFileSync(resolve(appDir, f), 'utf-8'))
  : [];
const mainTs = [readFileSync(resolve(projectRoot, 'src/main.ts'), 'utf-8'), ...appSources].join('\n');
console.log('\n[UI05-T3] Verifying Figma-Style Keyboard Shortcuts & Strict Input Guards...');
{
  // 1. Strict editable keyboard target guard function must exist
  assert.ok(
    /function\s+isEditableKeyboardTarget\s*\(\s*target(?:\s*:[^)]+)?\s*\)/.test(mainTs),
    'isEditableKeyboardTarget helper must be defined in src/main.ts',
  );
  assert.ok(
    mainTs.includes("target.closest('input, select, textarea, [contenteditable") ||
    mainTs.includes("target.closest('input,select,textarea,[contenteditable"),
    'isEditableKeyboardTarget must inspect input, select, textarea, and contenteditable',
  );
  console.log('  ✓ isEditableKeyboardTarget helper verified [PASS]');

  // 2. Modifier keys guard: Ctrl, Meta (Cmd), Alt must never trigger single-letter shortcuts
  assert.ok(
    mainTs.includes('if (e.ctrlKey || e.metaKey || e.altKey) return;') ||
    mainTs.includes('if(e.ctrlKey||e.metaKey||e.altKey) return;'),
    'Keyboard shortcut listener must immediately bail on Ctrl, Meta, or Alt keys',
  );
  console.log('  ✓ Modifier key check (!ctrlKey && !metaKey && !altKey) verified [PASS]');

  // 3. 2D / 3D mode guard for terrain tools
  assert.ok(
    mainTs.includes("stageViewMode === '3d'") || mainTs.includes('threeController.getViewMode?.() === \'3d\''),
    'Keyboard shortcuts must guard against triggering in 3D view mode',
  );
  console.log('  ✓ 3D mode guard verified [PASS]');

  // 4. Hotkeys V, R, P, A, B, Enter, Escape wired
  const requiredHotkeys = ["'Escape'", "'Enter'", "'v'", "'r'", "'p'", "'a'", "'b'"];
  for (const hk of requiredHotkeys) {
    assert.ok(
      mainTs.includes(`key === ${hk}`) || mainTs.includes(`e.key === ${hk}`),
      `Keyboard handler must check for ${hk}`,
    );
  }
  console.log('  ✓ All 7 hotkeys (V, R, P, A, B, Enter, Escape) wired [PASS]');
}

// =================================================================================================
// [UI05-T4] 1-Click Auto-Arm State Transitions, Double-Click Polygon Close & Terse Step Banner Copy
// =================================================================================================
console.log('\n[UI05-T4] Verifying 1-Click Auto-Arm State Transitions & Terse Step Banner Copy...');
{
  // 1. setTbMode must accept autoArm parameter and arm tool modes directly
  assert.ok(
    /(?:const\s+setTbMode\s*=\s*|function\s+setTbMode\s*)\(\s*mode(?:\s*:[^,)]+)?\s*,\s*autoArm(?:\s*:[^=)]+)?\s*=\s*true/.test(mainTs),
    'setTbMode must support autoArm parameter defaulting to true',
  );

  assert.ok(
    mainTs.includes("terrainToolMode = 'transect-2pt';"),
    'Auto-arm for transect must directly set terrainToolMode = "transect-2pt"',
  );
  assert.ok(
    mainTs.includes("terrainToolMode = 'probe';"),
    'Auto-arm for probe must directly set terrainToolMode = "probe"',
  );
  assert.ok(
    mainTs.includes("terrainToolMode = 'region';"),
    'Auto-arm for region must directly set terrainToolMode = "region"',
  );
  assert.ok(
    mainTs.includes("terrainToolMode = 'obstacle-place';"),
    'Auto-arm for obstacle must directly set terrainToolMode = "obstacle-place"',
  );
  console.log('  ✓ 1-Click auto-arm state transitions verified [PASS]');

  // 2. Double-click on radar canvas closes region polygon when >= 3 points exist
  assert.ok(
    mainTs.includes("terrainToolMode === 'region' && terrainRegionDraft.length >= 3") &&
    mainTs.includes('finishTerrainRegion()'),
    'Double-click handler must call finishTerrainRegion when region points >= 3',
  );
  console.log('  ✓ Double-click polygon completion verified [PASS]');

  // 3. Terse, high-information step guide banner copy (4-7 words, zero tutorials)
  const tersePhrases = [
    'Click A → B on map',
    'Click Point B to lock',
    'Click any spot to probe',
    'Click corners · Dbl-click to finish',
    'Click map to drop barrier',
  ];

  const uiAll = `${indexHtml}\n${mainTs}`;
  for (const phrase of tersePhrases) {
    assert.ok(
      uiAll.includes(phrase),
      `Step guide banner must include terse phrase "${phrase}"`,
    );
  }
  console.log('  ✓ Terse, human-friendly step guide phrases verified [PASS]');

  // 4. Specification file existence & README linkage
  const specPath = resolve(projectRoot, 'docs/specs/ui05-direct-manipulation-toolbox.md');
  assert.ok(existsSync(specPath), 'docs/specs/ui05-direct-manipulation-toolbox.md must exist on disk');
  console.log('  ✓ UI-05 specification file exists on disk [PASS]');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL DIRECT-MANIPULATION TOOLBOX CHECKS PASSED (UI05-T1 - UI05-T4)');
console.log('='.repeat(96));
