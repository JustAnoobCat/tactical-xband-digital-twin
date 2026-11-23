/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Suite 97: Workbench Cutover, Stitch Removal & Zero-Emoji Purge Verification (WKC-T1–T3)
 * Specification: docs/specs/ui02-lattice-obsidian-cutover.md
 *
 * Verification Gates:
 * - WKC-T1: Static Zero-Emoji, Zero-CDN, and Obsidian CSS Hygiene Gate
 * - WKC-T2: Forensic DOM Contract Integrity & Zero Duplicate ID Gate (273 IDs Preserved)
 * - WKC-T3: Pure Logic Unit Gate (workbenchShell + soldierEudRenderer 6-state matrix)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isEditableKeyboardTarget,
  normalizeCvdMode,
  hydrateTacticalIcons,
} from '../ui/workbenchShell';
import {
  resolveSoldierAiNotificationBanner,
  SoldierTelemetryContext,
} from '../ui/soldierEudRenderer';

console.log('='.repeat(96));
console.log('   SUITE 97: WORKBENCH CUTOVER, STITCH REMOVAL & ZERO-EMOJI PURGE VERIFICATION');
console.log('   Specification: docs/specs/ui02-lattice-obsidian-cutover.md');
console.log('='.repeat(96));

const ROOT_DIR = process.cwd();
const C2_CSS_PATH = path.join(ROOT_DIR, 'frontend', 'c2-console-theme.css');
const OBSIDIAN_CSS_PATH = path.join(ROOT_DIR, 'frontend', 'tactical-obsidian.css');
const WORKBENCH_PATH = path.join(ROOT_DIR, 'src', 'ui', 'workbenchShell.ts');
const SOLDIER_PATH = path.join(ROOT_DIR, 'src', 'ui', 'soldierEudRenderer.ts');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const SPEC_UI01_PATH = path.join(ROOT_DIR, 'docs', 'specs', 'ui01-tactical-workbench-architecture.md');

// =================================================================================================
// [WKC-T1] Static Zero-Emoji, Zero-CDN, and Obsidian CSS Hygiene Gate
// =================================================================================================
console.log('\n[WKC-T1] Verifying Static Zero-Emoji, Zero-CDN, and Obsidian CSS Hygiene Gate...');

assert.equal(fs.existsSync(C2_CSS_PATH), true, `c2-console-theme.css must exist at ${C2_CSS_PATH}`);
assert.equal(fs.existsSync(OBSIDIAN_CSS_PATH), true, `tactical-obsidian.css must exist at ${OBSIDIAN_CSS_PATH}`);
assert.equal(fs.existsSync(WORKBENCH_PATH), true, `workbenchShell.ts must exist at ${WORKBENCH_PATH}`);
assert.equal(fs.existsSync(SOLDIER_PATH), true, `soldierEudRenderer.ts must exist at ${SOLDIER_PATH}`);
assert.equal(fs.existsSync(INDEX_HTML_PATH), true, `index.html must exist at ${INDEX_HTML_PATH}`);

const c2CssContent = fs.readFileSync(C2_CSS_PATH, 'utf-8');
const obsidianCssContent = fs.readFileSync(OBSIDIAN_CSS_PATH, 'utf-8');
const workbenchCode = fs.readFileSync(WORKBENCH_PATH, 'utf-8');
const soldierCode = fs.readFileSync(SOLDIER_PATH, 'utf-8');
const indexHtmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');

const unicodeEmojiRegex = /\p{Extended_Pictographic}/u;

// 1. Emoji assertions across core files
assert.equal(
  unicodeEmojiRegex.test(c2CssContent),
  false,
  'frontend/c2-console-theme.css must contain STRICTLY ZERO Unicode emojis or pictographs'
);
assert.equal(
  unicodeEmojiRegex.test(obsidianCssContent),
  false,
  'frontend/tactical-obsidian.css must contain STRICTLY ZERO Unicode emojis or pictographs'
);
assert.equal(
  unicodeEmojiRegex.test(workbenchCode),
  false,
  'src/ui/workbenchShell.ts must contain STRICTLY ZERO Unicode emojis or pictographs'
);
assert.equal(
  unicodeEmojiRegex.test(soldierCode),
  false,
  'src/ui/soldierEudRenderer.ts must contain STRICTLY ZERO Unicode emojis or pictographs'
);

