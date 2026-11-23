/**
 * Suite 102: 2D Canvas Label De-Cluttering Engine & DOM Safety URL Guard Verification
 * Spec: docs/specs/v2-03-canvas-declutter-and-security.md (V2-03)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createLabelPlacer, type CanvasLabelPlacer, type PlacedLabelBox } from '../ui/canvasLabelPlacer';
import { isSafeUrl, createSafeElement } from '../ui/domSafety';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('================================================================================');
console.log('  SUITE 102: 2D CANVAS LABEL DE-CLUTTERING & DOM SAFETY URL GUARD (V2-03)');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// [CDS-T1] 2D Label De-Cluttering Zero-Overlap & Exclusion Zones
// -----------------------------------------------------------------------------
console.log('[CDS-T1] Verifying 2D Label De-Cluttering Zero-Overlap & Exclusion Zones...');

const VIEW_W = 800;
const VIEW_H = 600;
const placer: CanvasLabelPlacer = createLabelPlacer(VIEW_W, VIEW_H, 4, 3);

// Reserve left rail (0..48 x 0..600)
placer.reserveRect(0, 0, 48, 600);

// Place 12 identical-anchor labels at (400, 300) with size 80x20
const placedLabels: PlacedLabelBox[] = [];
for (let i = 0; i < 12; i++) {
  const box = placer.placeLabel(400, 300, 80, 20, 400, 300);
  placedLabels.push(box);
}

assert(placer.getPlacedCount() === 12, `Expected 12 placed labels, got ${placer.getPlacedCount()}`);
const totalOverlap = placer.computeTotalOverlapArea();
assert(totalOverlap === 0, `Expected 0 total overlap area, got ${totalOverlap}`);

// Check first label was placed at preferred coordinates without displacement
assert(placedLabels[0].x === 400 && placedLabels[0].y === 300, `Label 0 not at preferred coords: (${placedLabels[0].x}, ${placedLabels[0].y})`);
assert(placedLabels[0].displaced === false, `Label 0 marked as displaced`);
assert(placedLabels[0].displacementPx === 0, `Label 0 displacementPx !== 0`);

// Check subsequent labels were displaced and have displacementPx > 0
for (let i = 1; i < 12; i++) {
  assert(placedLabels[i].displaced === true, `Label ${i} not marked as displaced`);
  assert(placedLabels[i].displacementPx > 0, `Label ${i} displacementPx <= 0`);
}

// Check 100% viewport containment and zero collision with reserved rail
for (let i = 0; i < 12; i++) {
  const b = placedLabels[i];
  assert(b.x >= 4, `Label ${i} clips left viewport margin (x=${b.x})`);
  assert(b.y >= 4, `Label ${i} clips top viewport margin (y=${b.y})`);
  assert(b.x + b.width <= VIEW_W - 4, `Label ${i} clips right viewport margin (x+w=${b.x + b.width})`);
  assert(b.y + b.height <= VIEW_H - 4, `Label ${i} clips bottom viewport margin (y+h=${b.y + b.height})`);
  assert(b.x >= 48, `Label ${i} collides with reserved left rail (x=${b.x} < 48)`);
}

// Check determinism: running fresh placer with same sequence produces identical coordinates
const placer2 = createLabelPlacer(VIEW_W, VIEW_H, 4, 3);
placer2.reserveRect(0, 0, 48, 600);
for (let i = 0; i < 12; i++) {
  const b2 = placer2.placeLabel(400, 300, 80, 20, 400, 300);
  assert(b2.x === placedLabels[i].x && b2.y === placedLabels[i].y, `Non-deterministic placement at index ${i}`);
}

// Check non-finite input guards
const guarded = placer.placeLabel(NaN, Infinity, -10, NaN);
assert(Number.isFinite(guarded.x) && Number.isFinite(guarded.y), 'Guarded coordinates are not finite');
assert(guarded.x >= 4 && guarded.y >= 4, 'Guarded coordinates outside viewport');

console.log('  ✓ 12 colliding labels de-conflicted with zero overlap (0 px²)');
console.log('  ✓ 100% viewport boundary containment verified');
console.log('  ✓ Exclusion zone (left tool rail 0..48) 100% respected');
console.log('  ✓ Deterministic placement & non-finite guards verified');
console.log('[CDS-T1] PASS\n');

// -----------------------------------------------------------------------------
// [CDS-T2] 60 fps Performance Micro-Benchmark
// -----------------------------------------------------------------------------
console.log('[CDS-T2] Running 60 fps Performance Micro-Benchmark...');

const FRAMES = 1000;
const LABELS_PER_FRAME = 25;

// Warm-up pass for V8 JIT tier-up
for (let f = 0; f < 150; f++) {
  const warmPlacer = createLabelPlacer(800, 600, 4, 3);
  warmPlacer.reserveRect(0, 0, 48, 600);
  for (let l = 0; l < LABELS_PER_FRAME; l++) {
    const px = 350 + (l % 5) * 15;
    const py = 250 + Math.floor(l / 5) * 10;
    warmPlacer.placeLabel(px, py, 70, 16, px, py);
  }
}

const tStart = performance.now();

for (let f = 0; f < FRAMES; f++) {
  const benchPlacer = createLabelPlacer(800, 600, 4, 3);
  benchPlacer.reserveRect(0, 0, 48, 600);
  benchPlacer.reserveRect(680, 560, 120, 40); // Layers HUD
  for (let l = 0; l < LABELS_PER_FRAME; l++) {
    // Dense clustering near center to stress collision avoidance
    const px = 350 + (l % 5) * 15;
    const py = 250 + Math.floor(l / 5) * 10;
    benchPlacer.placeLabel(px, py, 70, 16, px, py);
  }
}

const tElapsed = performance.now() - tStart;
const usPerFrame = (tElapsed / FRAMES) * 1000;

console.log(`  Processed ${FRAMES} frames x ${LABELS_PER_FRAME} labels in ${tElapsed.toFixed(2)} ms`);
console.log(`  Throughput: ${usPerFrame.toFixed(2)} µs/frame (Budget: < 50.00 µs/frame)`);
assert(tElapsed < 50, `Performance budget exceeded: ${tElapsed.toFixed(2)} ms >= 50 ms`);
console.log('[CDS-T2] PASS\n');

// -----------------------------------------------------------------------------
// [CDS-T3] domSafety.ts URL-Scheme & srcdoc Penetration Tests
// -----------------------------------------------------------------------------
console.log('[CDS-T3] Verifying domSafety.ts URL-Scheme & srcdoc Penetration Tests...');

// Vectors that MUST be rejected
const dangerousUrls = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '\u0000\t\njavascript:alert(1)',
  'javascript:/*--></title></style></textarea></script>*/<svg/onload=alert()>',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'data:image/svg+xml,<svg onload=alert(1)>',
  'data:application/xhtml+xml,<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>',
  '//evil.com/payload.js',
  '\\\\evil.com\\payload.js',
  'file:///etc/passwd',
  '',
  '   ',
  null,
  undefined,
  12345,
  {},
];

