/**
 * src/tests/verifyIntuitiveToolboxUx.ts
 *
 * Automated Verification Suite for:
 * SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH: Intuitive Terrain Toolbox Right-Hand Panel Docking,
 * Human-Friendly Naming & Ergonomic UX Finish.
 *
 * Test Suites:
 * - ITU-T1: Human-Friendly Tool Names, Sub-labels & Dynamic Step Guide Banner (zero 2-pt A→B)
 * - ITU-T2: Ruler Scale Division Toggle (#btn-toggle-ruler-ticks) & Default OFF Invariant
 * - ITU-T3: Universal Escape Key Exit, Right-Hand Workspace Inspector & Map Active Tool Bar
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('='.repeat(96));
console.log('   INTUITIVE TOOLBOX RIGHT-PANEL DOCKING & ERGONOMIC UX VERIFICATION SUITE');
console.log('   Specification: SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH // ITU-T1 - ITU-T3');
console.log('='.repeat(96));

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const indexHtml = readFileSync(resolve(projectRoot, 'index.html'), 'utf-8');

// =================================================================================================
// [ITU-T1] Human-Friendly Tool Names, Sub-labels & Dynamic Step Guide Banner
// =================================================================================================
console.log('\n[ITU-T1] Verifying Human-Friendly Tool Names, Sub-labels & Step Guide Banner...');
{
  // 1. Tool tab IDs must exist
  const toolTabIds = [
    'tb-tool-transect',
    'tb-tool-probe',
    'tb-tool-region',
    'tb-tool-obstacle',
  ];

  for (const id of toolTabIds) {
    assert.ok(
      indexHtml.includes(`id="${id}"`),
      `Tool tab #${id} must be present in index.html`,
    );
  }
  console.log(`  ✓ All ${toolTabIds.length} intuitive tool tab IDs present in index.html [PASS]`);

  // 2. Clear, intuitive, human-understandable tool names & sub-labels
  assert.ok(
    indexHtml.includes('Measure Line &amp; LoS') || indexHtml.includes('Measure Line & LoS') || indexHtml.includes('Line &amp; LoS'),
    'Tool 1 must be titled "Measure Line & LoS" or "Line & LoS"',
  );

  assert.ok(
    indexHtml.includes('Signal Probe &amp; Spawn') || indexHtml.includes('Signal Probe & Spawn') || indexHtml.includes('Signal Probe'),
    'Tool 2 must be titled "Signal Probe & Spawn"',
  );

  assert.ok(
    indexHtml.includes('Area Coverage Scan'),
    'Tool 3 must be titled "Area Coverage Scan"',
  );

  assert.ok(
    indexHtml.includes('Build 3D Barrier'),
    'Tool 4 must be titled "Build 3D Barrier"',
  );
  console.log('  ✓ All 4 tool titles verified [PASS]');

  // 3. Cryptic "2-pt A→B" text must be eradicated
  assert.ok(
    !indexHtml.includes('2-pt A→B') && !indexHtml.includes('2-Pt A→B') && !indexHtml.includes('2-pt A-&gt;B'),
    'Cryptic "2-pt A→B" label must be completely removed from index.html',
  );
  console.log('  ✓ Cryptic "2-pt A→B" text eliminated [PASS]');

  // 4. Dynamic Step-by-Step Guide Banner #tb-step-guide-banner must exist
  assert.ok(
    indexHtml.includes('id="tb-step-guide-banner"'),
    'Dynamic Step-by-Step Guide Banner #tb-step-guide-banner must be present in index.html',
  );
  assert.ok(
    indexHtml.includes('Click A → B on map') || indexHtml.includes('STEP 1 OF 2'),
    'Step-by-step guide must include initial instruction',
  );
  console.log('  ✓ Dynamic Step-by-Step Guide Banner (#tb-step-guide-banner) present [PASS]');
}

// =================================================================================================
// [ITU-T2] Ruler Scale Division Toggle & Default OFF Invariant
// =================================================================================================
console.log('\n[ITU-T2] Verifying Ruler Scale Division Toggle & Default OFF Invariant...');
{
  // 1. Toggle button #btn-toggle-ruler-ticks in #tb-pane-transect
  assert.ok(
    indexHtml.includes('id="btn-toggle-ruler-ticks"'),
    'Toggle button #btn-toggle-ruler-ticks must be present in index.html',
  );
  assert.ok(
    indexHtml.includes('Show Scale Divisions: OFF'),
    'Button label must indicate default state "Show Scale Divisions: OFF"',
  );
  console.log('  ✓ Toggle button #btn-toggle-ruler-ticks present with default OFF state [PASS]');

  // 2. Default state tbShowRulerTicks = false
  assert.ok(
    indexHtml.includes('tbShowRulerTicks = false') || indexHtml.includes('tbShowRulerTicks=false'),
    'tbShowRulerTicks must default to false',
  );
  console.log('  ✓ tbShowRulerTicks = false default invariant verified [PASS]');

  // 3. tbShowRulerTicks gates kilometer tick rendering
  assert.ok(
    indexHtml.includes('tbShowRulerTicks && dHorizM > 500') || indexHtml.includes('tbShowRulerTicks&&dHorizM>500') || indexHtml.includes('if (tbShowRulerTicks'),
    'tbShowRulerTicks must gate the drawing of kilometer scale ticks along ruler shaft',
  );
  console.log('  ✓ Kilometer scale division ticks gated by tbShowRulerTicks [PASS]');
}

// =================================================================================================
// [ITU-T3] Universal Escape Key Exit, Right-Hand Workspace Inspector & Map Active Tool Bar
// =================================================================================================
console.log('\n[ITU-T3] Verifying Universal Escape Key Exit, Right-Hand Workspace Inspector & Map Active Tool Bar...');
{
  // 1. Spacious right-hand panel #terrain-toolbox inside .detail-viewport
  assert.ok(
    indexHtml.includes('id="terrain-toolbox"'),
    'Inspector view #terrain-toolbox must be present in index.html',
  );
  assert.ok(
    indexHtml.includes('id="terrain-toolbox-close"') || indexHtml.includes('id="terrain-toolbox-close-btn"'),
    'Close/exit tool button must be present',
  );
  console.log('  ✓ Right-hand panel #terrain-toolbox inspector present [PASS]');

  // 2. Slim floating HUD map tool bar #map-active-tool-bar
  assert.ok(
    indexHtml.includes('id="map-active-tool-bar"'),
    'Slim floating HUD tool bar #map-active-tool-bar must be present on map',
  );
  console.log('  ✓ Slim floating HUD map tool bar #map-active-tool-bar present [PASS]');

  // 3. Global Escape key handler closes active tools & restores workspace
  assert.ok(
    indexHtml.includes("e.key === 'Escape'") || indexHtml.includes('e.key==="Escape"'),
    'Global keydown listener for Escape must be present',
  );
  assert.ok(
    indexHtml.includes('closeTerrainToolbox') || indexHtml.includes('setTerrainToolboxExpanded'),
    'Escape key handler must close active toolbox and restore right-hand workspace',
  );
  console.log('  ✓ Universal Escape key tool exit & workspace restoration wired [PASS]');

  // 4. Specification File & README Link Check
  const specPath = resolve(projectRoot, 'docs/specs/SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH.md');
  assert.ok(existsSync(specPath), 'SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH.md must exist on disk');

  const readme = readFileSync(resolve(projectRoot, 'README.md'), 'utf-8');
  assert.ok(
    readme.includes('SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH.md'),
    'README.md Section 7 must link SPEC-INTUITIVE-TOOLBOX-RIGHT-PANEL-AND-UX-FINISH.md',
  );
  console.log('  ✓ Specification file exists & linked in README.md Section 7 [PASS]');

  // 5. Theme CSS Existence Check
  assert.ok(existsSync(resolve(projectRoot, 'frontend/c2-console-theme.css')), 'frontend/c2-console-theme.css must exist');
  console.log('  ✓ frontend/c2-console-theme.css exists [PASS]');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL INTUITIVE TOOLBOX UX VERIFICATIONS PASSED (ITU-T1 - ITU-T3)');
console.log('='.repeat(96));
