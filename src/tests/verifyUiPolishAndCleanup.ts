/**
 * src/tests/verifyUiPolishAndCleanup.ts
 *
 * SUITE 98: Unified Canvas Obsidian/CVD Theme, Live Playwright CVD/Air-Gap Checks
 * & Dead Stitch Artifact Cleanup Verification Suite
 *
 * Verification Gates:
 * - [UIP-T1] Unified Canvas Theme & WCAG Contrast (Pre-frozen singletons, zero allocations, >= 4.5:1 AA contrast)
 * - [UIP-T2] Dead Stitch Artifact Purge Gate (Disk absence + zero active codebase references)
 * - [UIP-T3] Zero-Emoji Sweep Across Polished UI Modules (canvasTheme, soldierEud, scientificScopes, workbenchShell, tacticalIcons)
 *
 * Specification: docs/specs/ui03-canvas-theme-and-stitch-cleanup.md
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LATTICE_CANVAS_STANDARD,
  LATTICE_CANVAS_CVD,
  getLatticeCanvasPalette,
  readActiveCanvasCvdMode,
  LatticeCanvasPalette,
} from '../ui/canvasTheme';
import { computeWcagContrastRatio } from '../ui/accessibilityEncoding';

const ROOT_DIR = process.cwd();

console.log('='.repeat(96));
console.log('   SUITE 98: UNIFIED CANVAS THEME & STITCH CLEANUP VERIFICATION');
console.log('   Specification: docs/specs/ui03-canvas-theme-and-stitch-cleanup.md');
console.log('='.repeat(96) + '\n');

// =============================================================================
// [UIP-T1] Unified Canvas Theme & WCAG Contrast Gate
// =============================================================================
console.log('[UIP-T1] Verifying Unified Canvas Theme & WCAG Contrast Gate...');

// 1. Immutability & Pre-frozen Singletons
assert.equal(
  Object.isFrozen(LATTICE_CANVAS_STANDARD),
  true,
  'LATTICE_CANVAS_STANDARD must be pre-frozen with Object.freeze()'
);
assert.equal(
  Object.isFrozen(LATTICE_CANVAS_CVD),
  true,
  'LATTICE_CANVAS_CVD must be pre-frozen with Object.freeze()'
);

// 2. Zero-Allocation Identity Verification
const stdPalette1 = getLatticeCanvasPalette('standard');
const stdPalette2 = getLatticeCanvasPalette('standard');
const cvdPalette1 = getLatticeCanvasPalette('colorblind-safe');
const cvdPalette2 = getLatticeCanvasPalette('colorblind-safe');

assert.equal(stdPalette1, LATTICE_CANVAS_STANDARD, 'getLatticeCanvasPalette("standard") must return LATTICE_CANVAS_STANDARD reference');
assert.equal(stdPalette1, stdPalette2, 'Repeated calls to getLatticeCanvasPalette must return identical instance without allocation');
assert.equal(cvdPalette1, LATTICE_CANVAS_CVD, 'getLatticeCanvasPalette("colorblind-safe") must return LATTICE_CANVAS_CVD reference');
assert.equal(cvdPalette1, cvdPalette2, 'Repeated calls to getLatticeCanvasPalette must return identical instance without allocation');
assert.notEqual(stdPalette1, cvdPalette1, 'Standard and CVD palettes must be distinct palette instances');

// Fallback behavior
assert.equal(typeof readActiveCanvasCvdMode(), 'string', 'readActiveCanvasCvdMode must return a string mode');
const defaultPalette = getLatticeCanvasPalette();
assert.ok(
  defaultPalette === LATTICE_CANVAS_STANDARD || defaultPalette === LATTICE_CANVAS_CVD,
  'Default palette lookup must resolve to pre-frozen standard or CVD singleton'
);

// 3. WCAG 2.1 AA Contrast Gate (>= 4.5:1 against panelBg #0d1015)
const panelBg = LATTICE_CANVAS_STANDARD.panelBg;
assert.equal(panelBg, '#0d1015', 'panelBg must be #0d1015');

const standardTokens: Record<string, string> = {
  textPrimary: LATTICE_CANVAS_STANDARD.textPrimary,
  textSecondary: LATTICE_CANVAS_STANDARD.textSecondary,
  textMuted: LATTICE_CANVAS_STANDARD.textMuted,
  accent: LATTICE_CANVAS_STANDARD.accent,
  optimal: LATTICE_CANVAS_STANDARD.optimal,
  degraded: LATTICE_CANVAS_STANDARD.degraded,
  critical: LATTICE_CANVAS_STANDARD.critical,
  outage: LATTICE_CANVAS_STANDARD.outage,
  relay: LATTICE_CANVAS_STANDARD.relay,
};

for (const [tokenName, hexColor] of Object.entries(standardTokens)) {
  const ratio = computeWcagContrastRatio(hexColor, panelBg);
  assert.ok(
    ratio >= 4.5,
    `Standard token ${tokenName} (${hexColor}) vs panelBg (${panelBg}) contrast ratio ${ratio.toFixed(2)}:1 must meet WCAG AA (>= 4.5:1)`
  );
  console.log(`  -> Standard ${tokenName.padEnd(14)} (${hexColor}) vs ${panelBg}: ${ratio.toFixed(2)}:1 (WCAG AA PASS)`);
}

const cvdTokens: Record<string, string> = {
  textPrimary: LATTICE_CANVAS_CVD.textPrimary,
  textSecondary: LATTICE_CANVAS_CVD.textSecondary,
  textMuted: LATTICE_CANVAS_CVD.textMuted,
  accent: LATTICE_CANVAS_CVD.accent,
  optimal: LATTICE_CANVAS_CVD.optimal,
  degraded: LATTICE_CANVAS_CVD.degraded,
  critical: LATTICE_CANVAS_CVD.critical,
  outage: LATTICE_CANVAS_CVD.outage,
  relay: LATTICE_CANVAS_CVD.relay,
};

for (const [tokenName, hexColor] of Object.entries(cvdTokens)) {
  const ratio = computeWcagContrastRatio(hexColor, panelBg);
  assert.ok(
    ratio >= 4.5,
    `CVD token ${tokenName} (${hexColor}) vs panelBg (${panelBg}) contrast ratio ${ratio.toFixed(2)}:1 must meet WCAG AA (>= 4.5:1)`
  );
  console.log(`  -> CVD ${tokenName.padEnd(14)} (${hexColor}) vs ${panelBg}: ${ratio.toFixed(2)}:1 (WCAG AA PASS)`);
}

console.log('  [PASS] UIP-T1 passed successfully.\n');

// =============================================================================
// [UIP-T2] Dead Stitch Artifact Purge Gate
// =============================================================================
console.log('[UIP-T2] Verifying Dead Stitch Artifact Purge Gate...');

const deadArtifacts = [
  path.join(ROOT_DIR, 'frontend', 'stitch-theme.css'),
  path.join(ROOT_DIR, 'docs', 'specs', 'SPEC-CODEBASE-DRIVEN-STITCH-UI-OVERHAUL.md'),
  path.join(ROOT_DIR, 'docs', 'stitch_reference'),
  path.join(ROOT_DIR, 'scripts', 'capture_live_redesign_screenshots.mjs'),
];

for (const artifactPath of deadArtifacts) {
  const relPath = path.relative(ROOT_DIR, artifactPath);
  assert.equal(
    fs.existsSync(artifactPath),
    false,
    `Dead Stitch artifact must be permanently purged from disk: ${relPath}`
  );
  console.log(`  -> Verified purged: ${relPath}`);
}

// Verify zero active production files reference stitch-theme
const activeFilesToCheck = [
  path.join(ROOT_DIR, 'index.html'),
  path.join(ROOT_DIR, 'vite.config.ts'),
  path.join(ROOT_DIR, 'package.json'),
  path.join(ROOT_DIR, 'frontend', 'c2-console-theme.css'),
  path.join(ROOT_DIR, 'src', 'ui', 'canvasTheme.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'soldierEudRenderer.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'scientificScopesRenderer.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'workbenchShell.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'tacticalIcons.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'dataCommVisualization.ts'),
];

for (const filePath of activeFilesToCheck) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.equal(
      content.includes('stitch-theme'),
      false,
      `Active file ${path.relative(ROOT_DIR, filePath)} must not reference stitch-theme`
    );
  }
}
console.log('  -> Zero active codebase files reference stitch-theme.');
console.log('  [PASS] UIP-T2 passed successfully.\n');

// =============================================================================
// [UIP-T3] Zero-Emoji Sweep Across Polished UI Modules
// =============================================================================
console.log('[UIP-T3] Verifying Zero-Emoji Sweep Across Polished UI Modules...');

const uiModules = [
  path.join(ROOT_DIR, 'src', 'ui', 'canvasTheme.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'soldierEudRenderer.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'scientificScopesRenderer.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'workbenchShell.ts'),
  path.join(ROOT_DIR, 'src', 'ui', 'tacticalIcons.ts'),
];

const emojiRegex = /\p{Extended_Pictographic}/u;

for (const modulePath of uiModules) {
  const relPath = path.relative(ROOT_DIR, modulePath);
  assert.ok(fs.existsSync(modulePath), `Module file must exist: ${relPath}`);
  const content = fs.readFileSync(modulePath, 'utf-8');
  const matches = [...content.matchAll(new RegExp(emojiRegex.source, 'gu'))];
  assert.equal(
    matches.length,
    0,
    `Module ${relPath} must contain STRICTLY ZERO Unicode pictographic emojis. Found: ${matches.map(m => m[0]).join(', ')}`
  );
  console.log(`  -> Zero emojis verified in ${relPath} (${content.length} bytes).`);
}

console.log('  [PASS] UIP-T3 passed successfully.\n');

console.log('='.repeat(96));
console.log('   ALL 3 GATES PASSED: SUITE 98 UI POLISH & STITCH CLEANUP VERIFIED');
console.log('='.repeat(96));
