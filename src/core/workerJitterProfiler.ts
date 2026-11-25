/**
 * Tactical X-Band Air-to-Ground Network Digital Twin
 * 50 Hz Web Worker Real-Time Jitter Profiler & Reproducible Research Dossier Exporter
 *
 * Implements:
 * 1. 50 Hz discrete-event step latency profiling with nearest-rank percentiles (p50, p90, p95, p99, max, mean).
 * 2. Real-Time Deadline Headroom Margin (%) against 20.0 ms discrete-event budget.
 * 3. RFC 3550 Smoothed Inter-Frame Pacing Jitter filter.
 * 4. 8-Bin Execution Latency Histogram with strict probability conservation (sum(fraction) == 1.0).
 * 5. Real-Time Certification Verdicts ('HARD_RT_CERTIFIED' | 'SOFT_RT_WARNING' | 'DEADLINE_OVERRUN').
 * 6. Reproducible Experiment Dossier Generator exporting publication-ready Markdown and IEEE Transactions LaTeX tables.
 */

export const REAL_TIME_BUDGET_MS = 20.0;
export const HARD_RT_P95_THRESHOLD_MS = 15.0;
export const RFC3550_SMOOTHING_FACTOR = 16.0;

export const LATENCY_HISTOGRAM_EDGES = [0, 2, 4, 6, 8, 10, 14, 18, Number.POSITIVE_INFINITY] as const;
export const LATENCY_HISTOGRAM_LABELS = [
  '0–2ms',
  '2–4ms',
  '4–6ms',
  '6–8ms',
  '8–10ms',
  '10–14ms',
  '14–18ms',
  '18–20ms+',
] as const;

export type RealTimeVerdict = 'HARD_RT_CERTIFIED' | 'SOFT_RT_WARNING' | 'DEADLINE_OVERRUN';

export interface HistogramBin {
  readonly binIndex: number;
  readonly label: string;
  readonly minMs: number;
  readonly maxMs: number;
  readonly count: number;
  readonly fraction: number;
}

export interface WorkerRealTimeProfileReport {
  readonly sampleCount: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly headroomPct: number;
  readonly rfc3550JitterMs: number;
  readonly histogramBins: readonly HistogramBin[];
  readonly deadlineOverrunCount: number;
  readonly realTimeVerdict: RealTimeVerdict;
}

export interface ExperimentDossierSnapshot {
  readonly simTimeS: number;
  readonly frameIndex: number;
  readonly staticGoodputMbps: number;
  readonly reactiveGoodputMbps: number;
  readonly tacGoodputMbps: number;
  readonly staticDrops: number;
  readonly reactiveDrops: number;
  readonly tacDrops: number;
  readonly staticUtilPct: number;
  readonly reactiveUtilPct: number;
  readonly tacUtilPct: number;
  readonly demErrorM: number;
  readonly trafficScale: number;
  readonly jammerEnabled: boolean;
  readonly activeRelayEnabled: boolean;
  readonly ricianEnabled: boolean;
  readonly earthRadiusFactorK: number;
  readonly rtProfile: WorkerRealTimeProfileReport;
}

/**
 * Computes nearest-rank percentile for an already sorted numeric array.
 * rank = min(n, max(1, ceil(k * n)))
 */
export function computeNearestRankPercentile(sortedSamples: readonly number[], k: number): number {
  const n = sortedSamples.length;
  if (n === 0) return 0.0;
  if (!Number.isFinite(k) || k < 0.0 || k > 1.0) {
    throw new RangeError(`Percentile k must be in [0.0, 1.0], got ${k}`);
  }
  const rank = Math.min(n, Math.max(1, Math.ceil(k * n)));
  return sortedSamples[rank - 1];
}

/**
 * Evaluates 50 Hz discrete-event execution profile over a collection of step samples.
 *
 * @param stepSamplesMs Array of step execution durations in milliseconds (nominal budget = 20.0 ms)
 * @param interFrameDeltasMs Optional array of inter-frame intervals or deviations
 * @returns Comprehensive WorkerRealTimeProfileReport
 */