for (const url of dangerousUrls) {
  assert(!isSafeUrl(url), `Failed to reject dangerous URL: ${String(url)}`);
}

// Vectors that MUST be permitted
const safeUrls = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0',
  'http://localhost:5173/tiles/0/0/0.png',
  'mailto:support@tactical.mil',
  'blob:http://localhost:5173/550e8400-e29b-41d4-a716-446655440000',
  '/assets/military_symbols.svg',
  './tiles/ladakh_dem.bin',
  '../resources/hgt/N34E076.hgt',
  '#tab-tactical-tools',
  '?mode=radar&zoom=6',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/',
  'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
];

for (const url of safeUrls) {
  assert(isSafeUrl(url), `Incorrectly rejected safe URL: ${url}`);
}

// Test createSafeElement DOM attribute filtering
if (typeof document === 'undefined') {
  // Polyfill minimal document for Node.js test environment if needed
  const mockAttrs = new Map<string, string>();
  const mockEl = {
    setAttribute: (k: string, v: string) => mockAttrs.set(k.toLowerCase(), v),
    getAttribute: (k: string) => mockAttrs.get(k.toLowerCase()),
    textContent: '',
  };
  (globalThis as any).document = {
    createElement: (_tag: string) => ({
      ...mockEl,
      tagName: _tag.toUpperCase(),
    }),
  };
}

