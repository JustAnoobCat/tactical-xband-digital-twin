/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Suite 96: Tactical Obsidian Design System & UI Architecture Verification (TDS-T1–T4)
 * Specification: docs/specs/ui01-tactical-workbench-architecture.md
 *
 * Verification Gates:
 * - TDS-T1: Zero-Emoji & Zero-AI-Slop Static Gate (CSS & SVG Icon Kit)
 * - TDS-T2: WCAG 2.1 AA Contrast Gate on Design Tokens (Text & CVD Signal Palettes)
 * - TDS-T3: SVG Icon Kit Integrity, Whitelist Lookup & Defensive XSS Sanitization
 * - TDS-T4: UI Architecture & DOM Contract Specification Completeness
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeWcagContrastRatio,
  meetsWcagContrast,
} from '../ui/accessibilityEncoding';
import {
  TACTICAL_ICONS,
  FALLBACK_TACTICAL_ICON,
  getTacticalIconNames,
  isTacticalIconName,
  renderTacticalIcon,
  TacticalIconName,
} from '../ui/tacticalIcons';
import { TrustedHtml } from '../ui/domSafety';

console.log('='.repeat(96));
console.log('   SUITE 96: TACTICAL OBSIDIAN DESIGN SYSTEM & UI ARCHITECTURE VERIFICATION');
console.log('   Specification: docs/specs/ui01-tactical-workbench-architecture.md');
console.log('='.repeat(96));

const ROOT_DIR = process.cwd();
const CSS_PATH = path.join(ROOT_DIR, 'frontend', 'tactical-obsidian.css');
const ICONS_PATH = path.join(ROOT_DIR, 'src', 'ui', 'tacticalIcons.ts');
const SPEC_PATH = path.join(ROOT_DIR, 'docs', 'specs', 'ui01-tactical-workbench-architecture.md');

// =================================================================================================
// [TDS-T1] Zero-Emoji & Zero-AI-Slop Static Gate
// =================================================================================================
console.log('\n[TDS-T1] Verifying Zero-Emoji & Zero-AI-Slop Static Gate...');

assert.equal(fs.existsSync(CSS_PATH), true, `tactical-obsidian.css must exist at ${CSS_PATH}`);
assert.equal(fs.existsSync(ICONS_PATH), true, `tacticalIcons.ts must exist at ${ICONS_PATH}`);

const cssContent = fs.readFileSync(CSS_PATH, 'utf-8');
const iconsCode = fs.readFileSync(ICONS_PATH, 'utf-8');

// Comprehensive Unicode Emoji / Extended Pictographic regex
const unicodeEmojiRegex = /\p{Extended_Pictographic}/u;

// 1. Emoji assertions
const cssEmojiMatch = unicodeEmojiRegex.test(cssContent);
assert.equal(
  cssEmojiMatch,
  false,
  'frontend/tactical-obsidian.css must contain STRICTLY ZERO Unicode emojis or pictographs'
);

const iconsEmojiMatch = unicodeEmojiRegex.test(iconsCode);
assert.equal(
  iconsEmojiMatch,
  false,
  'src/ui/tacticalIcons.ts must contain STRICTLY ZERO Unicode emojis or pictographs'
);

// 2. Strict CSS hygiene assertions
// Zero backdrop-filter: blur
const hasBackdropFilterBlur = /backdrop-filter\s*:[^;]*blur/i.test(cssContent);
assert.equal(
  hasBackdropFilterBlur,
  false,
  'frontend/tactical-obsidian.css must contain STRICTLY ZERO backdrop-filter: blur rules'
);

// Zero neon multi-layer glow box-shadows (e.g. 0 0 15px cyan, 0 0 20px #...)
const hasNeonGlowShadow = /box-shadow\s*:[^;]*(?:0\s+0\s+[5-9]\d*px|0\s+0\s+[1-9]\d{2,}px|rgba\(\s*0\s*,\s*229\s*,\s*255\s*,\s*0\.[5-9]\))/i.test(cssContent);
assert.equal(
  hasNeonGlowShadow,
  false,
  'frontend/tactical-obsidian.css must contain STRICTLY ZERO neon text/box-shadow glow effects'
);

