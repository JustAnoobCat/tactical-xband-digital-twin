/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * Multi-Core Headless TDMA / 5QI Monte Carlo Batch CLI
 *
 * Usage:
 *   npx tsx scripts/stratos_cli.ts --seeds 8 --duration 1.0 --workers 4 --biome alpine_mountain --out out.csv
 *   npm run cli:batch -- --seeds 4 --duration 0.4 --workers 2 --json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { THEATER_BIOMES, type BiomeId } from '../src/core/biomePhysics';
import {
  aggregateBatchResults,
  formatBatchCsv,
  runSingleHeadlessTrial,
  type HeadlessTrialOptions,
  type HeadlessTrialResult,
} from '../src/core/batchSimulationRunner';
import type { CliWorkerOutboundMessage } from './stratos_cli_worker';

interface ParsedCliArgs {
  seeds: number[];
  durationS: number;
  workers: number;
  biomeId?: BiomeId;
  rainRateMmH?: number;
  jammerEnabled?: boolean;
  enableRicianFading?: boolean;
  enableAirframeShadowing?: boolean;
  scenarioJson?: string;
  outCsvPath?: string;
  jsonOutput: boolean;
  help: boolean;
}

function getArgValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  if (next === undefined || next.startsWith('--')) {
    throw new Error(`Flag ${flag} requires a value`);
  }
  return next;
}

function parseSeedsSpec(raw: string): number[] {
  if (raw.includes(',')) {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      throw new Error('--seeds list cannot be empty');
    }
    return parts.map((p) => {
      const n = Number(p);
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new Error(`Invalid seed value '${p}' (expected non-negative integer)`);
      }
      return n;
    });
  }

  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`--seeds count must be a positive integer, got '${raw}'`);
  }
  return Array.from({ length: count }, (_, idx) => idx + 1);
}

function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const help = argv.includes('--help') || argv.includes('-h');
  const jsonOutput = argv.includes('--json');

  const seedsRaw = getArgValue(argv, '--seeds') ?? '4';
  const seeds = parseSeedsSpec(seedsRaw);

  const durationRaw = getArgValue(argv, '--duration') ?? '1.0';
  const durationS = Number(durationRaw);
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`--duration must be > 0, got '${durationRaw}'`);
  }

  const defaultWorkers = Math.max(1, Math.min(os.cpus().length || 1, seeds.length));
  const workersRaw = getArgValue(argv, '--workers');
  const workers = workersRaw !== undefined ? Number(workersRaw) : defaultWorkers;
  if (!Number.isSafeInteger(workers) || workers <= 0) {
    throw new Error(`--workers must be a positive integer, got '${workersRaw}'`);
  }

  const biomeRaw = getArgValue(argv, '--biome');
  let biomeId: BiomeId | undefined;
  if (biomeRaw !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(THEATER_BIOMES, biomeRaw)) {
      throw new Error(
        `Invalid --biome '${biomeRaw}'. Valid biomes: ${Object.keys(THEATER_BIOMES).join(', ')}`
      );
    }
    biomeId = biomeRaw as BiomeId;
  }

  const rainRaw = getArgValue(argv, '--rain');
  let rainRateMmH: number | undefined;
  if (rainRaw !== undefined) {
    rainRateMmH = Number(rainRaw);
    if (!Number.isFinite(rainRateMmH) || rainRateMmH < 0) {
      throw new Error(`--rain must be a non-negative finite number, got '${rainRaw}'`);
    }
  }

  const jammerEnabled = argv.includes('--jammer') ? true : undefined;
  const enableRicianFading = argv.includes('--rician') ? true : undefined;
  const enableAirframeShadowing = argv.includes('--airframe-shadowing') ? true : undefined;

  const scenarioPath = getArgValue(argv, '--scenario');
  let scenarioJson: string | undefined;
  if (scenarioPath !== undefined) {
    scenarioJson = readFileSync(resolve(process.cwd(), scenarioPath), 'utf8');
  }

  const outCsvPath = getArgValue(argv, '--out');

  return {
    seeds,
    durationS,
    workers,
    biomeId,
    rainRateMmH,
    jammerEnabled,
    enableRicianFading,
    enableAirframeShadowing,
    scenarioJson,
    outCsvPath,
    jsonOutput,
    help,
  };
}

