# V2-02: Publication-Grade N = 30 Multi-Seed Scientific Dossier, Live LAB IEEE LaTeX Export & Zero-Drift CLI Generator

**Specification Identifier:** `SPEC-V2-02-PUBLICATION-SCIENTIFIC-DOSSIER`  
**Milestone:** V2-02 (Frontier Milestone 2)  
**Parent Framework:** `AGENTS.md` (Scientific Rigor & Determinism Invariants)  
**Status:** **APPROVED FOR IMPLEMENTATION**  

---

## 1. Executive Summary & Purpose

Work Package 11 (`src/core/statisticalBenchmarkEngine.ts`, Suite 95) proved rigorous mathematical foundations:
1. Exact Sample Summary Statistics & Two-Tailed 95% Student-t Confidence Intervals.
2. Welch's Two-Sample t-Test with Welch-Satterthwaite degrees of freedom, Lentz Incomplete Beta p-value, and Cohen's d effect size.
3. Deterministic Multi-Seed Monte Carlo Engine (SplitMix32 PRNG, zero `Math.random()`).
4. 4-Configuration Physics-Realism Ablation isolating diffraction, attitude bank, CQI lag, and OLLA/HARQ.
5. Published ITU-R reference anchors (ITU-R P.525 Friis FSPL, P.526-15 knife-edge, P.838-3 rain, P.676-13 gaseous absorption, and WGS-84 Vincenty geodesy).

However, the existing `benchmark_results/BENCHMARK_DOSSIER.md` remains an archival snapshot from the legacy Python prototype (`2026-10-22`), which lacks authoritative TypeScript replication, multi-seed statistical coverage, and publishable IEEE Transactions LaTeX tables.

**Objective of V2-02:**
1. Author pure, functional formatters in `src/core/statisticalBenchmarkEngine.ts`:
   - `formatPublicationLatexAblationTable(result: PhysicsRealismAblationStudyResult): string`: Generates publication-ready IEEE Transactions `booktabs` LaTeX code.
   - `buildScientificValidationMarkdown(result: PhysicsRealismAblationStudyResult, ituAnchors: ItuReferenceValidationResult): string`: Generates defense-grade Markdown containing external ITU-R validation, $N = 30$ ablation metrics, Welch hypothesis tests, and embedded LaTeX tables.
2. Provide a reproducible, deterministic CLI generator `scripts/generate_scientific_dossier.ts` that executes $N = 30$ runs (base seed `20261122`), writes `benchmark_results/scientific_ablation_n30.csv`, and idempotently replaces the delimited validation section inside `benchmark_results/BENCHMARK_DOSSIER.md` (`<!-- BEGIN_WP11_SCIENTIFIC_VALIDATION -->` ... `<!-- END_WP11_SCIENTIFIC_VALIDATION -->`) without altering pre-existing legacy documentation.
3. Wire live $N = 30$ scientific dossier generation into `#btn-generate-research-dossier` in `index.html` under the `LAB` mode tab, maintaining 100% backward compatibility with `verifyWorkerJitterAndDossierUpgrade.ts`.
4. Establish **Suite 101** (`src/tests/verifyPublicationDossierSync.ts`) ensuring byte-for-byte zero-drift parity between code outputs and filesystem artifacts.

---

## 2. Mathematical Formulation & Output Schemas

### 2.1 Physics-Realism Ablation Configurations

The 4 discrete ablation configurations isolate physical and protocol degradation mechanisms over an identical trajectory ($N = 30$ independent runs, base seed $S_0 = 20261122$, 200 frames per run):

| Config ID | Label | Model Composition |
| :--- | :--- | :--- |
| `baseline-idealized` | Baseline Idealized | Single-edge diffraction, genie AMC, no bank shadowing |
| `multiedge-attitude` | Multi-Edge + Attitude | Cascaded Deygout multi-edge + 3D airframe bank shadowing + genie AMC |
| `delayed-cqi-unprotected` | Delayed CQI (No OLLA/HARQ) | Multi-edge + 3D bank shadowing + 2-frame CQI lag, no OLLA, no HARQ |
| `full-realistic-olla-harq` | Full Realistic (OLLA + HARQ) | Multi-edge + bank shadowing + 2-frame lag + OLLA + RTT HARQ CC + dynamic guard |

### 2.2 IEEE Transactions LaTeX `booktabs` Table Schema

The function `formatPublicationLatexAblationTable` emits compile-ready IEEE LaTeX source conforming to:
```latex
\begin{table}[t]
\centering
\caption{Physics-Realism Ablation Study ($N = 30$ Independent Monte Carlo Seeds, Base Seed: 20261122)}
\label{tab:physics_ablation_ladakh}
\begin{tabular}{lcccc}
\toprule
\textbf{Configuration} & \textbf{Goodput Factor} & \textbf{Residual BLER} & \textbf{Outage Ratio} & \textbf{Mean SNR [dB]} \\
\midrule
Baseline Idealized & $g_{\text{mean}} \pm g_{\text{moe}}$ & $b_{\text{mean}} \pm b_{\text{moe}}$ & $o_{\text{mean}} \pm o_{\text{moe}}$ & $s_{\text{mean}} \pm s_{\text{moe}}$ \\
Multi-Edge + Attitude & $...$ & $...$ & $...$ & $...$ \\
Delayed CQI (No OLLA/HARQ) & $...$ & $...$ & $...$ & $...$ \\
Full Realistic (OLLA + HARQ) & $...$ & $...$ & $...$ & $...$ \\
\bottomrule
\end{tabular}
\vspace{1ex}
\begin{minipage}{\columnwidth}
\footnotesize
\textit{Note:} Values denote sample mean $\pm$ 95\% Student-$t$ confidence interval.
Welch's two-sample $t$-test indicates that idealized baseline models significantly overestimate effective goodput compared to the full realistic stack ($\Delta = +..., t = ..., \text{df} = ..., p < 0.01, d = ...$).
Closed-loop OLLA + HARQ Chase Combining significantly suppresses residual BLER against uncompensated delayed CQI ($\Delta = -..., t = ..., \text{df} = ..., p < 0.01, d = ...$).
\end{minipage}
\end{table}
```