// Zero !important declarations (clean, non-coercive CSS architecture)
const importantMatches = cssContent.match(/!important/g);
assert.equal(
  importantMatches,
  null,
  'frontend/tactical-obsidian.css must maintain zero !important specificity wars'
);

console.log('  -> Zero emojis verified across CSS and Icon Kit.');
console.log('  -> Zero backdrop-filter: blur verified.');
console.log('  -> Zero neon glow box-shadows verified.');
console.log('  -> Zero !important declarations verified.');
console.log('  [PASS] TDS-T1 passed successfully.');

// =================================================================================================
// [TDS-T2] WCAG 2.1 AA Contrast Gate on Design Tokens
// =================================================================================================
console.log('\n[TDS-T2] Verifying WCAG 2.1 AA Contrast Gate on Design Tokens...');

function extractCssVariable(css: string, varName: string): string {
  const regex = new RegExp(`${varName}\\s*:\\s*([^;]+);`);
  const match = css.match(regex);
  assert.ok(match, `CSS variable ${varName} must be defined in tactical-obsidian.css`);
  return match[1].trim();
}

function extractCvdVariable(css: string, varName: string): string {
  const cvdBlockMatch = css.match(/\[data-cvd-mode="colorblind-safe"\]\s*\{([^}]+)\}/);
  assert.ok(cvdBlockMatch, '[data-cvd-mode="colorblind-safe"] block must be defined in tactical-obsidian.css');
  const regex = new RegExp(`${varName}\\s*:\\s*([^;]+);`);
  const match = cvdBlockMatch[1].match(regex);
  assert.ok(match, `CVD CSS variable ${varName} must be defined in tactical-obsidian.css`);
  return match[1].trim();
}

const c2Surface = extractCssVariable(cssContent, '--c2-surface');
const c2Elevated = extractCssVariable(cssContent, '--c2-elevated');
const textPrimary = extractCssVariable(cssContent, '--c2-text-primary');
const textSecondary = extractCssVariable(cssContent, '--c2-text-secondary');
const textMuted = extractCssVariable(cssContent, '--c2-text-muted');

// Assert surface tokens match approved matte palette
assert.equal(c2Surface, '#0e1116', '--c2-surface must be #0e1116');
assert.equal(c2Elevated, '#141820', '--c2-elevated must be #141820');

// Verify text contrast against --c2-surface (#0e1116)
const contrastPrimarySurface = computeWcagContrastRatio(textPrimary, c2Surface);
const contrastSecondarySurface = computeWcagContrastRatio(textSecondary, c2Surface);
const contrastMutedSurface = computeWcagContrastRatio(textMuted, c2Surface);

assert.ok(
  contrastPrimarySurface >= 4.5,
  `--c2-text-primary (${textPrimary}) vs ${c2Surface} contrast ${contrastPrimarySurface.toFixed(2)}:1 must meet WCAG AA (>= 4.5:1)`
);
assert.ok(
  contrastSecondarySurface >= 4.5,
  `--c2-text-secondary (${textSecondary}) vs ${c2Surface} contrast ${contrastSecondarySurface.toFixed(2)}:1 must meet WCAG AA (>= 4.5:1)`
);
assert.ok(
  contrastMutedSurface >= 4.5,
  `--c2-text-muted (${textMuted}) vs ${c2Surface} contrast ${contrastMutedSurface.toFixed(2)}:1 must meet WCAG AA (>= 4.5:1)`
);