export function evaluateWorkerRealTimeProfile(
  stepSamplesMs: readonly number[],
  interFrameDeltasMs?: readonly number[]
): WorkerRealTimeProfileReport {
  const validSamples = stepSamplesMs.filter(Number.isFinite);
  const n = validSamples.length;

  if (n === 0) {
    const emptyBins: HistogramBin[] = LATENCY_HISTOGRAM_LABELS.map((label, idx) => ({
      binIndex: idx,
      label,
      minMs: LATENCY_HISTOGRAM_EDGES[idx],
      maxMs: LATENCY_HISTOGRAM_EDGES[idx + 1],
      count: 0,
      fraction: 0.0,
    }));

    return {
      sampleCount: 0,
      p50Ms: 0.0,
      p90Ms: 0.0,
      p95Ms: 0.0,
      p99Ms: 0.0,
      maxMs: 0.0,
      meanMs: 0.0,
      headroomPct: 100.0,
      rfc3550JitterMs: 0.0,
      histogramBins: emptyBins,
      deadlineOverrunCount: 0,
      realTimeVerdict: 'HARD_RT_CERTIFIED',
    };
  }

  // Sort ascending for nearest-rank percentiles
  const sorted = [...validSamples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0.0);
  const meanMs = sum / n;
  const maxMs = sorted[n - 1];

  const p50Ms = computeNearestRankPercentile(sorted, 0.50);
  const p90Ms = computeNearestRankPercentile(sorted, 0.90);
  const p95Ms = computeNearestRankPercentile(sorted, 0.95);
  const p99Ms = computeNearestRankPercentile(sorted, 0.99);

  // Real-Time Deadline Headroom Margin (%)
  // M_headroom = clamp_[0, 100]((1.0 - p95 / 20.0) * 100.0)
  const rawHeadroom = (1.0 - p95Ms / REAL_TIME_BUDGET_MS) * 100.0;
  const headroomPct = Math.min(100.0, Math.max(0.0, rawHeadroom));

  // RFC 3550 Smoothed Jitter:
  // - With explicit inter-frame pacing deltas: D_k = |dt_k - 20.0|
  // - Fallback when interFrameDeltasMs is omitted/empty: consecutive step-execution delta |step[i] - step[i-1]|
  const pacingDeltas = interFrameDeltasMs
    ? interFrameDeltasMs.filter(Number.isFinite)
    : [];

  let rfc3550JitterMs = 0.0;
  if (pacingDeltas.length > 0) {
    for (const dt of pacingDeltas) {
      const D = Math.abs(dt - REAL_TIME_BUDGET_MS);
      rfc3550JitterMs += (D - rfc3550JitterMs) / RFC3550_SMOOTHING_FACTOR;
    }
  } else if (validSamples.length >= 2) {
    for (let i = 1; i < validSamples.length; i++) {
      const D = Math.abs(validSamples[i] - validSamples[i - 1]);
      rfc3550JitterMs += (D - rfc3550JitterMs) / RFC3550_SMOOTHING_FACTOR;
    }
  }

  // 8-Bin Latency Histogram & Overrun Tracking
  const counts = new Array<number>(8).fill(0);
  let deadlineOverrunCount = 0;

  for (const sample of validSamples) {
    if (sample > REAL_TIME_BUDGET_MS) {
      deadlineOverrunCount++;
    }

    if (sample < 2.0) {
      counts[0]++;
    } else if (sample < 4.0) {
      counts[1]++;
    } else if (sample < 6.0) {
      counts[2]++;
    } else if (sample < 8.0) {
      counts[3]++;
    } else if (sample < 10.0) {
      counts[4]++;
    } else if (sample < 14.0) {
      counts[5]++;
    } else if (sample < 18.0) {
      counts[6]++;
    } else {
      counts[7]++;
    }
  }

  const histogramBins: HistogramBin[] = counts.map((count, idx) => ({
    binIndex: idx,
    label: LATENCY_HISTOGRAM_LABELS[idx],
    minMs: LATENCY_HISTOGRAM_EDGES[idx],
    maxMs: LATENCY_HISTOGRAM_EDGES[idx + 1],
    count,
    fraction: count / n,
  }));

  // Real-Time Verdict
  let realTimeVerdict: RealTimeVerdict;
  if (deadlineOverrunCount > 0) {
    realTimeVerdict = 'DEADLINE_OVERRUN';
  } else if (p95Ms <= HARD_RT_P95_THRESHOLD_MS) {
    realTimeVerdict = 'HARD_RT_CERTIFIED';
  } else {
    realTimeVerdict = 'SOFT_RT_WARNING';
  }

  return {
    sampleCount: n,
    p50Ms,
    p90Ms,
    p95Ms,
    p99Ms,
    maxMs,
    meanMs,
    headroomPct,
    rfc3550JitterMs,
    histogramBins,
    deadlineOverrunCount,
    realTimeVerdict,
  };
}

