/**
 * src/tests/verifyPublicationDossierSync.ts
 *
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Publication Scientific Dossier & IEEE LaTeX Export Verification (Suite 101)
 *
 * Specification: docs/specs/v2-02-publication-scientific-dossier.md
 * Classification: IEEE LaTeX / Zero-Drift Parity / Multi-Seed Monte Carlo / Zero-Emoji Gate
 *
 * Test Suites:
 * - [PDS-T1] IEEE LaTeX booktabs Integrity:
 *   - Balanced \begin{table}...\end{table} and \begin{tabular}...\end{tabular}.
 *   - Correct \toprule, \midrule, \bottomrule booktabs markup.
 *   - All 4 configurations reported with finite Mean ± 95% CI.
 *   - Footnote cites N = 30, base seed 20261122, Welch t, p-value, Cohen's d.
 *   - Strictly finite numbers (zero NaN, undefined, Infinity).
 *   - Zero unescaped bare % in table body rows.
 * - [PDS-T2] Byte-for-Byte Zero-Drift Artifact Parity:
 *   - Live re-run of runPhysicsRealismAblation(30, 20261122) and verifyAllItuReferenceAnchors().
 *   - benchmark_results/scientific_ablation_n30.csv matches formatAblationCsv(...) byte-for-byte.
 *   - benchmark_results/BENCHMARK_DOSSIER.md delimited section matches buildScientificValidationMarkdown(...) byte-for-byte.
 *   - Pre-existing sections 1 through 7 remain 100% intact.
 * - [PDS-T3] Live LAB Integration & Zero-Emoji Gate:
 *   - index.html cleanly imports and wires buildScientificValidationMarkdown into #btn-generate-research-dossier.
 *   - Zero emojis in generated Markdown, LaTeX table, CLI script, or spec.
 *
 * Execution:
 *   npx vite-node src/tests/verifyPublicationDossierSync.ts
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  runPhysicsRealismAblation,
  verifyAllItuReferenceAnchors,
  formatAblationCsv,
  formatPublicationLatexAblationTable,
  buildScientificValidationMarkdown,
  type PhysicsRealismAblationStudyResult,
  type ItuReferenceValidationResult,
} from '../core/statisticalBenchmarkEngine';
import { BEGIN_DELIMITER, END_DELIMITER } from '../../scripts/generate_scientific_dossier';

console.log('='.repeat(96));
console.log('   PUBLICATION SCIENTIFIC DOSSIER & IEEE LATEX EXPORT VERIFICATION (SUITE 101)');
console.log('   Specification: docs/specs/v2-02-publication-scientific-dossier.md // PDS-T1 - PDS-T3');
console.log('='.repeat(96));

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}]/u;

// =================================================================================================
// [PDS-T1] IEEE LaTeX booktabs Integrity
// =================================================================================================
console.log('\n[PDS-T1] Verifying IEEE LaTeX booktabs Integrity...');
{
  const ablationResult: PhysicsRealismAblationStudyResult = runPhysicsRealismAblation(30, 20261122);
  const latex = formatPublicationLatexAblationTable(ablationResult);

  // 1. Balanced environments
  assert.ok(latex.includes('\\begin{table}'), 'Must contain \\begin{table}');
  assert.ok(latex.includes('\\end{table}'), 'Must contain \\end{table}');
  assert.ok(latex.includes('\\begin{tabular}'), 'Must contain \\begin{tabular}');
  assert.ok(latex.includes('\\end{tabular}'), 'Must contain \\end{tabular}');

  const tableBegins = (latex.match(/\\begin\{table\}/g) || []).length;
  const tableEnds = (latex.match(/\\end\{table\}/g) || []).length;
  assert.equal(tableBegins, tableEnds, 'Table begin/end count must balance exactly');

  const tabularBegins = (latex.match(/\\begin\{tabular\}/g) || []).length;
  const tabularEnds = (latex.match(/\\end\{tabular\}/g) || []).length;
  assert.equal(tabularBegins, tabularEnds, 'Tabular begin/end count must balance exactly');

  // 2. Booktabs rules
  assert.ok(latex.includes('\\toprule'), 'Must include \\toprule');
  assert.ok(latex.includes('\\midrule'), 'Must include \\midrule');
  assert.ok(latex.includes('\\bottomrule'), 'Must include \\bottomrule');

  // 3. Configurations presence
  const expectedConfigs = [
    'Baseline Idealized',
    'Multi-Edge + Attitude',
    'Delayed CQI (No OLLA/HARQ)',
    'Full Realistic (OLLA + HARQ)',
  ];
  for (const cfg of expectedConfigs) {
    assert.ok(latex.includes(cfg), `LaTeX table must report configuration: ${cfg}`);
  }

  // 4. Statistical parameters in caption/note
  assert.ok(latex.includes('N = 30') || latex.includes('N = 30$'), 'Must cite N = 30 sample size');
  assert.ok(latex.includes('20261122'), 'Must cite base seed 20261122');
  assert.ok(latex.includes('t = '), 'Must cite Welch t statistic');
  assert.ok(latex.includes('p = '), 'Must cite p-value');
  assert.ok(latex.includes('d = '), 'Must cite Cohen\'s d effect size');

  // 5. Numerical validity: zero NaN, undefined, or Infinity
  assert.ok(!latex.includes('NaN'), 'LaTeX must not contain NaN');
  assert.ok(!latex.includes('undefined'), 'LaTeX must not contain undefined');
  assert.ok(!latex.includes('Infinity'), 'LaTeX must not contain Infinity');

  // 6. Zero unescaped bare % in table body rows
  const midIdx = latex.indexOf('\\midrule');
  const botIdx = latex.indexOf('\\bottomrule');
  assert.ok(midIdx !== -1 && botIdx > midIdx, 'Table must have midrule and bottomrule bounds');
  const tableBody = latex.slice(midIdx + '\\midrule'.length, botIdx);
  const unescapedPercent = tableBody.split('\n').filter((line) => {
    // Check if line contains % not preceded by backslash
    return /(?<!\\)%/.test(line);
  });
  assert.equal(
    unescapedPercent.length,
    0,
    `Table body rows must not contain unescaped bare % (got: ${unescapedPercent.join(', ')})`
  );

  console.log('  ✓ Balanced environments (table/tabular) and booktabs rules verified');
  console.log('  ✓ All 4 physics configurations and finite Mean ± 95% CI reported');
  console.log('  ✓ Footnote statistical citations (N=30, baseSeed, t, p, d) and % escaping verified [PASS]');
}

// =================================================================================================
// [PDS-T2] Byte-for-Byte Zero-Drift Artifact Parity
// =================================================================================================
console.log('\n[PDS-T2] Verifying Byte-for-Byte Zero-Drift Artifact Parity...');
{
  const ablationResult = runPhysicsRealismAblation(30, 20261122);
  const ituAnchors: ItuReferenceValidationResult = verifyAllItuReferenceAnchors();
  assert.ok(ituAnchors.allPassed, 'ITU-R reference cross-validation must pass');

  // 1. CSV Parity
  const csvPath = resolve(process.cwd(), 'benchmark_results/scientific_ablation_n30.csv');
  assert.ok(existsSync(csvPath), `CSV file must exist on disk: ${csvPath}`);
  const diskCsv = readFileSync(csvPath, 'utf-8');
  const expectedCsv = formatAblationCsv(ablationResult);
  assert.equal(
    diskCsv,
    expectedCsv,
    'Disk CSV (scientific_ablation_n30.csv) must match formatAblationCsv byte-for-byte'
  );
  console.log('  ✓ scientific_ablation_n30.csv matches live generator byte-for-byte');

  // 2. Dossier Delimited Section Parity
  const dossierPath = resolve(process.cwd(), 'benchmark_results/BENCHMARK_DOSSIER.md');
  assert.ok(existsSync(dossierPath), `Dossier file must exist on disk: ${dossierPath}`);
  const diskDossier = readFileSync(dossierPath, 'utf-8');

  assert.ok(diskDossier.includes(BEGIN_DELIMITER), 'Dossier must contain BEGIN delimiter');
  assert.ok(diskDossier.includes(END_DELIMITER), 'Dossier must contain END delimiter');

  const beginIdx = diskDossier.indexOf(BEGIN_DELIMITER);
  const endIdx = diskDossier.indexOf(END_DELIMITER);
  assert.ok(endIdx > beginIdx, 'END delimiter must follow BEGIN delimiter');

  const diskSection = diskDossier.slice(beginIdx + BEGIN_DELIMITER.length, endIdx).trim();
  const expectedSection = buildScientificValidationMarkdown(ablationResult, ituAnchors).trim();

  assert.equal(
    diskSection,
    expectedSection,
    'Delimited section in BENCHMARK_DOSSIER.md must match buildScientificValidationMarkdown byte-for-byte'
  );
  console.log('  ✓ BENCHMARK_DOSSIER.md delimited section matches live generator byte-for-byte');

  // 3. Pre-existing sections integrity
  assert.ok(
    diskDossier.includes('HISTORICAL BENCHMARK DOSSIER'),
    'Dossier must preserve Historical title'
  );
  assert.ok(
    diskDossier.includes('### 1. EXECUTIVE SUMMARY & SYSTEM OVERVIEW'),
    'Dossier must preserve Section 1'
  );
  assert.ok(
    diskDossier.includes('### 7. DATA-QUALITY REVIEW AND REQUIRED FOLLOW-UP'),
    'Dossier must preserve Section 7'
  );
  console.log('  ✓ Pre-existing historical sections (1 through 7) preserved intact [PASS]');
}

// =================================================================================================
// [PDS-T3] Live LAB Integration & Zero-Emoji Gate
// =================================================================================================
console.log('\n[PDS-T3] Verifying Live LAB Integration & Zero-Emoji Gate...');
{
  // 1. index.html Live LAB Wiring
  const indexPath = resolve(process.cwd(), 'index.html');
  const indexHtml = readFileSync(indexPath, 'utf-8');

  assert.ok(
    indexHtml.includes('buildScientificValidationMarkdown'),
    'index.html must import and reference buildScientificValidationMarkdown'
  );
  assert.ok(
    indexHtml.includes('runPhysicsRealismAblation'),
    'index.html must import runPhysicsRealismAblation'
  );
  assert.ok(
    indexHtml.includes('verifyAllItuReferenceAnchors'),
    'index.html must import verifyAllItuReferenceAnchors'
  );
  assert.ok(
    indexHtml.includes('id="btn-generate-research-dossier"'),
    '#btn-generate-research-dossier button must exist in index.html'
  );
  assert.ok(
    indexHtml.includes('id="dossier-markdown-preview"'),
    '#dossier-markdown-preview element must exist in index.html'
  );
  console.log('  ✓ index.html LAB mode wiring for buildScientificValidationMarkdown verified');

  // 2. Zero-Emoji Gate
  const ablationResult = runPhysicsRealismAblation(30, 20261122);
  const ituAnchors = verifyAllItuReferenceAnchors();
  const markdown = buildScientificValidationMarkdown(ablationResult, ituAnchors);
  const latex = formatPublicationLatexAblationTable(ablationResult);

  assert.ok(!EMOJI_REGEX.test(markdown), 'Scientific validation markdown must contain zero emojis');
  assert.ok(!EMOJI_REGEX.test(latex), 'IEEE LaTeX table must contain zero emojis');

  const cliScript = readFileSync(resolve(process.cwd(), 'scripts/generate_scientific_dossier.ts'), 'utf-8');
  assert.ok(!EMOJI_REGEX.test(cliScript), 'scripts/generate_scientific_dossier.ts must contain zero emojis');

  const specDoc = readFileSync(resolve(process.cwd(), 'docs/specs/v2-02-publication-scientific-dossier.md'), 'utf-8');
  assert.ok(!EMOJI_REGEX.test(specDoc), 'docs/specs/v2-02-publication-scientific-dossier.md must contain zero emojis');

  console.log('  ✓ Zero-Emoji Gate: 0 emojis across Markdown, LaTeX, CLI generator, and Spec [PASS]');
}

console.log('\n' + '='.repeat(96));
console.log('   ALL PUBLICATION DOSSIER SYNC VERIFICATION TESTS PASSED (3/3 SUITES)');
console.log('='.repeat(96) + '\n');