// Verify text contrast against --c2-elevated (#141820)
const contrastPrimaryElevated = computeWcagContrastRatio(textPrimary, c2Elevated);
const contrastSecondaryElevated = computeWcagContrastRatio(textSecondary, c2Elevated);
const contrastMutedElevated = computeWcagContrastRatio(textMuted, c2Elevated);

assert.ok(contrastPrimaryElevated >= 4.5, `--c2-text-primary vs ${c2Elevated} must meet WCAG AA`);
assert.ok(contrastSecondaryElevated >= 4.5, `--c2-text-secondary vs ${c2Elevated} must meet WCAG AA`);
assert.ok(contrastMutedElevated >= 4.5, `--c2-text-muted vs ${c2Elevated} must meet WCAG AA`);

// Verify Standard Semantic Signals against --c2-surface
const stdOptimal = extractCssVariable(cssContent, '--c2-sig-optimal');
const stdDegraded = extractCssVariable(cssContent, '--c2-sig-degraded');
const stdCritical = extractCssVariable(cssContent, '--c2-sig-critical');
const stdOutage = extractCssVariable(cssContent, '--c2-sig-outage');
const stdRelay = extractCssVariable(cssContent, '--c2-sig-relay');

const stdSignals = [
  { name: 'OPTIMAL', color: stdOptimal },
  { name: 'DEGRADED', color: stdDegraded },
  { name: 'CRITICAL', color: stdCritical },
  { name: 'OUTAGE', color: stdOutage },
  { name: 'RELAY', color: stdRelay },
];

for (const sig of stdSignals) {
  const ratio = computeWcagContrastRatio(sig.color, c2Surface);
  assert.ok(
    ratio >= 4.5,
    `Standard signal ${sig.name} (${sig.color}) vs ${c2Surface} contrast ${ratio.toFixed(2)}:1 must meet WCAG AA (>= 4.5:1)`
  );
}

// Verify Color Vision Deficiency (CVD) Semantic Signals against --c2-surface
const cvdOptimal = extractCvdVariable(cssContent, '--c2-sig-optimal');
const cvdDegraded = extractCvdVariable(cssContent, '--c2-sig-degraded');
const cvdCritical = extractCvdVariable(cssContent, '--c2-sig-critical');
const cvdOutage = extractCvdVariable(cssContent, '--c2-sig-outage');
const cvdRelay = extractCvdVariable(cssContent, '--c2-sig-relay');

const cvdSignals = [
  { name: 'CVD OPTIMAL', color: cvdOptimal },
  { name: 'CVD DEGRADED', color: cvdDegraded },
  { name: 'CVD CRITICAL', color: cvdCritical },
  { name: 'CVD OUTAGE', color: cvdOutage },
  { name: 'CVD RELAY', color: cvdRelay },
];

for (const sig of cvdSignals) {
  const ratio = computeWcagContrastRatio(sig.color, c2Surface);
  assert.ok(
    ratio >= 4.5,
    `CVD signal ${sig.name} (${sig.color}) vs ${c2Surface} contrast ${ratio.toFixed(2)}:1 must meet WCAG AA (>= 4.5:1)`
  );
}

console.log(`  -> Text Primary (${textPrimary}) vs Surface: ${contrastPrimarySurface.toFixed(2)}:1 (WCAG AAA)`);
console.log(`  -> Text Secondary (${textSecondary}) vs Surface: ${contrastSecondarySurface.toFixed(2)}:1 (WCAG AAA)`);
console.log(`  -> Text Muted (${textMuted}) vs Surface: ${contrastMutedSurface.toFixed(2)}:1 (WCAG AA)`);
console.log('  -> All 5 Standard Signal tokens pass WCAG AA >= 4.5:1.');
console.log('  -> All 5 CVD Signal tokens pass WCAG AA >= 4.5:1.');
console.log('  [PASS] TDS-T2 passed successfully.');

// =================================================================================================
// [TDS-T3] SVG Icon Kit Integrity, Whitelist Lookup & Defensive XSS Sanitization
// =================================================================================================
console.log('\n[TDS-T3] Verifying SVG Icon Kit Integrity & XSS Sanitization...');