/**
 * Formats 3-Way Ablation Benchmark results as an IEEE Transactions booktabs LaTeX tabular block.
 */
export function formatDossierLatexTable(snapshot: ExperimentDossierSnapshot): string {
  const {
    staticGoodputMbps,
    reactiveGoodputMbps,
    tacGoodputMbps,
    staticDrops,
    reactiveDrops,
    tacDrops,
    staticUtilPct,
    reactiveUtilPct,
    tacUtilPct,
    frameIndex,
    simTimeS,
    demErrorM,
    trafficScale,
    earthRadiusFactorK,
  } = snapshot;

  return `\\begin{table}[htbp]
\\centering
\\caption{Tactical X-Band Air-to-Ground Relay Network: 3-Way Lockstep MAC Scheduler Ablation}
\\label{tab:tactical_relay_ablation}
\\begin{tabular}{l ccc}
\\toprule
\\textbf{Scheduler Architecture} & \\textbf{Goodput (Mbps)} & \\textbf{Airtime Util (\\%)} & \\textbf{Packet Drops} \\\\
\\midrule
Legacy Static TDMA & ${staticGoodputMbps.toFixed(2)} & ${staticUtilPct.toFixed(1)} & ${staticDrops} \\\\
Reactive M-LWDF ($\\Phi_{\\text{evac}} = 1.0$) & ${reactiveGoodputMbps.toFixed(2)} & ${reactiveUtilPct.toFixed(1)} & ${reactiveDrops} \\\\
Predictive Tac-TAD ($\\Phi_{\\text{evac}} \\ge 1.0$) & ${tacGoodputMbps.toFixed(2)} & ${tacUtilPct.toFixed(1)} & ${tacDrops} \\\\
\\bottomrule
\\end{tabular}
\\vspace{1ex}
{\\footnotesize \\raggedright \\textbf{Provenance:} Simulation Frame \\#${frameIndex} ($t = ${simTimeS.toFixed(2)}\\text{ s}$). DEM error $\\sigma = ${demErrorM.toFixed(1)}\\text{ m}$, Traffic scale $k_{\\text{traffic}} = ${trafficScale.toFixed(2)}\\times$, Effective Earth radius factor $K = ${earthRadiusFactorK.toFixed(2)}.\\par}
\\end{table}`;
}

/**
 * Generates a publication-ready Markdown and LaTeX Reproducible Experiment Dossier.
 */