Rules:
1. Zero `NaN`, `undefined`, or `Infinity`.
2. All percentages or special characters escaped properly (`\%`, `\_`).
3. Precision: Goodput Factor, BLER, Outage Ratio formatted to 3 decimal places (`0.000`); SNR formatted to 2 decimal places (`0.00`).
4. Strict LaTeX environment matching (`\begin{table}` ... `\end{table}`, `\begin{tabular}` ... `\end{tabular}`).

### 2.3 Scientific CSV Export Schema

`benchmark_results/scientific_ablation_n30.csv`:
```csv
config_id,config_label,goodput_mean,goodput_ci95_half,bler_mean,bler_ci95_half,outage_mean,outage_ci95_half,snr_mean,snr_ci95_half
baseline-idealized,"Baseline Idealized",0.89204,0.00845,0.00000,0.00000,0.00000,0.00000,28.4521,0.3120
multiedge-attitude,"Multi-Edge + Attitude",0.74120,0.01021,0.00000,0.00000,0.02150,0.00412,21.8412,0.4210
delayed-cqi-unprotected,"Delayed CQI (No OLLA/HARQ)",0.51230,0.01240,0.14210,0.00910,0.02150,0.00412,21.8412,0.4210
full-realistic-olla-harq,"Full Realistic (OLLA + HARQ)",0.46820,0.01180,0.01820,0.00340,0.02150,0.00412,21.8412,0.4210
```

### 2.4 Idempotent Markdown Delimiter Protocol

The target file `benchmark_results/BENCHMARK_DOSSIER.md` contains historical legacy sections (1 through 7) that must remain strictly preserved.
The deterministic section is delimited by exact HTML comment tags:
```markdown
<!-- BEGIN_WP11_SCIENTIFIC_VALIDATION -->
... generated Markdown content ...
<!-- END_WP11_SCIENTIFIC_VALIDATION -->
```
If the delimiter tags are absent, the script appends the section to the end of the file. If present, the generator cleanly replaces the text between the tags, guaranteeing idempotency across repeated CLI runs.

---

## 3. Parity & Zero-Drift Contract

1. **Deterministic Execution:**
   - Both the CLI script (`scripts/generate_scientific_dossier.ts`) and Suite 101 (`src/tests/verifyPublicationDossierSync.ts`) invoke `runPhysicsRealismAblation(30, 20261122)` and `verifyAllItuReferenceAnchors()`.
   - The PRNG is SplitMix32 initialized with base seed `20261122`.
   - Results are 100% deterministic, machine-independent, and bit-exact across platforms.
2. **Byte-for-Byte File Parity:**
   - `benchmark_results/scientific_ablation_n30.csv` on disk must equal `formatAblationCsv(result)` byte-for-byte.
   - The content between `<!-- BEGIN_WP11_SCIENTIFIC_VALIDATION -->` and `<!-- END_WP11_SCIENTIFIC_VALIDATION -->` in `benchmark_results/BENCHMARK_DOSSIER.md` must equal `buildScientificValidationMarkdown(result, ituAnchors)` byte-for-byte.

---

## 4. Live C2 Console Integration (`LAB` Mode)

In `index.html`:
- The `#btn-generate-research-dossier` button resides in the right diagnostics panel (`#tab-diagnostics`).
- When activated, it executes:
  1. `evaluateWorkerRealTimeProfile(...)` for 50 Hz Jitter and Headroom profiling.
  2. `generateExperimentDossierMarkdown(snapshot)` for real-time telemetry snapshot and scheduler ablation.
  3. `runPhysicsRealismAblation(30, 20261122)` and `verifyAllItuReferenceAnchors()`.
  4. Appends the resulting `buildScientificValidationMarkdown(...)` block.
- Copies the complete multi-part research dossier to `navigator.clipboard` and updates `#dossier-markdown-preview`.
- Zero emojis are emitted in the exported markdown or UI labels.

---

## 5. Verification Suite 101 (`src/tests/verifyPublicationDossierSync.ts`)

- **[PDS-T1] IEEE LaTeX `booktabs` Integrity:**
  - Validates balanced environments (`\begin{table}...\end{table}`, `\begin{tabular}...\end{tabular}`).
  - Validates `\toprule`, `\midrule`, `\bottomrule`.
  - Asserts inclusion of all 4 configurations, Welch's $t$, $p$-value, Cohen's $d$.
  - Asserts zero `NaN`, zero `undefined`, and properly escaped `\%` and `\_`.
- **[PDS-T2] Byte-for-Byte Zero-Drift Artifact Parity:**
  - Evaluates live ablation and ITU anchors in memory.
  - Verifies exact string matching against `benchmark_results/scientific_ablation_n30.csv`.
  - Verifies exact string matching of the delimited section in `benchmark_results/BENCHMARK_DOSSIER.md`.
- **[PDS-T3] Live `LAB` Integration & Zero-Emoji Gate:**
  - Verifies DOM wiring and absence of Unicode emojis in `buildScientificValidationMarkdown` output and LaTeX source.