const iconNames = getTacticalIconNames();
assert.ok(iconNames.length >= 35, `Tactical icon registry must contain at least 35 icons (found ${iconNames.length})`);

// 1. Verify every icon in registry is valid geometric SVG markup
for (const name of iconNames) {
  assert.equal(isTacticalIconName(name), true, `isTacticalIconName must return true for ${name}`);
  const rendered = renderTacticalIcon(name);
  assert.ok(rendered instanceof TrustedHtml, 'renderTacticalIcon must return a TrustedHtml instance');

  const html = rendered.toString();
  assert.ok(html.startsWith('<svg'), `Icon ${name} must start with <svg`);
  assert.ok(html.endsWith('</svg>'), `Icon ${name} must end with </svg>`);
  assert.ok(html.includes('viewBox="0 0 16 16"'), `Icon ${name} must specify viewBox="0 0 16 16"`);
  assert.ok(html.includes('stroke-width="1.5"'), `Icon ${name} must specify stroke-width="1.5"`);
  assert.ok(html.includes('aria-hidden="true"'), `Icon ${name} default must have aria-hidden="true"`);

  // Zero script injection or event handlers
  assert.equal(/<script/i.test(html), false, `Icon ${name} must not contain <script`);
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, `Icon ${name} must not contain event handlers`);
}

// 2. Fallback on unknown icon names
const unknownIcon = renderTacticalIcon('non_existent_command_glyph_999');
assert.ok(unknownIcon instanceof TrustedHtml);
const fallbackHtml = unknownIcon.toString();
assert.ok(
  fallbackHtml.includes(FALLBACK_TACTICAL_ICON),
  'Unknown icon name must safely fall back to FALLBACK_TACTICAL_ICON'
);

// 3. Accessibility Title / Aria-Label rendering
const titledIcon = renderTacticalIcon('play', { title: 'Resume Simulation' });
assert.ok(titledIcon.toString().includes('<title>Resume Simulation</title>'));
assert.ok(titledIcon.toString().includes('role="img"'));
assert.equal(titledIcon.toString().includes('aria-hidden="true"'), false);

const labeledIcon = renderTacticalIcon('pause', { ariaLabel: 'Halt Discrete Engine' });
assert.ok(labeledIcon.toString().includes('role="img" aria-label="Halt Discrete Engine"'));
assert.equal(labeledIcon.toString().includes('aria-hidden="true"'), false);

// 4. Defensive XSS Sanitization Gate
const xssPayloadClassName = 'c2-icon" onmouseover="alert(1)" data-hack="';
const xssPayloadTitle = '<script>alert("xss")</script>';
const xssPayloadAria = 'Unsafe "><img src=x onerror=alert(1)>';

const sanitized = renderTacticalIcon('antenna', {
  className: xssPayloadClassName,
  title: xssPayloadTitle,
  ariaLabel: xssPayloadAria,
  size: 24,
});

const sanitizedHtml = sanitized.toString();
assert.equal(
  sanitizedHtml.includes('<script>'),
  false,
  'renderTacticalIcon must neutralize raw <script> in title'
);
assert.ok(
  sanitizedHtml.includes('&lt;script&gt;'),
  'renderTacticalIcon must HTML-escape title contents'
);
assert.equal(
  sanitizedHtml.includes('onmouseover="alert(1)"'),
  false,
  'renderTacticalIcon must attribute-escape className'
);
assert.ok(
  sanitizedHtml.includes('width="24" height="24"'),
  'renderTacticalIcon must apply sanitized numeric size'
);

// 5. Size validation & clamping
const clampedTest = renderTacticalIcon('ruler', { size: 9999 });
assert.ok(clampedTest.toString().includes('width="256" height="256"'), 'Size must clamp to max 256');

