#!/usr/bin/env node
/**
 * scripts/run_all_verifications.mjs
 * Comprehensive Verification Runner for DRDO X-Band Digital Twin (Milestone M0.1)
 *
 * Executes every registered verification suite independently:
 * - Structural checks, static typechecking, and all 30 test suites.
 * - Records execution duration, exit status, and detailed diagnostics.
 * - Continues execution across individual failures.
 * - Supports configurable per-suite timeouts (--timeout <ms>).
 * - Generates machine-readable JSON reports and terminal summary tables.
 * - Exits with code 0 if all suites pass, or code 1 if any suite fails or times out.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

// -----------------------------------------------------------------------------
// CLI Argument Parsing
// -----------------------------------------------------------------------------
function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const timeoutMs = parseInt(getArg('--timeout', process.env.VERIFY_TIMEOUT_MS || '60000'), 10);
const suiteFilter = getArg('--suite', null);
const bailOnError = process.argv.includes('--bail');
const outputDir = resolve(process.cwd(), getArg('--out-dir', 'benchmark_results/generated'));

// -----------------------------------------------------------------------------
// Verification Suites Registry (58 Total Suites)
// -----------------------------------------------------------------------------
const viteNodeBin = resolve(process.cwd(), 'node_modules/.bin/vite-node');

const REGISTERED_SUITES = [
  { id: 'verify-project', name: 'Structural Project Verification', command: process.execPath, args: ['scripts/verify-project.mjs'], category: 'structural' },
  { id: 'typecheck', name: 'TypeScript Static Typecheck', command: 'npm', args: ['run', 'typecheck'], category: 'typecheck' },
  { id: 'verify:physics', name: 'Physical Propagation & Geodesy', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPhysics.ts'], category: 'physics' },
  { id: 'verify:scheduler', name: 'Scheduler & Queue Verification', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyScheduler.ts'], category: 'scheduler' },
  { id: 'verify:worker', name: 'Worker State & Commands', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyWorkerState.ts'], category: 'worker' },
  { id: 'verify:trajectory', name: 'Trajectory Modes & Kinematics', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTrajectoryModes.ts'], category: 'trajectory' },
  { id: 'verify:trajectory-editor', name: 'Trajectory Editor State', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTrajectoryEditor.ts'], category: 'editor' },
  { id: 'verify:obstacles', name: 'Artificial Obstacles Core', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyObstacles.ts'], category: 'obstacles' },
  { id: 'verify:obstacle-editor', name: 'Obstacle Editor UI State', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyObstacleEditor.ts'], category: 'editor' },
  { id: 'verify:profile-freshness', name: 'Link Profile Freshness & Cache', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyProfileFreshness.ts'], category: 'profile' },
  { id: 'verify:profile-viewport', name: 'Link Profile Viewport Navigation', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyProfileViewport.ts'], category: 'profile' },
  { id: 'verify:history', name: 'Historical Profile Storage', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHistoricalProfile.ts'], category: 'history' },
  { id: 'verify:history-scheduler', name: 'Historical Scheduler Records', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHistoricalScheduler.ts'], category: 'history' },
  { id: 'verify:history-timeline', name: 'Historical 60s Ring Buffer & Isolation', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHistoryTimeline60s.ts'], category: 'history' },
  { id: 'verify:link-classifier', name: 'Link Status Classifier', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyLinkClassifier.ts'], category: 'rf' },
  { id: 'verify:three-foundation', name: 'Three.js Scene Foundation & Context', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyThreeFoundation.ts'], category: 'three' },
  { id: 'verify:three-terrain', name: 'Three.js 3D Terrain Builder', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyThreeTerrain.ts'], category: 'three' },
  { id: 'verify:three-entities', name: 'Three.js 3D Tactical Entities', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyThreeEntities.ts'], category: 'three' },
  { id: 'verify:geodesy', name: 'Geodesy & Plate Carrée Coordinates', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyGeodesy.ts'], category: 'geodesy' },
  { id: 'verify:cursor-readout', name: 'Radar Cursor Geographic Readout', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyCursorReadout.ts'], category: 'ui' },
  { id: 'verify:scheduler-percentiles', name: 'Rolling Goodput Percentiles', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySchedulerPercentiles.ts'], category: 'scheduler' },
  { id: 'verify:path-profile-top-view', name: 'Path Profile Top-View Canvas', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPathProfileTopView.ts'], category: 'ui' },
  { id: 'verify:node-inventory', name: 'Node Inventory Geodetic Coordinates', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNodeInventoryCoordinates.ts'], category: 'ui' },
  { id: 'verify:data-comm', name: 'Data Comm & TDMA Visualization', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDataCommVisualization.ts'], category: 'ui' },
  { id: 'verify:physical-speed', name: 'Physical UAV Speed & Kinematics', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPhysicalSpeed.ts'], category: 'trajectory' },
  { id: 'verify:rf-bandwidth', name: 'RF Channel Bandwidth Scaling', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRfBandwidth.ts'], category: 'rf' },
  { id: 'verify:integration-hardening', name: 'Integration Hardening M6.3', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyIntegrationHardeningM63.ts'], category: 'integration' },
  { id: 'verify:node-agl', name: 'Configurable Ground-Node AGL', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNodeAglConfiguration.ts'], category: 'node' },
  { id: 'verify:dem-mapping', name: 'DEM Mapping & Coordinate Transforms', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDemMapping.ts'], category: 'terrain' },
  { id: 'verify:coverage-propagation', name: 'Terrain Coverage & RF Propagation', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyCoveragePropagation.ts'], category: 'terrain' },
  { id: 'verify:hillshade-bounds', name: 'Hillshade Bounds & Geographic Extent', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHillshadeBounds.ts'], category: 'terrain' },
  { id: 'verify:canvas-terrain', name: 'Canvas Terrain Rendering & Alignment', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyCanvasTerrain.ts'], category: 'terrain' },
  { id: 'verify:determinism', name: 'Determinism & State-Hash Trace (T1-T6)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDeterminismTrace.ts'], category: 'determinism' },
  { id: 'verify:acn-only', name: 'ACN Topology & Rename Invariants', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyAcnOnlyAndRename.ts'], category: 'node' },
  { id: 'verify:node-registry-m1a', name: 'Node Registry & Stable Identity (M1a)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNodeRegistryM1a.ts'], category: 'node' },
  { id: 'verify:node-lifecycle-mgr', name: 'Node Lifecycle Manager Unit Tests', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNodeLifecycleManager.ts'], category: 'node' },
  { id: 'verify:dynamic-nodes-m1b', name: 'Dynamic Ground-Node Management (M1b)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyDynamicNodesM1b.ts'], category: 'node' },
  { id: 'verify:per-node-config', name: 'Per-Node Power, Battery & AGL Config', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyPerNodeConfiguration.ts'], category: 'node' },
  { id: 'verify:registration', name: 'Node Network Registration FSM', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyRegistration.ts'], category: 'node' },
  { id: 'verify:hgt-mosaic', name: 'Multi-Tile SRTM HGT Mosaic Stitcher', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHgtMosaic.ts'], category: 'terrain' },
  { id: 'verify:hgt-terrain', name: 'HGT Terrain Buffer Ingestion', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyHgtTerrain.ts'], category: 'terrain' },
  { id: 'verify:single-hgt-centering', name: 'Single HGT Tile Centering & Origin', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySingleHgtCentering.ts'], category: 'terrain' },
  { id: 'verify:terrain-mesh-gen', name: '3D Terrain Mesh Data Generator', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTerrainMeshGenerator.ts'], category: 'three' },
  { id: 'verify:traffic-inventory', name: 'Traffic Inventory UI Backlog Tables', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNetworkTrafficInventory.ts'], category: 'ui' },
  { id: 'verify:network-dashboard', name: 'Network Performance Dashboard KPIs', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyNetworkPerformanceDashboard.ts'], category: 'ui' },
  { id: 'verify:sim-speed-controller', name: 'Kinematic Speed Controller Transitions', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySimulationSpeedController.ts'], category: 'trajectory' },
  { id: 'verify:variable-altitude', name: 'UAV Variable Altitude System (ALT-T1–T10)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyVariableAltitude.ts'], category: 'trajectory' },
  { id: 'verify:variable-tdma', name: 'Variable TDMA Frame System (TDMA-T1–T8)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyVariableTdma.ts'], category: 'tdma' },
  { id: 'verify:simulation-timeline', name: 'Simulation Timeline System (TL-CLK1–T16)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifySimulationTimeline.ts'], category: 'timeline' },
  { id: 'verify:timeline-e2e', name: 'Simulation Timeline Browser & Map E2E', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTimelineBrowserE2E.ts'], category: 'timeline' },
  { id: 'verify:lookahead-decoupling', name: 'M1 Predictive Lookahead Decoupling (T1–T8)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyLookaheadDecoupling.ts'], category: 'trajectory' },
  { id: 'verify:map-layers', name: 'Map Layer System & RF Overlays', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyMapLayerSystem.ts'], category: 'ui' },
  { id: 'verify:timeline-enhancement', name: 'Simulation Timeline Enhancement (TL-ENH-A1–M2)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTimelineEnhancement.ts'], category: 'timeline' },
  { id: 'verify:timeline-corrective', name: 'Simulation Timeline Corrective Fixes (REV14)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTimelineCorrective.ts'], category: 'timeline' },
  { id: 'verify:terrain-toolbox', name: 'Scientific Terrain Toolbox (SPEC-TERRAIN-TOOLBOX-SCI-01-REV2)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyTerrainToolboxSci.ts'], category: 'ui' },
  { id: 'verify:quad-antenna', name: 'Body-Fixed 4-Sector ACN Antenna Array (QSA-T1–T5)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyQuadSectorAntenna.ts'], category: 'antenna' },
  { id: 'verify:itu-physics', name: 'First-Principles ITU-R Physics & Terrain', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyItuFirstPrinciples.ts'], category: 'physics' },
  { id: 'verify:ablation', name: 'Diffraction Scheduling & Ablation Baseline (ABL-T1–T4)', command: process.execPath, args: [viteNodeBin, 'src/tests/verifyAblationAndDiffraction.ts'], category: 'scheduler' }
];

// -----------------------------------------------------------------------------
// Environment & Provenance Capture
// -----------------------------------------------------------------------------
function getProvenance() {
  let gitCommit = 'unknown';
  let gitBranch = 'unknown';
  let gitDirty = false;
  try {
    gitCommit = execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const status = execSync('git status --porcelain', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitDirty = status.length > 0;
  } catch (_) {}

  return {
    git_commit: gitCommit,
    git_branch: gitBranch,
    git_dirty: gitDirty,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu_model: os.cpus()[0]?.model ?? 'unknown',
    cpu_count: os.cpus().length,
    total_memory_bytes: os.totalmem(),
    free_memory_bytes: os.freemem(),
  };
}

// -----------------------------------------------------------------------------
// Suite Execution Runner
// -----------------------------------------------------------------------------
function runSuite(suite, timeout) {
  return new Promise((resolveResult) => {
    const startTime = performance.now();
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let timer = null;

    const child = spawn(suite.command, suite.args, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
      }, 2000).unref();
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = performance.now() - startTime;
      resolveResult({
        id: suite.id,
        name: suite.name,
        category: suite.category,
        command: `${suite.command} ${suite.args.join(' ')}`,
        status: 'EXEC_ERROR',
        exit_code: null,
        signal: null,
        duration_ms: Math.round(durationMs),
        error_message: err.message,
        stdout: stdoutData,
        stderr: stderrData,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const durationMs = performance.now() - startTime;

      let status = 'PASSED';
      let errorMessage = null;

      if (timedOut) {
        status = 'TIMEOUT';
        errorMessage = `Suite exceeded execution timeout of ${timeout} ms`;
      } else if (code !== 0) {
        status = 'FAILED';
        // Extract failure details from stderr or stdout tail
        const errorLines = stderrData.trim().split('\n').filter(Boolean);
        const stdoutLines = stdoutData.trim().split('\n').filter(Boolean);
        if (errorLines.length > 0) {
          errorMessage = errorLines.slice(-3).join(' | ');
        } else if (stdoutLines.length > 0) {
          const failLines = stdoutLines.filter(l => /error|fail|assert/i.test(l));
          errorMessage = failLines.length > 0
            ? failLines.slice(-3).join(' | ')
            : stdoutLines.slice(-2).join(' | ');
        } else {
          errorMessage = `Process exited with code ${code}`;
        }
      }

      resolveResult({
        id: suite.id,
        name: suite.name,
        category: suite.category,
        command: `${suite.command} ${suite.args.join(' ')}`,
        status,
        exit_code: code,
        signal,
        duration_ms: Math.round(durationMs),
        error_message: errorMessage,
        stdout: stdoutData,
        stderr: stderrData,
      });
    });
  });
}

// -----------------------------------------------------------------------------
// Terminal Output Formatting
// -----------------------------------------------------------------------------
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function formatStatus(status) {
  switch (status) {
    case 'PASSED':
      return `${ANSI.green}${ANSI.bold}PASS${ANSI.reset}`;
    case 'FAILED':
      return `${ANSI.red}${ANSI.bold}FAIL${ANSI.reset}`;
    case 'TIMEOUT':
      return `${ANSI.yellow}${ANSI.bold}TIME${ANSI.reset}`;
    case 'EXEC_ERROR':
      return `${ANSI.magenta}${ANSI.bold}ERR!${ANSI.reset}`;
    default:
      return status;
  }
}

// -----------------------------------------------------------------------------
// Main Execution
// -----------------------------------------------------------------------------
async function main() {
  const provenance = getProvenance();
  const suitesToRun = suiteFilter
    ? REGISTERED_SUITES.filter(s => s.id.includes(suiteFilter) || s.name.toLowerCase().includes(suiteFilter.toLowerCase()))
    : REGISTERED_SUITES;

  if (suitesToRun.length === 0) {
    console.error(`[!] No verification suites matched filter: "${suiteFilter}"`);
    process.exit(1);
  }

  console.log('='.repeat(92));
  console.log(`${ANSI.bold}   DRDO X-BAND DIGITAL TWIN // COMPREHENSIVE VERIFICATION RUNNER (M0.1)${ANSI.reset}`);
  console.log('='.repeat(92));
  console.log(` Commit   : ${provenance.git_commit.slice(0, 8)} (${provenance.git_branch}${provenance.git_dirty ? ', dirty' : ''})`);
  console.log(` Platform : ${provenance.platform} ${provenance.arch} | Node ${provenance.node_version} | ${provenance.cpu_count}x ${provenance.cpu_model}`);
  console.log(` Target   : ${suitesToRun.length} registered suites | Timeout: ${(timeoutMs / 1000).toFixed(1)}s per suite`);
  console.log('-'.repeat(92));

  const results = [];
  const overallStart = performance.now();

  for (let i = 0; i < suitesToRun.length; i++) {
    const suite = suitesToRun[i];
    const indexStr = `[${String(i + 1).padStart(2, ' ')}/${suitesToRun.length}]`;
    process.stdout.write(` ${indexStr} ${suite.id.padEnd(28)} `);

    const result = await runSuite(suite, timeoutMs);
    results.push(result);

    const durSec = (result.duration_ms / 1000).toFixed(2);
    console.log(`${formatStatus(result.status)} in ${durSec.padStart(5, ' ')}s  ${result.error_message ? `— ${ANSI.red}${result.error_message}${ANSI.reset}` : ''}`);

    if (bailOnError && result.status !== 'PASSED') {
      console.log(`\n[!] Bailing immediately after failure in suite: ${suite.id}`);
      break;
    }
  }

  const overallDurationMs = Math.round(performance.now() - overallStart);

  // Compute summary metrics
  const passed = results.filter(r => r.status === 'PASSED').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  const timeouts = results.filter(r => r.status === 'TIMEOUT').length;
  const execErrors = results.filter(r => r.status === 'EXEC_ERROR').length;
  const allPassed = passed === results.length;

  console.log('='.repeat(92));
  console.log(`${ANSI.bold}   VERIFICATION EXECUTION SUMMARY${ANSI.reset}`);
  console.log('-'.repeat(92));
  console.log(` Total Suites  : ${results.length}`);
  console.log(` Passed        : ${ANSI.green}${passed}${ANSI.reset} / ${results.length} (${((passed / results.length) * 100).toFixed(1)}%)`);
  if (failed > 0)     console.log(` Failed        : ${ANSI.red}${failed}${ANSI.reset}`);
  if (timeouts > 0)   console.log(` Timeouts      : ${ANSI.yellow}${timeouts}${ANSI.reset}`);
  if (execErrors > 0) console.log(` Exec Errors   : ${ANSI.magenta}${execErrors}${ANSI.reset}`);
  console.log(` Total Runtime : ${(overallDurationMs / 1000).toFixed(2)} seconds`);
  console.log('='.repeat(92));

  // Print failure details if any occurred
  if (!allPassed) {
    console.log(`\n${ANSI.bold}${ANSI.red}FAILED / UNSTABLE SUITE DIAGNOSTICS:${ANSI.reset}`);
    for (const res of results.filter(r => r.status !== 'PASSED')) {
      console.log(`\n[x] Suite: ${res.id} (${res.name})`);
      console.log(`    Status: ${res.status} | Exit Code: ${res.exit_code} | Duration: ${res.duration_ms}ms`);
      console.log(`    Command: ${res.command}`);
      if (res.error_message) {
        console.log(`    Detail: ${res.error_message}`);
      }
      if (res.stderr) {
        const stderrLines = res.stderr.trim().split('\n').slice(-10);
        console.log(`    Stderr (last 10 lines):`);
        for (const line of stderrLines) console.log(`      | ${line}`);
      }
    }
    console.log('');
  }

  // ---------------------------------------------------------------------------
  // JSON Report Export
  // ---------------------------------------------------------------------------
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = resolve(outputDir, `verification-report-${timestamp}.json`);
  const latestPath = resolve(outputDir, 'verification-report-latest.json');

  const reportPayload = {
    schema_version: '1.0.0',
    generated_at_utc: new Date().toISOString(),
    provenance,
    configuration: {
      timeout_per_suite_ms: timeoutMs,
      filter: suiteFilter,
      bail: bailOnError,
    },
    summary: {
      total_suites: results.length,
      passed,
      failed,
      timeouts,
      exec_errors: execErrors,
      all_passed: allPassed,
      total_duration_ms: overallDurationMs,
    },
    suites: results.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      command: r.command,
      status: r.status,
      exit_code: r.exit_code,
      signal: r.signal,
      duration_ms: r.duration_ms,
      error_message: r.error_message,
      stdout_preview: r.stdout.slice(0, 1024),
      stderr: r.stderr,
    })),
  };

  writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2), 'utf8');
  writeFileSync(latestPath, JSON.stringify(reportPayload, null, 2), 'utf8');

  console.log(`[+] Machine-readable report saved to:`);
  console.log(`    ${reportPath}`);
  console.log(`    ${latestPath}\n`);

  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[!] Fatal error in verification runner:', err);
  process.exit(1);
});
