# SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT
## Empirical CDF Delay Distribution Scope & IEEE Transactions LaTeX Benchmark Generator

**Document ID:** `DRDO-TAC-XBAND-SPEC-PUBLICATION-ECDF-LATEX-01`  
**Status:** Approved & Implemented (Upgrade #7 Audit Resolution / M1.2)  
**Author:** Engineering Planner (Role 1) & Implementer (Role 2)  
**Target Runtime:** C2 Console UI (`index.html`), Headless Benchmark (`scripts/run_ts_benchmark.ts`), and Web Worker (`src/worker/simWorker.ts`, `src/worker/telemetrySerializer.ts`)

---

### 1. Motivation & Audit Defect Resolutions

This specification resolves three key findings from the Upgrade #7 verification and architectural audit:
1. **`DEF-01` (Specification File Persistence):** Preserves complete architectural and mathematical specifications on disk under `docs/specs/` and links them in `README.md` Section 7.
2. **`DEF-02` (Publication-Grade Empirical CDF Instrument & LaTeX Export):** Adds an Empirical CDF (ECDF) packet delay distribution instrument (`#ecdf-delay-canvas`) with standard 3GPP TS 23.501 5QI Packet Delay Budget (PDB) vertical markers, and an automated IEEE Transactions LaTeX Table Generator for multi-seed ablation results.
3. **`OBS-01` (Zero-Allocation Viewshed Telemetry Serialization):** Eliminates per-frame `Array.from()` conversions at 50 Hz by supporting native `Float32Array` structured clone transfers in `TelemetryFrameMessage`.

---

### 2. Empirical Cumulative Distribution Function (ECDF) Delay Instrument

#### 2.1 Mathematical Definition
The Empirical CDF $F(\tau)$ models the cumulative probability that a dequeued tactical packet experiences Head-of-Line (HoL) queuing delay less than or equal to threshold $\tau$:
$$F(\tau) = \frac{1}{N} \sum_{i=1}^N \mathbf{1}\{\text{Delay}_i \le \tau\}, \quad \tau \in [0\text{ ms}, 320\text{ ms}]$$

Properties:
- Non-decreasing step function: $\tau_1 < \tau_2 \implies F(\tau_1) \le F(\tau_2)$.
- Boundary conditions: $F(0) \ge 0$, $\lim_{\tau \to \infty} F(\tau) = 1.0$.
- Quantile points: $F(p_{50}) = 0.50$, $F(p_{95}) = 0.95$, $F(p_{99}) = 0.99$ satisfying $p_{50} \le p_{95} \le p_{99}$.

#### 2.2 3GPP TS 23.501 5QI Packet Delay Budget (PDB) Threshold Markers
The canvas scope displays four critical operational delay boundaries defined by 3GPP 5G NR / Tactical Cellular specifications:
- **60 ms (`5QI-69`):** Mission-Critical Delay Sensitive Command & Control (C2).
- **100 ms (`5QI-65`):** Mission-Critical Push-to-Talk Voice.
- **150 ms (`5QI-67`):** Mission-Critical Real-Time Video Streaming.
- **300 ms (`5QI-70`):** Tactical Sensor / High-Resolution ISR Image Transfer.

#### 2.3 Visual Representation (`#ecdf-delay-canvas`)
Three distinct ECDF curves are plotted simultaneously:
1. **Legacy Static TDMA:** Crimson dashed line (`#ef4444`). Exhibits long-tail queuing delay due to rigid allocation during terrain diffraction events.
2. **Reactive M-LWDF ($\Phi_{\text{evac}} = 1$):** Amber solid line (`#f59e0b`). Adapts immediately to active channel status, reducing median delay.
3. **Predictive Tac-TAD ($\Phi_{\text{evac}} \ge 1$):** Emerald/Cyan bold line (`#10b981`). Evacuates perishable packets prior to predicted mountain shadow entry, keeping tail delay ($p95, p99$) strictly below the 60 ms and 100 ms 5QI limits.

---

### 3. IEEE Transactions LaTeX Table Generator

#### 3.1 Schema & Formatting
The table generator produces publication-ready LaTeX adhering to IEEE Transactions typography (`booktabs` package format):
- Centered tabular environment: `\begin{table}[htbp] ... \begin{tabular}{l ccc ccc} ... \end{tabular} \end{table}`
- Columns:
  1. Scheduler Architecture (`Legacy Static TDMA`, `Reactive M-LWDF`, `Predictive Tac-TAD`)
  2. Delivered Goodput ($\text{Mb}$) & Effective Rate ($\text{Mbps}$)
  3. Channel Airtime Utilization ($\%$)
  4. Outage Waste ($\text{kbits}$ transmitted into blockage)
  5. Queuing Delay Drops ($N_{\text{drop}}$) & Overflow Drops
  6. $p50$, $p95$, $p99$ Packet Latency ($\text{ms}$)
- Table note detailing simulation parameters ($\sigma_{\text{DEM}}$, Traffic Load Factor, EW Jammer state, and seed count).

#### 3.2 Dual Availability: UI & Benchmark CLI
1. **Interactive UI (`#btn-copy-latex-ablation`):** Located in `#tab-scheduler` adjacent to the 3-Way Ablation Matrix. Copies the formatted LaTeX to the clipboard and populates a collapsible `<pre id="latex-export-preview">`.
2. **Headless CLI (`scripts/run_ts_benchmark.ts`):** Automatically computes multi-seed $\text{Mean} \pm \text{SD}$ statistics and writes `benchmark_results/generated/latest_ablation_table.tex`.

---

### 4. Verification Contracts (`src/tests/verifyPublicationEcdfAndLatex.ts`)

- **PEL-T1 (Specification Persistence Check):** Confirms both `SPEC-REALTIME-RF-VIEWSHED-AND-RELAY-ADVISOR.md` and `SPEC-PUBLICATION-ECDF-AND-LATEX-BENCHMARK-EXPORT.md` exist on disk and have length $> 500$ characters.
- **PEL-T2 (3-Way Delay Percentile / ECDF Monotonicity):** Asserts $p50 \le p95 \le p99$ and finite delay values across all 3 schedulers.
- **PEL-T3 (IEEE LaTeX Table Generation):** Generates valid LaTeX syntax without `NaN`, `undefined`, or unescaped symbols, containing all 3 schedulers.
- **PEL-T4 (DOM Contract):** Verifies presence of `#ecdf-delay-canvas`, `#btn-copy-latex-ablation`, and `#latex-export-preview` in `index.html`.