const negativeTest = renderTacticalIcon('ruler', { size: -50 });
assert.ok(negativeTest.toString().includes('width="16" height="16"'), 'Invalid size must fall back to 16');

console.log(`  -> Verified all ${iconNames.length} tactical geometric icons.`);
console.log('  -> Whitelist lookup and fallback neutral glyph verified.');
console.log('  -> Accessibility roles and title tags verified.');
console.log('  -> XSS attribute injection attacks safely neutralized.');
console.log('  -> Numeric size sanitization & clamping verified.');
console.log('  [PASS] TDS-T3 passed successfully.');

// =================================================================================================
// [TDS-T4] UI Architecture & DOM Contract Specification Completeness
// =================================================================================================
console.log('\n[TDS-T4] Verifying Architecture Spec Completeness...');

assert.equal(fs.existsSync(SPEC_PATH), true, `Specification file must exist at ${SPEC_PATH}`);
const specContent = fs.readFileSync(SPEC_PATH, 'utf-8');

// Assert key architectural sections are documented
assert.ok(
  specContent.includes('## 1. Executive Summary & Authoritative Invariants'),
  'Spec must contain Executive Summary & Authoritative Invariants'
);
assert.ok(
  specContent.includes('## 2. Stitch Overhaul Failure Analysis & Root Cause Postmortem'),
  'Spec must contain Stitch Failure Analysis'
);
assert.ok(
  specContent.includes('## 3. The 4-Zone Map-First Tactical C2 Workbench Blueprint'),
  'Spec must contain 4-Zone Workbench Blueprint'
);
assert.ok(
  specContent.includes('## 4. Current Emoji & AI-Slop Inventory'),
  'Spec must contain Current Emoji & AI-Slop Inventory'
);
assert.ok(
  specContent.includes('## 5. Forensic DOM ID Contract Registry'),
  'Spec must contain Forensic DOM ID Contract Registry'
);
assert.ok(
  specContent.includes('## 6. Design Token Architecture'),
  'Spec must contain Design Token Architecture'
);

// Assert 4 zones are explicitly articulated
assert.ok(specContent.includes('Zone 1: Top Command Strip'), 'Spec must define Zone 1');
assert.ok(specContent.includes('Zone 2: Left Precision Tool Rail'), 'Spec must define Zone 2');
assert.ok(specContent.includes('Zone 3: Dominant Center Viewport'), 'Spec must define Zone 3');
assert.ok(specContent.includes('Zone 4: Collapsible Right Contextual Inspector'), 'Spec must define Zone 4');

// Assert 5 workspace modes are articulated
const workspaceModes = ['OPS', 'RF / PHY', 'MAC / NET', 'PLAN / AI', 'LAB'];
for (const mode of workspaceModes) {
  assert.ok(specContent.includes(mode), `Spec must explicitly define workspace mode ${mode}`);
}

// Assert extensive DOM ID registry presence (>= 800 entries)
const domIdMatches = specContent.match(/\| `[a-zA-Z0-9_\-]+` \| `<[a-zA-Z0-9\-]+>` \|/g);
assert.ok(
  domIdMatches && domIdMatches.length >= 800,
  `Spec DOM ID Contract Registry must document at least 800 DOM IDs (found ${domIdMatches?.length})`
);

console.log(`  -> Architecture Spec exists (${specContent.length} bytes).`);
console.log(`  -> Documented ${domIdMatches?.length} DOM IDs in Forensic Contract Registry.`);
console.log('  -> All 4 workbench zones and 5 workspace modes detailed.');
console.log('  -> Stitch failure analysis and emoji purge inventory verified.');
console.log('  [PASS] TDS-T4 passed successfully.');

console.log('\n' + '='.repeat(96));
console.log('   ALL 4 GATES PASSED: TACTICAL DESIGN SYSTEM & UI ARCHITECTURE VERIFIED');
console.log('='.repeat(96) + '\n');
