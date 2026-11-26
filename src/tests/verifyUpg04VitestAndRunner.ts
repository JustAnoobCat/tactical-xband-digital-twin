/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Verification Suite 135 (UPG-04):
 * Fast Parallel Vitest Pooled Runner, V8 Coverage & Serial-Lane Runner Verification
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(currentDir, '../..');

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log('='.repeat(92));
console.log('  SUITE 135 (UPG-04): VITEST POOLED RUNNER, V8 COVERAGE & SERIAL-LANE RUNNER');
console.log('='.repeat(92));

check('vitest.config.ts targets src/tests/**/*.vitest.ts with threads pool & v8 coverage without node:test collision', () => {
  const cfgPath = path.join(ROOT_DIR, 'vitest.config.ts');
  assert.equal(fs.existsSync(cfgPath), true, 'vitest.config.ts must exist');
  const cfgText = fs.readFileSync(cfgPath, 'utf8');

  assert.ok(cfgText.includes('src/tests/**/*.vitest.ts'), 'vitest.config.ts must include src/tests/**/*.vitest.ts');
  assert.equal(cfgText.includes('.test.ts'), false, 'vitest.config.ts must not match node:test .test.ts files');
  assert.ok(cfgText.includes("environment: 'node'"), "vitest.config.ts must set environment: 'node'");
  assert.ok(cfgText.includes("pool: 'threads'"), "vitest.config.ts must set pool: 'threads'");
  assert.ok(cfgText.includes("provider: 'v8'"), "vitest.config.ts must set coverage provider: 'v8'");
  assert.ok(cfgText.includes('json-summary'), 'vitest.config.ts must include json-summary coverage reporter');
  assert.ok(cfgText.includes('src/core/**/*.ts') && cfgText.includes('src/worker/**/*.ts'));

  // Confirm existing node:test files do not end in .vitest.ts
  const testsDir = path.join(ROOT_DIR, 'src', 'tests');
  const nodeTestFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.ts'));
  assert.ok(nodeTestFiles.length >= 6, `Expected >= 6 node:test .test.ts files, found ${nodeTestFiles.length}`);
  for (const f of nodeTestFiles) {
    assert.equal(f.endsWith('.vitest.ts'), false, `${f} must not collide with *.vitest.ts`);
  }
});

check('package.json defines test:fast, test:watch, test:coverage and .gitignore ignores coverage/', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:fast'], 'vitest run');
  assert.equal(pkg.scripts['test:watch'], 'vitest');
  assert.equal(pkg.scripts['test:coverage'], 'vitest run --coverage');
  assert.ok(pkg.devDependencies?.vitest, 'vitest must be in devDependencies');
  assert.ok(pkg.devDependencies?.['@vitest/coverage-v8'], '@vitest/coverage-v8 must be in devDependencies');

  const gitignore = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8');
  assert.ok(gitignore.split(/\r?\n/).some((line) => line.trim() === 'coverage/'), '.gitignore must ignore coverage/');
});

check('scripts/run_all_verifications.mjs supports serial: true phase after pool & registers 135 suites', () => {
  const runnerPath = path.join(ROOT_DIR, 'scripts', 'run_all_verifications.mjs');
  const runnerText = fs.readFileSync(runnerPath, 'utf8');

  for (const id of [
    'verify:upg03-lan-bridge-batch-cli',
    'verify:remed06-e2e-release',
    'verify:mac-phy-feedback',
    'verify:viewshed-accessibility',
  ]) {
    const line = runnerText.split('\n').find((l) => l.includes(`'${id}'`));
    assert.ok(line && line.includes('serial: true'), `${id} must be marked serial: true in REGISTERED_SUITES`);
  }

  assert.ok(runnerText.includes("id: 'verify:upg04-vitest-runner'"), 'Suite 135 must be registered in REGISTERED_SUITES');
  assert.ok(runnerText.includes('s.serial === true'), 'Runner must check s.serial === true');

  const phase1Idx = runnerText.indexOf('Phase 1: Execute parallelizable suites');
  const phase2Idx = runnerText.indexOf('Phase 2: Execute serial suites');
  assert.ok(phase1Idx !== -1 && phase2Idx !== -1 && phase1Idx < phase2Idx, 'Parallel pool must execute before serial phase');

  const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
  assert.ok(readme.includes('136'), 'README.md must document 136 suites');
  assert.ok(readme.includes('npm run test:fast') && readme.includes('npm run test:coverage'));
});

check('All 3 *.vitest.ts suites exist on disk', () => {
  const expectedFiles = [
    'src/tests/corePhysicsAndGeodesy.vitest.ts',
    'src/tests/macQosAndRecorder.vitest.ts',
    'src/tests/offlinePacksAndWasm.vitest.ts',
  ];
  for (const rel of expectedFiles) {
    const full = path.join(ROOT_DIR, rel);
    assert.equal(fs.existsSync(full), true, `Missing Vitest suite: ${rel}`);
    assert.ok(fs.statSync(full).size > 500, `Vitest suite ${rel} must be non-trivial`);
  }
});

if (process.env.STRATOS_VERIFY_ALL === '1') {
  console.log('  • Skipping nested vitest run inside run_all_verifications.mjs (validated directly via npm run test:fast)');
} else {
  check('npm run test:fast exits 0 in < 30s', () => {
    const t0 = performance.now();
    const out = execFileSync('npm', ['run', 'test:fast'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const elapsedS = (performance.now() - t0) / 1000;
    assert.ok(out.includes('3 passed'), `Expected 3 passed test files in vitest output:\n${out}`);
    assert.ok(elapsedS < 30.0, `npm run test:fast must finish in < 30s, took ${elapsedS.toFixed(2)}s`);
    console.log(`    (npm run test:fast completed in ${elapsedS.toFixed(2)}s)`);
  });
}

console.log(`\n  SUITE 135 SUMMARY: ${passed} checks passed, 0 failures.\n`);