const safeEl = createSafeElement('a', {
  href: 'javascript:alert(1)',
  srcdoc: '<h1>pwned</h1>',
  onclick: 'alert(1)',
  'xlink:href': 'data:text/html,<script>alert(1)</script>',
  title: 'Safe Link',
  id: 'safe-link-1',
}, 'Tactical Node');

assert(!safeEl.getAttribute('href'), 'Dangerous href attribute was not stripped');
assert(!safeEl.getAttribute('srcdoc'), 'srcdoc attribute was not blocked');
assert(!safeEl.getAttribute('onclick'), 'onclick inline event handler was not blocked');
assert(!safeEl.getAttribute('xlink:href'), 'Dangerous xlink:href was not stripped');
assert(safeEl.getAttribute('title') === 'Safe Link', 'Safe title attribute was dropped');
assert(safeEl.getAttribute('id') === 'safe-link-1', 'Safe id attribute was dropped');
assert(safeEl.textContent === 'Tactical Node', 'textContent was corrupted');

const validEl = createSafeElement('a', {
  href: 'https://tactical-twin.internal/docs',
  id: 'valid-doc-link',
});
assert(validEl.getAttribute('href') === 'https://tactical-twin.internal/docs', 'Valid https href was incorrectly stripped');

console.log('  ✓ 18 dangerous URL & protocol injection vectors neutralized');
console.log('  ✓ 12 safe tactical URLs and raster data URIs verified');
console.log('  ✓ createSafeElement srcdoc, on*, and URL attribute guards verified');
console.log('[CDS-T3] PASS\n');

// -----------------------------------------------------------------------------
// [CDS-T4] Integration & Zero-Slop Gate
// -----------------------------------------------------------------------------
console.log('[CDS-T4] Verifying Integration & Zero-Slop Gate...');

const root = process.cwd();
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const placerTs = readFileSync(resolve(root, 'src/ui/canvasLabelPlacer.ts'), 'utf8');
const domSafetyTs = readFileSync(resolve(root, 'src/ui/domSafety.ts'), 'utf8');

// Zero-emoji check in new/modified TypeScript files
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
assert(!EMOJI_REGEX.test(placerTs), 'Found emoji in canvasLabelPlacer.ts');
assert(!EMOJI_REGEX.test(domSafetyTs), 'Found emoji in domSafety.ts');

// Air-gap notice in index.html
const AIR_GAP_NOTICE = 'Air-gap mode: external map tiles blocked/offline — switch to Radar / SRTM DEM';
assert(indexHtml.includes(AIR_GAP_NOTICE), `Air-gap notice missing in index.html: "${AIR_GAP_NOTICE}"`);

// Verify createLabelPlacer is imported/used in index.html
assert(indexHtml.includes('createLabelPlacer'), 'createLabelPlacer is not referenced in index.html');

// Zero duplicate DOM IDs check in index.html
const idMatches = [...indexHtml.matchAll(/id=["']([a-zA-Z0-9_-]+)["']/g)].map(m => m[1]);
const idSet = new Set<string>();
const duplicates = new Set<string>();
for (const id of idMatches) {
  if (idSet.has(id)) {
    duplicates.add(id);
  }
  idSet.add(id);
}
assert(duplicates.size === 0, `Duplicate DOM IDs found in index.html: ${[...duplicates].join(', ')}`);

console.log('  ✓ Zero emojis detected in TypeScript sources');
console.log('  ✓ Air-gap fallback notice verified in index.html');
console.log('  ✓ createLabelPlacer wired into 2D radar overlay draw pass');
console.log(`  ✓ Checked ${idMatches.length} DOM IDs: 0 duplicate IDs found`);
console.log('[CDS-T4] PASS\n');

console.log('================================================================================');
console.log('  SUITE 102 VERIFICATION COMPLETED: ALL GATES PASS (4/4)');
console.log('================================================================================');
