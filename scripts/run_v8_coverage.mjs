#!/usr/bin/env node
/**
 * scripts/run_v8_coverage.mjs
 * Zero-dependency native Node.js V8 Code Coverage Reporter for Tactical X-Band Digital Twin
 *
 * Runs a representative high-performance core engine test batch under NODE_V8_COVERAGE,
 * parses native V8 function and byte-range coverage records across src/core/*.ts,
 * outputs a clean console summary table, and writes structured JSON to:
 * benchmark_results/generated/v8-coverage-summary.json
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_BATCH = [
  'src/tests/verifyWgs84Geodesy.ts',
  'src/tests/verifyMultiEdgeDiffraction.ts',
  'src/tests/verifyAttitudeAndChannelDynamics.ts',
  'src/tests/verifyMacPhyFeedback.ts',
  'src/tests/verifyKinematicPathfinder.ts',
  'src/tests/verifyMultiBiomePhysics.ts',
  'src/tests/verifyClosedLoopMacTransport.ts',
  'src/tests/verifyEwEccmAndLpi.ts',
  'src/tests/verifyConstellationAndMobility.ts',
  'src/tests/verifyDigitalTwinCalibration.ts',
  'src/tests/verifyMilitaryGisAndPersistence.ts',
  'src/tests/verifyScientificBenchmarkRigor.ts',
];

async function main() {
  const coverageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xband-v8-cov-'));
  console.log(`\n================================================================================`);
  console.log(`  TACTICAL DIGITAL TWIN — NATIVE NODE V8 COVERAGE COLLECTOR`);
  console.log(`  Executing 12 core test suites under NODE_V8_COVERAGE...`);
  console.log(`================================================================================\n`);

  const tStart = performance.now();

  try {
    for (const testRelPath of TEST_BATCH) {
      const fullPath = path.resolve(ROOT_DIR, testRelPath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Verification test suite missing: ${testRelPath}`);
      }
      const t0 = performance.now();
      execFileSync('npx', ['tsx', fullPath], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          NODE_V8_COVERAGE: coverageDir,
        },
        stdio: 'pipe',
      });
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      console.log(`  ✓ ${path.basename(testRelPath).padEnd(40)} [${elapsed}s]`);
    }

    const coreDir = path.resolve(ROOT_DIR, 'src/core');
    const allCoreFiles = fs
      .readdirSync(coreDir)
      .filter(f => f.endsWith('.ts'))
      .sort();

    const rawFiles = fs.readdirSync(coverageDir).filter(f => f.endsWith('.json'));
    const fileCoverageMap = new Map();

    for (const covFile of rawFiles) {
      try {
        const rawContent = fs.readFileSync(path.join(coverageDir, covFile), 'utf8');
        const parsed = JSON.parse(rawContent);
        for (const entry of parsed.result || []) {
          if (!entry.url || !entry.url.includes('/src/core/')) continue;
          const fileName = path.basename(entry.url);
          if (!allCoreFiles.includes(fileName)) continue;
          if (!fileCoverageMap.has(fileName)) {
            fileCoverageMap.set(fileName, []);
          }
          fileCoverageMap.get(fileName).push(entry);
        }
      } catch (err) {
        console.warn(`[v8-coverage] Warning: Failed to parse ${covFile}:`, err.message);
      }
    }

    const fileReports = [];
    let grandFunctionsTotal = 0;
    let grandFunctionsCovered = 0;
    let grandRangesTotal = 0;
    let grandRangesCovered = 0;

    for (const fileName of allCoreFiles) {
      const entries = fileCoverageMap.get(fileName) || [];
      if (entries.length === 0) {
        fileReports.push({
          file: fileName,
          exercised: false,
          functionsTotal: 0,
          functionsCovered: 0,
          functionCoveragePct: 0.0,
          rangesTotal: 0,
          rangesCovered: 0,
          rangeCoveragePct: 0.0,
        });
        continue;
      }

      const funcMap = new Map();

      for (const entry of entries) {
        for (const fn of entry.functions || []) {
          const outerRange = fn.ranges?.[0];
          if (!outerRange) continue;
          const fnKey = `${fn.functionName || '<anonymous>'}:${outerRange.startOffset}:${outerRange.endOffset}`;
          let rec = funcMap.get(fnKey);
          if (!rec) {
            rec = { covered: false, ranges: new Map() };
            funcMap.set(fnKey, rec);
          }
          if (outerRange.count > 0) {
            rec.covered = true;
          }
          for (const rng of fn.ranges) {
            const rngKey = `${rng.startOffset}:${rng.endOffset}`;
            const prev = rec.ranges.get(rngKey) || false;
            rec.ranges.set(rngKey, prev || rng.count > 0);
          }
        }
      }

      const functionsTotal = funcMap.size;
      let functionsCovered = 0;
      let rangesTotal = 0;
      let rangesCovered = 0;

      for (const rec of funcMap.values()) {
        if (rec.covered) functionsCovered++;
        for (const isCov of rec.ranges.values()) {
          rangesTotal++;
          if (isCov) rangesCovered++;
        }
      }

      grandFunctionsTotal += functionsTotal;
      grandFunctionsCovered += functionsCovered;
      grandRangesTotal += rangesTotal;
      grandRangesCovered += rangesCovered;

      const functionCoveragePct = functionsTotal > 0 ? Number(((functionsCovered / functionsTotal) * 100).toFixed(2)) : 0.0;
      const rangeCoveragePct = rangesTotal > 0 ? Number(((rangesCovered / rangesTotal) * 100).toFixed(2)) : 0.0;

      fileReports.push({
        file: fileName,
        exercised: true,
        functionsTotal,
        functionsCovered,
        functionCoveragePct,
        rangesTotal,
        rangesCovered,
        rangeCoveragePct,
      });
    }

    const aggregateFunctionCoveragePct = grandFunctionsTotal > 0
      ? Number(((grandFunctionsCovered / grandFunctionsTotal) * 100).toFixed(2))
      : 0.0;
    const aggregateRangeCoveragePct = grandRangesTotal > 0
      ? Number(((grandRangesCovered / grandRangesTotal) * 100).toFixed(2))
      : 0.0;

    console.log(`\n================================================================================`);
    console.log(`  TACTICAL DIGITAL TWIN — CORE ENGINE V8 COVERAGE MATRIX`);
    console.log(`================================================================================`);
    console.log(`${'Core Engine File'.padEnd(38)} | ${'Functions (%)'.padStart(16)} | ${'Ranges (%)'.padStart(16)}`);
    console.log('-'.repeat(80));

    for (const r of fileReports) {
      const fnStr = r.exercised
        ? `${r.functionCoveragePct.toFixed(1)}% (${r.functionsCovered}/${r.functionsTotal})`
        : '--';
      const rngStr = r.exercised
        ? `${r.rangeCoveragePct.toFixed(1)}% (${r.rangesCovered}/${r.rangesTotal})`
        : '--';
      console.log(`${r.file.padEnd(38)} | ${fnStr.padStart(16)} | ${rngStr.padStart(16)}`);
    }

    console.log('-'.repeat(80));
    console.log(
      `${'AGGREGATE (ALL EXERCISED CORE)'.padEnd(38)} | ${(
        aggregateFunctionCoveragePct.toFixed(1) + '%'
      ).padStart(16)} | ${(aggregateRangeCoveragePct.toFixed(1) + '%').padStart(16)}`
    );
    console.log(`================================================================================`);

    const summaryPayload = {
      timestamp: new Date().toISOString(),
      durationMs: Number((performance.now() - tStart).toFixed(2)),
      testBatch: TEST_BATCH,
      summary: {
        totalCoreFiles: allCoreFiles.length,
        exercisedCoreFiles: fileReports.filter(f => f.exercised).length,
        totalFunctions: grandFunctionsTotal,
        coveredFunctions: grandFunctionsCovered,
        aggregateFunctionCoveragePct,
        totalRanges: grandRangesTotal,
        coveredRanges: grandRangesCovered,
        aggregateRangeCoveragePct,
      },
      files: fileReports,
    };

    const outDir = path.resolve(ROOT_DIR, 'benchmark_results/generated');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outFile = path.join(outDir, 'v8-coverage-summary.json');
    fs.writeFileSync(outFile, JSON.stringify(summaryPayload, null, 2), 'utf8');
    console.log(`\n[v8-coverage] Report successfully generated: ${path.relative(ROOT_DIR, outFile)}\n`);
  } finally {
    if (fs.existsSync(coverageDir)) {
      fs.rmSync(coverageDir, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  console.error('[v8-coverage] ERROR:', err);
  process.exit(1);
});