function sanitizeWorkerExecArgv(execArgv: readonly string[]): string[] {
  const sanitized: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i];
    if (arg === '--require' || arg === '-r' || arg === '--import' || arg === '--loader' || arg === '--experimental-loader') {
      const next = execArgv[i + 1];
      if (next !== undefined) {
        sanitized.push(arg, next);
        i++;
      }
      continue;
    }
    if (arg.startsWith('--import=') || arg.startsWith('--require=') || arg.startsWith('--loader=')) {
      sanitized.push(arg);
      continue;
    }
    if (arg === '--eval' || arg === '-e' || arg === '--print' || arg === '-p') {
      i++;
      continue;
    }
  }
  return sanitized;
}

async function runTrialsInWorkerPool(
  tasks: readonly HeadlessTrialOptions[],
  workerCount: number
): Promise<HeadlessTrialResult[]> {
  if (workerCount <= 1 || tasks.length <= 1) {
    return tasks.map((task) => runSingleHeadlessTrial(task));
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const workerEntryUrl = new URL('./stratos_cli_worker.ts', `file://${currentDir}/`);
  const execArgv = sanitizeWorkerExecArgv(process.execArgv);
  const poolSize = Math.min(workerCount, tasks.length);

  return new Promise<HeadlessTrialResult[]>((resolvePool, rejectPool) => {
    const results: HeadlessTrialResult[] = [];
    const queue = [...tasks];
    const activeWorkers = new Set<Worker>();
    let settled = false;

    const failAll = (err: Error) => {
      if (settled) return;
      settled = true;
      for (const w of activeWorkers) {
        void w.terminate();
      }
      rejectPool(err);
    };

    const dispatchNext = (worker: Worker) => {
      if (settled) return;
      const nextTask = queue.shift();
      if (!nextTask) {
        worker.postMessage({ type: 'SHUTDOWN' });
        return;
      }
      worker.postMessage({ type: 'RUN_TRIAL', options: nextTask });
    };

    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(workerEntryUrl, { execArgv });
      activeWorkers.add(worker);

      worker.on('message', (msg: CliWorkerOutboundMessage) => {
        if (settled) return;
        if (msg.type === 'TRIAL_DONE') {
          results.push(msg.result);
          if (results.length === tasks.length) {
            settled = true;
            for (const w of activeWorkers) {
              w.postMessage({ type: 'SHUTDOWN' });
            }
            resolvePool(results);
            return;
          }
          dispatchNext(worker);
        } else if (msg.type === 'TRIAL_ERROR') {
          failAll(new Error(`Worker trial seed=${msg.seed} failed: ${msg.error}`));
        }
      });

      worker.on('error', (err) => {
        failAll(err instanceof Error ? err : new Error(String(err)));
      });

      worker.on('exit', (code) => {
        activeWorkers.delete(worker);
        if (!settled && code !== 0) {
          failAll(new Error(`Worker exited unexpectedly with code ${code}`));
        }
      });

      dispatchNext(worker);
    }
  });
}

