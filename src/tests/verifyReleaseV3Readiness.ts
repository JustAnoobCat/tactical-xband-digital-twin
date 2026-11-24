/**
 * Tactical Digital Twin — Verification Suite 114 (SPEC-V3-12)
 *
 * Final V3.0 Release Readiness, Documentation Link Integrity, Suite Registry & Zero-Slop Architectural Invariant Gate
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

console.log('='.repeat(96));
console.log('  TACTICAL DIGITAL TWIN — VERIFICATION SUITE 114 (SPEC-V3-12)');
console.log('  Final V3.0 Release Readiness, Documentation Integrity & Architectural Invariants');
console.log('='.repeat(96));

let passedChecks = 0;

async function runCheck(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passedChecks++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${label}`);
    throw err;
  }
}

async function runAllTests(): Promise<void> {
  // ============================================================================
  // [REL-T1] Documentation & Link Integrity
  // ============================================================================
  console.log('\n[REL-T1] Documentation & Link Integrity...');

  await runCheck('All local markdown links in README.md resolve to existing files on disk', () => {
    const readmePath = path.join(ROOT_DIR, 'README.md');
    assert.equal(fs.existsSync(readmePath), true, 'README.md must exist at root');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');

    const linkRegex = /\[([^\]]+)\]\((?!https?:\/\/|mailto:|#)([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const brokenLinks: Array<{ text: string; link: string }> = [];
    let linkCount = 0;

    while ((match = linkRegex.exec(readmeContent)) !== null) {
      linkCount++;
      const target = match[2].split('#')[0];
      if (!target) continue;
      const resolved = path.resolve(ROOT_DIR, target);
      if (!fs.existsSync(resolved)) {
        brokenLinks.push({ text: match[1], link: match[2] });
      }
    }

    assert.ok(linkCount >= 50, `Expected at least 50 local markdown links in README.md, found ${linkCount}`);
    assert.deepEqual(brokenLinks, [], `Broken local markdown links found in README.md: ${JSON.stringify(brokenLinks)}`);
  });

  await runCheck('README.md contains live GitHub Pages demo URL, Actions CI badge, and accurate 114 suite count', () => {
    const readmeContent = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');

    assert.ok(
      readmeContent.includes('https://justanoobcat.github.io/tactical-xband-digital-twin/'),
      'README.md must contain live GitHub Pages interactive demo URL'
    );
    assert.ok(
      readmeContent.includes('https://github.com/JustAnoobCat/tactical-xband-digital-twin/actions/workflows/ci.yml/badge.svg'),
      'README.md must contain GitHub Actions CI badge'
    );
    assert.ok(
      readmeContent.includes('114') && readmeContent.includes('TypeScript verification suites'),
      'README.md must accurately document 114 TypeScript verification suites'
    );
    assert.ok(
      readmeContent.includes('27') && readmeContent.includes('Python `pytest` suites'),
      'README.md must document 27 Python pytest suites'
    );
  });

  await runCheck('All 12 V3 specifications (v3-01 through v3-12) exist on disk in docs/specs/', () => {
    const specsDir = path.join(ROOT_DIR, 'docs', 'specs');
    assert.equal(fs.existsSync(specsDir), true, 'docs/specs must exist');

    const expectedSpecs = [
      'v3-01-multi-biome-rf-physics.md',
      'v3-02-closed-loop-mac-transport.md',
      'v3-03-ew-eccm-esm-lpi.md',
      'v3-04-constellation-manet-aerodynamics.md',
      'v3-05-digital-twin-calibration.md',
      'v3-06-military-gis-and-persistence.md',
      'v3-07-3d-volumetric-rf.md',
      'v3-08-command-palette-and-aar.md',
      'v3-09-typed-ui-controllers-part1.md',
      'v3-10-typed-radar-and-toolbox-controllers.md',
      'v3-11-parity-server-offline-tiles-and-extraction.md',
      'v3-12-e2e-coverage-and-v3-release.md',
    ];

    for (const specFile of expectedSpecs) {
      const specPath = path.join(specsDir, specFile);
      assert.equal(fs.existsSync(specPath), true, `Specification file ${specFile} must exist in docs/specs/`);
      const stat = fs.statSync(specPath);
      assert.ok(stat.size > 500, `Specification file ${specFile} must not be empty (size=${stat.size} bytes)`);
    }
  });

  // ============================================================================
  // [REL-T2] Suite Registry & Package Parity
  // ============================================================================
  console.log('\n[REL-T2] Suite Registry & Package Parity...');

  await runCheck('scripts/run_all_verifications.mjs registers exactly 114 verification suites', () => {
    const runnerPath = path.join(ROOT_DIR, 'scripts', 'run_all_verifications.mjs');
    assert.equal(fs.existsSync(runnerPath), true);
    const content = fs.readFileSync(runnerPath, 'utf8');

    const match = content.match(/const REGISTERED_SUITES = \[([\s\S]*?)\];/);
    assert.ok(match, 'run_all_verifications.mjs must declare REGISTERED_SUITES array');

    const suiteEntries = match[1].split('{ id:').filter(s => s.trim().length > 0);
    assert.equal(
      suiteEntries.length,
      114,
      `REGISTERED_SUITES must contain exactly 114 suites, found ${suiteEntries.length}`
    );

    assert.ok(
      content.includes("'verify:release-v3-readiness'"),
      "REGISTERED_SUITES must include Suite 114 ('verify:release-v3-readiness')"
    );
  });

  await runCheck('package.json exposes server:ts, verify:coverage, benchmark:scientific, and verify:release-v3-readiness', () => {
    const pkgPath = path.join(ROOT_DIR, 'package.json');
    assert.equal(fs.existsSync(pkgPath), true);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    assert.ok(pkg.scripts['server:ts'], 'package.json must expose server:ts script');
    assert.ok(pkg.scripts['verify:coverage'], 'package.json must expose verify:coverage script');
    assert.ok(pkg.scripts['benchmark:scientific'], 'package.json must expose benchmark:scientific script');
    assert.ok(pkg.scripts['verify:release-v3-readiness'], 'package.json must expose verify:release-v3-readiness script');
  });

  // ============================================================================
  // [REL-T3] Global Architecture & Zero-Slop Invariant Gate
  // ============================================================================
  console.log('\n[REL-T3] Global Architecture & Zero-Slop Invariant Gate...');

  await runCheck('src/worker/simWorker.ts remains strictly below 3,300 lines (3,281 baseline)', () => {
    const workerPath = path.join(ROOT_DIR, 'src', 'worker', 'simWorker.ts');
    assert.equal(fs.existsSync(workerPath), true);
    const lines = fs.readFileSync(workerPath, 'utf8').split('\n').length;
    assert.ok(
      lines < 3300,
      `simWorker.ts must not bloat beyond 3,300 lines (current: ${lines})`
    );
  });

  await runCheck('index.html has zero duplicate DOM IDs, zero external CDN scripts/links, and zero emojis', () => {
    const indexPath = path.join(ROOT_DIR, 'index.html');
    assert.equal(fs.existsSync(indexPath), true);
    const html = fs.readFileSync(indexPath, 'utf8');

    // Duplicate IDs check
    const idRegex = /\sid=["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    const idCounts = new Map<string, number>();
    while ((m = idRegex.exec(html)) !== null) {
      const id = m[1];
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
    const duplicates = Array.from(idCounts.entries()).filter(([_, c]) => c > 1);
    assert.deepEqual(
      duplicates,
      [],
      `index.html must have zero duplicate IDs (found: ${duplicates.map(([id, c]) => `${id}×${c}`).join(', ')})`
    );

    // External CDN / remote tile links/scripts check
    const externalPatterns = [
      'cdn.tailwindcss.com',
      'fonts.googleapis.com',
      'fonts.gstatic.com',
      'unpkg.com',
      'cdnjs.cloudflare.com',
      'cdn.jsdelivr.net',
    ];
    for (const pat of externalPatterns) {
      assert.equal(
        html.includes(pat),
        false,
        `index.html must have zero external CDN references to ${pat}`
      );
    }

    // Zero emojis check (excluding standard ASCII symbols like copyright, bullets, quotes)
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
    assert.equal(
      emojiRegex.test(html),
      false,
      'index.html must strictly adhere to zero-emoji mandate per AGENTS.md'
    );
  });

  await runCheck('frontend/c2-console-theme.css contains zero !important rules and zero backdrop-filter: blur', () => {
    const cssPath = path.join(ROOT_DIR, 'frontend', 'c2-console-theme.css');
    assert.equal(fs.existsSync(cssPath), true);
    const css = fs.readFileSync(cssPath, 'utf8');

    // Strip comments before checking rules
    const strippedCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
      strippedCss.includes('!important'),
      false,
      'c2-console-theme.css must contain zero !important declarations'
    );
    assert.equal(
      strippedCss.includes('backdrop-filter: blur') || strippedCss.includes('backdrop-filter:blur'),
      false,
      'c2-console-theme.css must contain zero backdrop-filter: blur rules'
    );
  });

  await runCheck('electron/main.cjs maintains sandbox: true and xband-tile protocol containment', () => {
    const electronMainPath = path.join(ROOT_DIR, 'electron', 'main.cjs');
    assert.equal(fs.existsSync(electronMainPath), true);
    const mainJs = fs.readFileSync(electronMainPath, 'utf8');

    assert.ok(mainJs.includes('sandbox: true'), 'electron/main.cjs must enforce sandbox: true');
    assert.ok(mainJs.includes('xband-tile'), 'electron/main.cjs must register and handle xband-tile protocol');
    assert.ok(mainJs.includes('contextIsolation: true'), 'electron/main.cjs must enforce contextIsolation: true');
  });

  console.log('\n' + '='.repeat(96));
  console.log(`  SUITE 114 SUMMARY: ${passedChecks} checks passed, 0 failures.`);
  console.log('='.repeat(96) + '\n');
}

runAllTests().catch((err) => {
  console.error('\nSuite 114 FAILED:', err);
  process.exit(1);
});