// In index.html, verify 0 true emojis (exempting standard typographical arrows, math and copyright: ⬇, ↔, ↗, ↘, ↕, ↩, ©, ⌊, ⌋)
const strippedHtml = indexHtmlContent.replace(/[⬇↔↗↘↕↩©⌊⌋▲▼·]/g, '');
const htmlEmojiMatches = [...strippedHtml.matchAll(/\p{Extended_Pictographic}/gu)];
assert.equal(
  htmlEmojiMatches.length,
  0,
  `index.html must contain STRICTLY ZERO true emojis. Found: ${htmlEmojiMatches.map(m => m[0]).join(', ')}`
);

// 2. Zero external CDN references in index.html
const forbiddenCdnTokens = [
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'material-symbols',
  'stitch-theme.css',
];
for (const token of forbiddenCdnTokens) {
  assert.equal(
    indexHtmlContent.includes(token),
    false,
    `index.html must not contain obsolete CDN or Stitch reference: "${token}"`
  );
}

// 3. CSS Hygiene: 0 !important and 0 backdrop-filter: blur in rules (comments stripped)
const c2CssRulesOnly = c2CssContent.replace(/\/\*[\s\S]*?\*\//g, '');
const importantMatches = c2CssRulesOnly.match(/!important/g);
assert.equal(
  importantMatches,
  null,
  `frontend/c2-console-theme.css must contain STRICTLY ZERO !important declarations. Found: ${importantMatches?.length}`
);

const hasBlur = /backdrop-filter\s*:[^;]*blur/i.test(c2CssRulesOnly);
assert.equal(
  hasBlur,
  false,
  'frontend/c2-console-theme.css must contain STRICTLY ZERO backdrop-filter: blur rules'
);

console.log('  -> Zero emojis verified across CSS, TS components, and index.html.');
console.log('  -> Zero external CDN or Stitch references verified in index.html.');
console.log('  -> Zero !important and zero backdrop-filter: blur verified in c2-console-theme.css.');
console.log('  [PASS] WKC-T1 passed successfully.');

// =================================================================================================
// [WKC-T2] Forensic DOM Contract Integrity & Zero Duplicate ID Gate
// =================================================================================================
console.log('\n[WKC-T2] Verifying Forensic DOM Contract Integrity & Zero Duplicate ID Gate...');

// Extract all DOM IDs from index.html (ensure we do not match data-*-id attributes)
const idRegex = /(?<![\w-])id=["']([^"']+)["']/g;
const allIds: string[] = [];
let match: RegExpExecArray | null;
while ((match = idRegex.exec(indexHtmlContent)) !== null) {
  allIds.push(match[1]);
}

// Assert zero duplicate DOM IDs
const seenIds = new Set<string>();
const duplicateIds: string[] = [];
for (const id of allIds) {
  if (seenIds.has(id)) {
    duplicateIds.push(id);
  }
  seenIds.add(id);
}
assert.deepEqual(
  duplicateIds,
  [],
  `index.html must contain STRICTLY ZERO duplicate DOM IDs. Found duplicates: ${duplicateIds.join(', ')}`
);

// Assert presence of #btn-cvd-mode
assert.equal(
  seenIds.has('btn-cvd-mode'),
  true,
  'index.html must contain #btn-cvd-mode toggle button'
);

// Assert presence of all 9 rail tabs
const expectedRailTabs = [
  'tab-btn-overview',
  'tab-btn-scheduler',
  'tab-btn-network',
  'tab-btn-terrain',
  'tab-btn-terminal',
  'tab-btn-authoring',
  'tab-btn-doc',
  'tab-btn-registration',
  'tab-btn-soldier',
];
for (const tabId of expectedRailTabs) {
  assert.equal(
    seenIds.has(tabId),
    true,
    `index.html must contain rail tab #${tabId}`
  );
}

// Assert 100% presence of the 273 test-asserted DOM IDs from UI-01 §5
assert.equal(fs.existsSync(SPEC_UI01_PATH), true, `UI-01 spec must exist at ${SPEC_UI01_PATH}`);
const specContent = fs.readFileSync(SPEC_UI01_PATH, 'utf-8');
const sec5 = specContent.split('## 5. Forensic DOM ID Contract Registry')[1];
assert.ok(sec5, 'UI-01 spec must contain Section 5 DOM ID Contract Registry');

const assertedIdsFromSpec: string[] = [];
for (const line of sec5.split('\n')) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  // Columns: ["", DOM ID, Tag, Line, JS Query?, Test Assertions, Target Zone, Target Mode, ""]
  if (parts.length >= 7 && parts[5] && parts[5] !== '—' && parts[5] !== 'Test Assertions' && parts[5] !== ':---') {
    assertedIdsFromSpec.push(parts[1].replace(/`/g, ''));
  }
}

assert.equal(assertedIdsFromSpec.length, 273, `Expected 273 asserted DOM IDs in UI-01 Section 5, parsed ${assertedIdsFromSpec.length}`);

const missingAssertedIds: string[] = [];
for (const assertedId of assertedIdsFromSpec) {
  if (!seenIds.has(assertedId)) {
    missingAssertedIds.push(assertedId);
  }
}
assert.deepEqual(
  missingAssertedIds,
  [],
  `All 273 test-asserted DOM IDs from UI-01 §5 must be preserved in index.html. Missing: ${missingAssertedIds.join(', ')}`
);

console.log(`  -> Zero duplicate DOM IDs verified across ${allIds.length} elements.`);
console.log('  -> All 9 navigation rail buttons verified present.');
console.log('  -> #btn-cvd-mode verified present.');
console.log(`  -> 100% of the 273 test-asserted DOM IDs verified present in index.html.`);
console.log('  [PASS] WKC-T2 passed successfully.');

// =================================================================================================
// [WKC-T3] Pure Logic Unit Gate (workbenchShell + soldierEudRenderer)
// =================================================================================================
console.log('\n[WKC-T3] Verifying Pure Logic Unit Gate (workbenchShell + soldierEudRenderer)...');

// 1. workbenchShell: isEditableKeyboardTarget
interface MockTarget {
  tagName?: string;
  isContentEditable?: boolean;
}
assert.equal(isEditableKeyboardTarget({ tagName: 'INPUT' } as any), true);
assert.equal(isEditableKeyboardTarget({ tagName: 'TEXTAREA' } as any), true);
assert.equal(isEditableKeyboardTarget({ tagName: 'SELECT' } as any), true);
assert.equal(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true } as any), true);
assert.equal(isEditableKeyboardTarget({ tagName: 'BUTTON' } as any), false);
assert.equal(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: false } as any), false);
assert.equal(isEditableKeyboardTarget({ tagName: 'BODY' } as any), false);
assert.equal(isEditableKeyboardTarget(null), false);
assert.equal(isEditableKeyboardTarget(undefined), false);

// 2. workbenchShell: normalizeCvdMode
assert.equal(normalizeCvdMode('standard'), 'standard');
assert.equal(normalizeCvdMode('colorblind-safe'), 'colorblind-safe');
assert.equal(normalizeCvdMode('unknown-mode'), 'standard');
assert.equal(normalizeCvdMode(null), 'standard');
assert.equal(normalizeCvdMode(undefined), 'standard');
assert.equal(normalizeCvdMode(123), 'standard');

// 3. workbenchShell: hydrateTacticalIcons
class MockElement {
  public attributes: Record<string, string> = {};
  public innerHTML = '';
  constructor(iconName: string) {
    this.attributes['data-c2-icon'] = iconName;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
}
class MockRoot {
  private elements: MockElement[] = [];
  constructor(elements: MockElement[]) {
    this.elements = elements;
  }
  querySelectorAll(sel: string) {
    if (sel.includes('[data-c2-icon]')) return this.elements;
    return [];
  }
}
const mockEl = new MockElement('map2d');
const mockRoot = new MockRoot([mockEl]);
const hydratedCount = hydrateTacticalIcons(mockRoot as any);
assert.equal(hydratedCount, 1, 'hydrateTacticalIcons must return count of hydrated elements');
assert.ok(mockEl.innerHTML.includes('<svg'), 'hydrateTacticalIcons must populate element innerHTML with SVG markup');
assert.ok(mockEl.innerHTML.includes('viewBox="0 0 16 16"'), 'Injected SVG must have standard 16x16 viewBox');

// 4. soldierEudRenderer: resolveSoldierAiNotificationBanner across all deterministic military states
// State 1: Moving to Vantage Point
const banner1 = resolveSoldierAiNotificationBanner({
  ai_is_moving: true,
  ai_eta_s: 25,
  ai_move_dist_m: 80,
});
assert.equal(banner1.badgeText, 'IN TRANSIT');
assert.ok(banner1.title.includes('[MOVE] MOVING TO VANTAGE POINT'));

// State 2: Predictive Imminent Blackout (<15s)
const banner2 = resolveSoldierAiNotificationBanner({
  ai_blackout_in_s: 8.5,
});
assert.equal(banner2.badgeText, 'PREDICTIVE');
assert.ok(banner2.title.includes('[ALERT] BLACKOUT IN 8.5s'));

// State 3: Sky-Shepherd Pinned Rescue
const banner3 = resolveSoldierAiNotificationBanner(
  { ai_is_pinned: true, sinr_db: 12.0 },
  true,
  true,
  'ACN orbit offset shifted for canyon LOS recovery.'
);
assert.equal(banner3.badgeText, 'PINNED RESCUE');
assert.ok(banner3.title.includes('[UAV] SKY-SHEPHERD UAV REPOSITIONING'));

// State 4: Buddy-Mesh Peer Delivery
const banner4 = resolveSoldierAiNotificationBanner({
  ai_buddy_node_id: 3,
  bitrate_mbps: 24.5,
  is_outage: false,
});
assert.equal(banner4.badgeText, 'PEER MESH');
assert.ok(banner4.title.includes('[BUDDY] BUDDY-MESH DELIVERING (24.5 Mbps)'));

// State 5: AI Walk Directive / Reposition
const banner5 = resolveSoldierAiNotificationBanner({
  ai_needs_reposition: true,
  ai_directive_text: 'Walk 50m north to ridge',
});
assert.equal(banner5.badgeText, 'PATHFINDER');
assert.equal(banner5.title, '[MOVE] AI WALK DIRECTIVE');

// State 6: Restored Clear LoS
const banner6 = resolveSoldierAiNotificationBanner({
  is_outage: false,
  sinr_db: 14.2,
});
assert.equal(banner6.badgeText, 'CLEAR LOS');
assert.equal(banner6.title, '[LOS] AI LINK RESTORED: Clear LoS at +14.2 dB');

// State 7: Nominal Position Fallback
const banner7 = resolveSoldierAiNotificationBanner({});
assert.equal(banner7.badgeText, 'CLEAR LOS');
assert.equal(banner7.title, '[OPTIMAL] POSITION OPTIMAL');

console.log('  -> isEditableKeyboardTarget verified across all DOM element types.');
console.log('  -> normalizeCvdMode verified across all aliases and fallbacks.');
console.log('  -> hydrateTacticalIcons verified.');
console.log('  -> resolveSoldierAiNotificationBanner verified deterministically across all 6 military states.');
console.log('  [PASS] WKC-T3 passed successfully.');

console.log('\n' + '='.repeat(96));
console.log('   ALL SUITE 97 GATES PASSED (WKC-T1–T3)');
console.log('='.repeat(96));