function printUsage(): void {
  console.log(`Tactical X-Band Digital Twin — Headless Monte Carlo Batch CLI

Usage:
  npx tsx scripts/stratos_cli.ts [options]

Options:
  --seeds <N | s1,s2,...>  Number of sequential seeds (1..N) or comma list (default: 4)
  --duration <sec>         Simulation duration per trial at 50 Hz (default: 1.0)
  --workers <W>            Number of Node worker_threads (default: min(CPU cores, seeds))
  --biome <id>             Theater biome (${Object.keys(THEATER_BIOMES).join(', ')})
  --rain <mmh>             Uniform rain rate in mm/h
  --jammer                 Enable EW standoff jammer
  --rician                 Enable 3GPP TR 38.811 correlated Rician fading
  --airframe-shadowing     Enable aircraft body-frame roll shadowing
  --scenario <path>        Path to MissionScenarioV3 JSON file
  --out <csvPath>          Write deterministic seed-sorted CSV results to path
  --json                   Emit machine-readable JSON { summary, trials } on stdout
  -h, --help               Show this help message`);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const tasks: HeadlessTrialOptions[] = args.seeds.map((seed) => ({
    seed,
    durationS: args.durationS,
    ...(args.biomeId !== undefined ? { biomeId: args.biomeId } : {}),
    ...(args.rainRateMmH !== undefined ? { rainRateMmH: args.rainRateMmH } : {}),
    ...(args.jammerEnabled !== undefined ? { jammerEnabled: args.jammerEnabled } : {}),
    ...(args.enableRicianFading !== undefined ? { enableRicianFading: args.enableRicianFading } : {}),
    ...(args.enableAirframeShadowing !== undefined
      ? { enableAirframeShadowing: args.enableAirframeShadowing }
      : {}),
    ...(args.scenarioJson !== undefined ? { scenarioJson: args.scenarioJson } : {}),
  }));

  const rawTrials = await runTrialsInWorkerPool(tasks, args.workers);
  const trials = [...rawTrials].sort((a, b) => a.seed - b.seed);
  const summary = aggregateBatchResults(trials);

  if (args.outCsvPath) {
    const resolvedOut = resolve(process.cwd(), args.outCsvPath);
    mkdirSync(dirname(resolvedOut), { recursive: true });
    writeFileSync(resolvedOut, formatBatchCsv(trials), 'utf8');
  }

  if (args.jsonOutput) {
    process.stdout.write(JSON.stringify({ summary, trials }, null, 2) + '\n');
    return;
  }

  console.log('='.repeat(88));
  console.log(
    `  STRATOS HEADLESS MONTE CARLO BATCH (N=${summary.trialCount}, workers=${Math.min(args.workers, tasks.length)}, biome=${summary.biomeId}, ticks=${summary.ticksPerTrial})`
  );
  console.log('='.repeat(88));
  console.log(
    `  Tac-TAD Goodput : ${summary.tacGoodputMbps.mean.toFixed(3)} +/- ${summary.tacGoodputMbps.ci95HalfWidth.toFixed(3)} Mbps (95% CI)`
  );
  console.log(
    `  Reactive Goodput: ${summary.reactiveGoodputMbps.mean.toFixed(3)} +/- ${summary.reactiveGoodputMbps.ci95HalfWidth.toFixed(3)} Mbps`
  );
  console.log(
    `  Static Goodput  : ${summary.staticGoodputMbps.mean.toFixed(3)} +/- ${summary.staticGoodputMbps.ci95HalfWidth.toFixed(3)} Mbps`
  );
  console.log(
    `  Tac/Static Gain : ${summary.tacVsStaticGainRatio.mean.toFixed(3)}x (std=${summary.tacVsStaticGainRatio.std.toFixed(3)})`
  );
  console.log(
    `  Mean SNR / Out  : ${summary.meanSnrDb.mean.toFixed(2)} dB | Outage ${summary.outageRatioPct.mean.toFixed(2)}%`
  );
  for (const t of trials) {
    console.log(
      `    seed=${t.seed} digest=${t.finalStateDigestHex} tac=${t.tacGoodputMbps.toFixed(3)}Mbps static=${t.staticGoodputMbps.toFixed(3)}Mbps drop=${t.tacDropRatePct.toFixed(2)}% (${t.elapsedMs.toFixed(1)}ms)`
    );
  }
  if (args.outCsvPath) {
    console.log(`  CSV written to  : ${resolve(process.cwd(), args.outCsvPath)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
