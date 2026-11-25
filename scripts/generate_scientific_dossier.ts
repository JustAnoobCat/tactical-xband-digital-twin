/**
 * scripts/generate_scientific_dossier.ts
 *
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Deterministic Publication-Grade Scientific Dossier & CSV Generator (V2-02)
 *
 * Executes:
 * 1. verifyAllItuReferenceAnchors() for analytical ITU-R and WGS-84 cross-validation.
 * 2. runPhysicsRealismAblation(30, 20261122) for the Controlled 4-Point Synthetic Link-Layer Physics Micro-Benchmark (N=30 paired seeds).
 * 3. Writes benchmark_results/scientific_ablation_n30.csv via formatAblationCsv.
 * 4. Idempotently inserts/updates delimited section in benchmark_results/BENCHMARK_DOSSIER.md:
 *    <!-- BEGIN_WP11_SCIENTIFIC_VALIDATION --> ... <!-- END_WP11_SCIENTIFIC_VALIDATION -->
 *
 * Invariants:
 * - 100% deterministic (base seed = 20261122, SplitMix32 PRNG).
 * - Zero Math.random().
 * - Zero emojis.
 * - Idempotent across multiple runs (second run produces zero git diff).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  runPhysicsRealismAblation,
  verifyAllItuReferenceAnchors,
  formatAblationCsv,
  buildScientificValidationMarkdown,
} from '../src/core/statisticalBenchmarkEngine';

export const BEGIN_DELIMITER = '<!-- BEGIN_WP11_SCIENTIFIC_VALIDATION -->';
export const END_DELIMITER = '<!-- END_WP11_SCIENTIFIC_VALIDATION -->';

export function generateScientificDossierFiles(): {
  csvPath: string;
  dossierPath: string;
  numSeeds: number;
  baseSeed: number;
} {
  const rootDir = process.cwd();
  const resultsDir = resolve(rootDir, 'benchmark_results');
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const numSeeds = 30;
  const baseSeed = 20261122;

  console.log('[SCIENTIFIC DOSSIER] Running ITU-R reference validation...');
  const ituAnchors = verifyAllItuReferenceAnchors();
  if (!ituAnchors.allPassed) {
    throw new Error('ITU-R reference cross-validation failed');
  }
  console.log('  ITU-R validation passed: P.525, P.526-15, P.676-13, P.838-3, WGS-84 Vincenty.');

  console.log(`[SCIENTIFIC DOSSIER] Executing Controlled 4-Point Synthetic Link-Layer Physics Micro-Benchmark (N=${numSeeds} paired seeds, baseSeed=${baseSeed})...`);
  const ablationResult = runPhysicsRealismAblation(numSeeds, baseSeed);
  console.log(`  Ablation executed across 4 configurations in ${ablationResult.durationMs} ms.`);

  // 1. Export CSV
  const csvContent = formatAblationCsv(ablationResult);
  const csvPath = resolve(resultsDir, 'scientific_ablation_n30.csv');
  writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`  Exported: ${csvPath}`);

  // 2. Generate and update Markdown Dossier
  const validationMd = buildScientificValidationMarkdown(ablationResult, ituAnchors);
  const dossierPath = resolve(resultsDir, 'BENCHMARK_DOSSIER.md');

  let dossierContent = '';
  if (existsSync(dossierPath)) {
    dossierContent = readFileSync(dossierPath, 'utf-8');
  }

  const delimitedBlock = `${BEGIN_DELIMITER}\n\n${validationMd}\n\n${END_DELIMITER}`;

  let updatedDossier: string;
  const beginIdx = dossierContent.indexOf(BEGIN_DELIMITER);
  const endIdx = dossierContent.indexOf(END_DELIMITER);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx >= beginIdx) {
    const before = dossierContent.slice(0, beginIdx);
    const after = dossierContent.slice(endIdx + END_DELIMITER.length);
    updatedDossier = before + delimitedBlock + after;
  } else {
    updatedDossier = dossierContent.trimEnd() + '\n\n---\n\n' + delimitedBlock + '\n';
  }

  writeFileSync(dossierPath, updatedDossier, 'utf-8');
  console.log(`  Updated: ${dossierPath} (idempotent delimited section)`);

  return {
    csvPath,
    dossierPath,
    numSeeds,
    baseSeed,
  };
}

// Run directly when executed as CLI
const isMainModule = Boolean(
  (process.argv[1] && (
    process.argv[1].endsWith('generate_scientific_dossier.ts') ||
    process.argv[1].endsWith('generate_scientific_dossier.js')
  )) ||
  process.argv.some(arg => arg.includes('generate_scientific_dossier') && !arg.includes('verify')) ||
  Boolean(process.env.npm_lifecycle_script?.includes('generate_scientific_dossier') || process.env.npm_lifecycle_event === 'benchmark:scientific')
);

if (isMainModule) {
  console.log('='.repeat(80));
  console.log('TACTICAL X-BAND DIGITAL TWIN - SCIENTIFIC DOSSIER GENERATOR');
  console.log('='.repeat(80));
  generateScientificDossierFiles();
  console.log('='.repeat(80));
  console.log('SCIENTIFIC DOSSIER GENERATION COMPLETE');
  console.log('='.repeat(80));
}
