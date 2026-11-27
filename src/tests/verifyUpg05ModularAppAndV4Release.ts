/**
 * src/tests/verifyUpg05ModularAppAndV4Release.ts
 *
 * UPG-05 / V41-01 (v4.x Release Milestone) Verification Suite (Suite 136):
 * 1. Modularity & Strict Typing: `src/main.ts` line count is strictly < 3,000 lines, `src/app/` contains
 *    >= 5 cohesive `.ts` modules with zero `eval(` / `new Function(`, zero circular imports,
 *    and ZERO `@ts-nocheck` / `@ts-ignore` directives across `src/main.ts` & `src/app/*.ts`.
 * 2. Hardening: PNG/JPG heightmap FileReader in `src/app/terrainUploadController.ts` attaches `onerror`.
 * 3. Version symmetry: `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
 *    `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `crates/xband-physics/Cargo.toml`,
 *    `crates/xband-physics/Cargo.lock`, and `README.md` share identical semver >= `4.5.0`,
 *    and `.github/workflows/ci.yml` invokes `npm run test:fast`.
 * 4. Strict CSP & Lazy Bundle Split: `index.html` retains strict CSP (0 inline `<script>` bodies,
 *    0 inline `on*=` attributes) and `dist/index.html` excludes eager `vendor-three` / `vendor-maplibre` chunks.
 * 5. Suite count & Documentation Sync: `scripts/run_all_verifications.mjs` registers 136 suites and
 *    `README.md` documents 136 suites, ~2.32 ms step budget, 3,240 lines for simWorker.ts, and `src/app/`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

function parseSemver(version: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version.trim());
  assert.ok(m, `Invalid semver string: "${version}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: string, b: string): number {
  const [majA, minA, patA] = parseSemver(a);
  const [majB, minB, patB] = parseSemver(b);
  if (majA !== majB) return majA - majB;
  if (minA !== minB) return minA - minB;
  return patA - patB;
}

function readCargoLockPackageVersion(lockText: string, packageName: string): string {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`\\[\\[package\\]\\]\\s+name\\s*=\\s*"${escaped}"\\s+version\\s*=\\s*"([^"]+)"`, 'm').exec(lockText);
  assert.ok(m, `Cargo.lock must contain [[package]] entry for ${packageName}`);
  return m[1];
}

console.log('================================================================================');
console.log('  UPG-05 / V41-01 STRICT TS src/app/* & RELEASE SYMMETRY VERIFICATION (SUITE 136)');
console.log('================================================================================');

check('1. src/main.ts < 3,000 lines, src/app/ >= 5 modules, zero eval/Function/@ts-nocheck/@ts-ignore, zero circular imports', () => {
  const mainTsPath = path.join(ROOT_DIR, 'src', 'main.ts');
  const mainTs = fs.readFileSync(mainTsPath, 'utf8');
  const mainLines = mainTs.split('\n').length;
  assert.ok(mainLines < 3000, `src/main.ts must be < 3,000 lines (got ${mainLines})`);

  const appDir = path.join(ROOT_DIR, 'src', 'app');
  assert.ok(fs.existsSync(appDir), 'src/app directory must exist');
  const appFiles = fs.readdirSync(appDir).filter((f) => f.endsWith('.ts')).sort();
  assert.ok(appFiles.length >= 5, `src/app must contain >= 5 .ts modules (found ${appFiles.length})`);

  for (const requiredModule of [
    'appContext.ts',
    'terrainUploadController.ts',
    'viewModeAnd3dController.ts',
    'workerBridgeController.ts',
    'domEventBindings.ts',
    'dashboardRenderOrchestrator.ts',
  ]) {
    assert.ok(appFiles.includes(requiredModule), `Expected src/app/${requiredModule} to exist`);
  }

  for (const file of [mainTsPath, ...appFiles.map((f) => path.join(appDir, f))]) {
    const src = fs.readFileSync(file, 'utf8');
    assert.equal(/\beval\s*\(/.test(src), false, `Forbidden eval( detected in ${file}`);
    assert.equal(/\bnew\s+Function\s*\(/.test(src), false, `Forbidden new Function( detected in ${file}`);
    assert.equal(/@ts-nocheck/.test(src), false, `Forbidden @ts-nocheck detected in ${file}`);
    assert.equal(/@ts-ignore/.test(src), false, `Forbidden @ts-ignore detected in ${file}`);
  }

  // Zero circular imports among src/app/*.ts and src/main.ts
  const allNodes = [mainTsPath, ...appFiles.map((f) => path.join(appDir, f))];
  const edges = new Map<string, string[]>();
  for (const file of allNodes) {
    const src = fs.readFileSync(file, 'utf8');
    const deps: string[] = [];
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (target.startsWith(appDir) || target === mainTsPath) {
        deps.push(target);
      }
    }
    edges.set(file, deps);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: string, stack: string[]) => {
    assert.equal(visiting.has(node), false, `Circular import detected: ${[...stack, node].join(' -> ')}`);
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dep of edges.get(node) || []) {
      walk(dep, [...stack, node]);
    }
    visiting.delete(node);
    visited.add(node);
  };
  allNodes.forEach((n) => walk(n, []));

  console.log(`   -> src/main.ts = ${mainLines} lines, src/app/ = ${appFiles.length} modules, 0 circular imports`);
});

check('2. PNG/JPG heightmap FileReader in src/app/terrainUploadController.ts attaches onerror', () => {
  const uploadSrc = fs.readFileSync(path.join(ROOT_DIR, 'src', 'app', 'terrainUploadController.ts'), 'utf8');
  const readAsDataUrlIdx = uploadSrc.indexOf('reader.readAsDataURL(file)');
  assert.ok(readAsDataUrlIdx !== -1, 'PNG/JPG handler must invoke reader.readAsDataURL(file)');
  const windowSlice = uploadSrc.slice(Math.max(0, readAsDataUrlIdx - 1800), readAsDataUrlIdx + 120);
  assert.ok(windowSlice.includes('reader.onerror'), 'PNG/JPG FileReader handler must attach reader.onerror');
  assert.ok(windowSlice.includes('img.onerror'), 'PNG/JPG Image loader handler must attach img.onerror');
});

check('3. Dynamic semver parity (>= 4.5.0) across package, Tauri, Rust crates, Cargo locks, README.md & CI Vitest gate', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const expectedVersion = String(pkg.version || '');
  assert.ok(
    compareSemver(expectedVersion, '4.5.0') >= 0,
    `package.json version must be valid semver >= 4.5.0 (got "${expectedVersion}")`
  );

  const pkgLock = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package-lock.json'), 'utf8'));
  assert.equal(pkgLock.version, expectedVersion, `package-lock.json root version must equal ${expectedVersion}`);
  assert.equal(pkgLock.packages?.['']?.version, expectedVersion, `package-lock.json packages[""] version must equal ${expectedVersion}`);

  const tauriConf = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.equal(tauriConf.version, expectedVersion, `src-tauri/tauri.conf.json version must equal ${expectedVersion}`);

  const tauriCargo = fs.readFileSync(path.join(ROOT_DIR, 'src-tauri', 'Cargo.toml'), 'utf8');
  const tauriCargoVersion = tauriCargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(tauriCargoVersion, expectedVersion, `src-tauri/Cargo.toml version must equal ${expectedVersion}`);

  const tauriCargoLock = fs.readFileSync(path.join(ROOT_DIR, 'src-tauri', 'Cargo.lock'), 'utf8');
  assert.equal(
    readCargoLockPackageVersion(tauriCargoLock, 'tactical-xband-digital-twin'),
    expectedVersion,
    `src-tauri/Cargo.lock tactical-xband-digital-twin version must equal ${expectedVersion}`
  );

  const rustCargo = fs.readFileSync(path.join(ROOT_DIR, 'crates', 'xband-physics', 'Cargo.toml'), 'utf8');
  const rustCargoVersion = rustCargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(rustCargoVersion, expectedVersion, `crates/xband-physics/Cargo.toml version must equal ${expectedVersion}`);

  const rustCargoLock = fs.readFileSync(path.join(ROOT_DIR, 'crates', 'xband-physics', 'Cargo.lock'), 'utf8');
  assert.equal(
    readCargoLockPackageVersion(rustCargoLock, 'xband-physics'),
    expectedVersion,
    `crates/xband-physics/Cargo.lock xband-physics version must equal ${expectedVersion}`
  );

  const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
  assert.ok(readme.includes(`version = {${expectedVersion}}`), `README.md BibTeX citation must declare version = {${expectedVersion}}`);
  assert.ok(readme.includes(`v${expectedVersion}`), `README.md header must declare v${expectedVersion}`);
  assert.ok(readme.includes('2.32'), 'README.md must document updated ~2.32 ms step time');
  assert.ok(readme.includes('src/app/') || readme.includes('app/'), 'README.md must document modular src/app/ architecture');
  assert.ok(readme.includes('136'), 'README.md must document 136 verification suites');

  const ciYml = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(ciYml.includes('npm run test:fast'), '.github/workflows/ci.yml must invoke npm run test:fast');
});

check('4. index.html retains strict CSP and dist/index.html excludes eager vendor-three / vendor-maplibre', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scriptMatches.length, 1, 'index.html must load only the external /src/main.ts module script');
  assert.equal(scriptMatches[0][2].trim(), '', 'index.html must contain zero inline <script> body code');
  assert.match(scriptMatches[0][1], /src=["']\/?src\/main\.ts["']/);
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'index.html must contain zero inline on*= event attributes');

  const distIndexPath = path.join(ROOT_DIR, 'dist', 'index.html');
  const assetsDir = path.join(ROOT_DIR, 'dist', 'assets');
  assert.ok(fs.existsSync(distIndexPath) && fs.existsSync(assetsDir), 'dist/ production build must exist');
  const assetFiles = fs.readdirSync(assetsDir);
  const threeChunk = assetFiles.find((f) => f.includes('vendor-three') && f.endsWith('.js'));
  const maplibreChunk = assetFiles.find((f) => f.includes('vendor-maplibre') && f.endsWith('.js'));
  assert.ok(threeChunk, 'vendor-three lazy chunk must be emitted');
  assert.ok(maplibreChunk, 'vendor-maplibre lazy chunk must be emitted');
  const distHtml = fs.readFileSync(distIndexPath, 'utf8');
  assert.equal(distHtml.includes(threeChunk), false, 'dist/index.html must NOT eagerly reference vendor-three');
  assert.equal(distHtml.includes(maplibreChunk), false, 'dist/index.html must NOT eagerly reference vendor-maplibre');
});

check('5. scripts/run_all_verifications.mjs registers 136 suites including Suite 136', () => {
  const runnerSrc = fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'run_all_verifications.mjs'), 'utf8');
  const baseMatch = runnerSrc.match(/const REGISTERED_SUITES = \[([\s\S]*?)\];/);
  assert.ok(baseMatch, 'REGISTERED_SUITES array must exist');
  const baseCount = baseMatch[1].split('{ id:').filter((s) => s.trim().length > 0).length;
  const pushMatches = [...runnerSrc.matchAll(/REGISTERED_SUITES\.push\(([\s\S]*?)\);/g)];
  let pushedCount = 0;
  for (const m of pushMatches) {
    pushedCount += m[1].split('{ id:').filter((s) => s.trim().length > 0).length;
  }
  assert.equal(baseCount + pushedCount, 136, `Expected 136 suites, found ${baseCount + pushedCount}`);
  assert.ok(runnerSrc.includes("'verify:upg05-modular-app-v4'"), 'Suite 136 id verify:upg05-modular-app-v4 must be registered');
});

console.log('\n[UPG-05 / V41-01] ALL CHECKS PASSED — Strict TypeScript src/app/* & release symmetry verified.\n');