export function generateExperimentDossierMarkdown(snapshot: ExperimentDossierSnapshot): string {
  const {
    simTimeS,
    frameIndex,
    staticGoodputMbps,
    reactiveGoodputMbps,
    tacGoodputMbps,
    staticDrops,
    reactiveDrops,
    tacDrops,
    staticUtilPct,
    reactiveUtilPct,
    tacUtilPct,
    demErrorM,
    trafficScale,
    jammerEnabled,
    activeRelayEnabled,
    ricianEnabled,
    earthRadiusFactorK,
    rtProfile,
  } = snapshot;

  const dropDeltaReactive = staticDrops > 0
    ? `${(((reactiveDrops - staticDrops) / staticDrops) * 100).toFixed(1)}%`
    : '0.0%';
  const dropDeltaTac = staticDrops > 0
    ? `${(((tacDrops - staticDrops) / staticDrops) * 100).toFixed(1)}%`
    : '0.0%';

  const latexBlock = formatDossierLatexTable(snapshot);

  return `# DRDO Tactical X-Band Digital Twin — Reproducible Experiment Dossier

- **Timestamp / Snapshot Horizon**: Frame #${frameIndex} ($t = ${simTimeS.toFixed(2)}\\text{ s}$)
- **Sector / Location**: Ladakh Sector ($34.5000^\\circ\\text{N}, 76.5000^\\circ\\text{E}$)
- **Authoritative Runtime**: Background Web Worker (50 Hz / 20.0 ms Discrete-Event Loop)

---

## 1. Theater & ITU-R / 3GPP Physical Configuration Provenance

| Parameter | Value | Standard / Mathematical Model |
|---|---|---|
| **Carrier Frequency** | 8.0 GHz (X-Band) | ITU-R P.526-15 Multi-Knife-Edge Diffraction |
| **Topography & Elevation** | 512x512 AWS Terrarium Ladakh DEM (~360 m x 434 m/px; native SRTM1/SRTM3 .hgt import supported) | Ladakh Alpine Complex Relief |
| **DEM Lookahead Uncertainty** | $\\sigma_{\\text{DEM}} = ${demErrorM.toFixed(1)}\\text{ m}$ | Zero-Mean Gaussian Perturbation |
| **Traffic Multiplier** | ${trafficScale.toFixed(2)}$\\times | 3GPP TS 23.501 5QI Multi-Bearer Traffic |
| **Atmospheric Refractivity Factor** | $K = ${earthRadiusFactorK.toFixed(3)}$ | ITU-R P.834-9 Effective Earth Radius ($4/3$ Standard) |
| **Electronic Warfare Contested Jammer** | ${jammerEnabled ? 'ENABLED' : 'DISABLED'} | 40 dBW ERP Inverse-Square Interference |
| **Active 2-Hop Tactical Ridge Relay** | ${activeRelayEnabled ? 'ENABLED' : 'DISABLED'} | Harmonic Capacity $R_{\\text{DF}} = \\frac{R_1 R_2}{R_1 + R_2}$ |
| **Small-Scale Multipath Fading** | ${ricianEnabled ? 'ENABLED' : 'DISABLED'} | 3GPP TR 38.811 Elevation-Dependent Rician Synthesis |

---

## 2. 3-Way Lockstep MAC Scheduler Ablation Results

| Scheduler Architecture | Goodput (Mbps) | Airtime Util (%) | Packet Drops | Drop Delta vs Static |
|---|---|---|---|---|
| **Legacy Static TDMA** | ${staticGoodputMbps.toFixed(2)} | ${staticUtilPct.toFixed(1)}% | ${staticDrops} | Baseline |
| **Reactive M-LWDF** | ${reactiveGoodputMbps.toFixed(2)} | ${reactiveUtilPct.toFixed(1)}% | ${reactiveDrops} | ${dropDeltaReactive} |
| **Predictive Tac-TAD** | ${tacGoodputMbps.toFixed(2)} | ${tacUtilPct.toFixed(1)}% | ${tacDrops} | ${dropDeltaTac} |

---

## 3. IEEE Transactions LaTeX Table (\`booktabs\`)

\`\`\`latex
${latexBlock}
\`\`\`

---

## 4. 50 Hz Real-Time Discrete-Event Engine Certification

- **Discrete-Event Time Budget**: $20.00\\text{ ms}$ (50 Hz Target Cadence)
- **Observed Step Execution Latency**:
  - Median ($p_{50}$): ${rtProfile.p50Ms.toFixed(2)} ms
  - 90th Percentile ($p_{90}$): ${rtProfile.p90Ms.toFixed(2)} ms
  - 95th Percentile ($p_{95}$): ${rtProfile.p95Ms.toFixed(2)} ms
  - 99th Percentile ($p_{99}$): ${rtProfile.p99Ms.toFixed(2)} ms
  - Maximum Step ($\max$): ${rtProfile.maxMs.toFixed(2)} ms
  - Sample Mean ($\\mu$): ${rtProfile.meanMs.toFixed(2)} ms
- **Real-Time Deadline Headroom Margin**: **${rtProfile.headroomPct.toFixed(1)}%**
- **RFC 3550 Smoothed Inter-Frame Pacing Jitter**: ${rtProfile.rfc3550JitterMs.toFixed(2)} ms
- **Deadline Overruns ($> 20.0\\text{ ms}$)**: ${rtProfile.deadlineOverrunCount}
- **Certification Verdict**: **${rtProfile.realTimeVerdict}**
`;
}
