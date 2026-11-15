# SPEC-REALTIME-WORKER-JITTER-AND-DOSSIER-EXPORTER-UPGRADE: 50 Hz Web Worker Jitter Profiler & Reproducible Research Dossier Exporter Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Scope:** `src/core/workerJitterProfiler.ts`, `index.html`, `src/tests/verifyWorkerJitterAndDossierUpgrade.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

In the Tactical X-Band Air-to-Ground Network Digital Twin, an Airborne Communications Node (ACN) provides high-bandwidth data relay across high-relief mountainous topography in the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$). The authoritative simulation engine runs entirely inside a dedicated background Web Worker (`src/worker/simWorker.ts`) advancing on a strict 50 Hz discrete-event loop ($\Delta t_{\text{budget}} = 20.0\text{ ms}$).

To guarantee mission-critical reliability, ensure zero main-thread jank, and satisfy the rigorous requirements of DRDO technical reporting and academic peer review (IEEE Transactions on Aerospace and Electronic Systems), this upgrade equips the **Diagnostics & Experiment Capture Workspace (`#tab-diagnostics`)** with:
1. **First-Principles 50 Hz Real-Time Discrete-Event Profiler**:
   - Computes sorted execution percentiles ($p_{50}, p_{90}, p_{95}, p_{99}$, $\max$, and $\mu$).
   - Computes **Real-Time Deadline Headroom Margin (%)**:
     $$M_{\text{headroom,pct}} = \text{clamp}_{[0.0, 100.0]}\left(\left(1.0 - \frac{p_{95,\text{ms}}}{20.0}\right) \times 100.0\right)$$
   - Computes **RFC 3550 Smoothed Inter-Frame Pacing Jitter** ($J_{\text{rfc3550,ms}}$):
     $$D_k = |\Delta t_k - 20.0|, \quad J_k = J_{k-1} + \frac{D_k - J_{k-1}}{16.0}$$
   - Generates an **8-Bin Execution Latency Histogram** across bucket edges $[0, 2, 4, 6, 8, 10, 14, 18, \infty]$ (`'0–2ms'`, `'2–4ms'`, `'4–6ms'`, `'6–8ms'`, `'8–10ms'`, `'10–14ms'`, `'14–18ms'`, `'18–20ms+'`) with probability conservation ($\sum \text{fraction} = 1.0$).
   - Issues formal real-time verdicts: `'HARD_RT_CERTIFIED'` (when $p_{95} \le 15.0\text{ ms}$ and $\text{deadlineOverruns} = 0$), `'SOFT_RT_WARNING'`, or `'DEADLINE_OVERRUN'`.
2. **Reproducible Research Dossier Generator**:
   - Generates publication-ready Markdown and IEEE LaTeX `booktabs` ablation tables comparing `Legacy Static TDMA`, `Reactive M-LWDF`, and `Predictive Tac-TAD` alongside physical terrain and ITU-R propagation configuration provenance.
3. **Simulink Real-Time Scope & Control Panel (`#rt-profiler-panel`)**:
   - Embedded seamlessly inside `#tab-diagnostics` with HiDPI 8-bin histogram canvas (`#worker-jitter-canvas`) and one-click dossier copy utility (`#btn-generate-research-dossier`).

---

## 2. Mathematical Formulation & Real-Time Metrics

### 2.1 50 Hz Discrete-Event Loop & Execution Budget
The simulation worker executes time steps with fixed duration $\Delta t_{\text{sim}} = 20.0\text{ ms}$. In real-time mode, each step must complete within $\Delta t_{\text{budget}} = 20.0\text{ ms}$ of wall-clock time.

Given an array of execution duration samples $S = [s_1, s_2, \dots, s_N]$ in milliseconds:
- Mean step duration:
  $$\mu = \frac{1}{N} \sum_{i=1}^N s_i$$
- Maximum step duration:
  $$\max = \max_{1 \le i \le N} s_i$$
- Deadline overruns:
  $$\text{deadlineOverrunCount} = \sum_{i=1}^N \mathbf{1}(s_i > 20.0)$$

### 2.2 Nearest-Rank Percentiles
For sorted samples $x_{(1)} \le x_{(2)} \le \dots \le x_{(N)}$ (1-based rank):
$$\text{rank}(k) = \min(N, \max(1, \lceil k \cdot N \rceil))$$
$$P(k) = x_{(\text{rank}(k))}$$
Evaluated at $k \in \{0.50, 0.90, 0.95, 0.99\}$ for $p_{50}, p_{90}, p_{95}, p_{99}$.

### 2.3 Real-Time Deadline Headroom Margin
The deadline headroom quantifies the percentage of the 20.0 ms budget remaining at the 95th percentile:
$$M_{\text{headroom,pct}} = \text{clamp}_{[0.0, 100.0]}\left(\left(1.0 - \frac{p_{95,\text{ms}}}{20.0}\right) \times 100.0\right)$$

### 2.4 RFC 3550 Smoothed Inter-Frame Pacing Jitter
Adhering to RFC 3550 §6.4.1 / Appendix A.8, smoothed pacing jitter tracks inter-arrival deviations from the nominal 20.0 ms frame cadence:
$$D_k = |\Delta t_k - 20.0|$$
$$J_k = J_{k-1} + \frac{D_k - J_{k-1}}{16.0}$$
Initialized with $J_0 = 0.0$.

### 2.5 8-Bin Latency Histogram Partitioning
Partition sample durations into 8 mutually exclusive, collectively exhaustive bins:
1. `0–2ms`: $[0, 2)$
2. `2–4ms`: $[2, 4)$
3. `4–6ms`: $[4, 6)$
4. `6–8ms`: $[6, 8)$
5. `8–10ms`: $[8, 10)$
6. `10–14ms`: $[10, 14)$
7. `14–18ms`: $[14, 18)$
8. `18–20ms+`: $[18, \infty)$

Each bin records count $c_b$ and relative fraction $f_b = c_b / N$, guaranteeing $\sum_{b=1}^8 f_b = 1.000000$ (for $N > 0$).

### 2.6 Real-Time Certification Verdicts
$$\text{realTimeVerdict} = \begin{cases}
\text{'DEADLINE\_OVERRUN'} & \text{if } \text{deadlineOverrunCount} > 0 \\
\text{'HARD\_RT\_CERTIFIED'} & \text{if } p_{95,\text{ms}} \le 15.0 \land \text{deadlineOverrunCount} = 0 \\
\text{'SOFT\_RT\_WARNING'} & \text{otherwise}
\end{cases}$$

### 2.7 Reproducible Research Dossier Generator
Produces a 4-section publication-ready Markdown and LaTeX report:
- **Title**: `# DRDO Tactical X-Band Digital Twin — Reproducible Experiment Dossier`
- **Section 1**: `## 1. Theater & ITU-R / 3GPP Physical Configuration Provenance` (DEM error, traffic scale, jammer ERP, active relay, Rician fading, $K$-factor refractivity)
- **Section 2**: `## 2. 3-Way Lockstep MAC Scheduler Ablation Results` (Static vs Reactive vs Tac-TAD goodput, drops, utilization)
- **Section 3**: `## 3. IEEE Transactions LaTeX Table (\`booktabs\`)` (Fenced `latex` environment with `\begin{table}[htbp]`, `\toprule`, `\midrule`, `\bottomrule`, `\end{table}`)
- **Section 4**: `## 4. 50 Hz Real-Time Discrete-Event Engine Certification` ($p_{50}, p_{95}, p_{99}$, jitter, headroom %, verdict)

---

## 3. UI/UX Architecture & Layout Invariants

1. **Strict Global Layout Lock**:
   - The global page layout (`.rail`, `.topbar`, `.app-shell`, `#radar-container`) and global theme colors in `frontend/c2-console-theme.css` remain 100% untouched.
   - All visual and interactive additions are strictly confined inside `#tab-diagnostics`.
2. **Accessible Controls & Font Compliance**:
   - Buttons, badges, and readouts include explicit, descriptive `aria-label` attributes.
   - All rendered text satisfies computed $\text{font-size} \ge 10\text{px}$.
3. **HiDPI 8-Bin Latency Scope Canvas**:
   - `#worker-jitter-canvas` (height 150px) scales with `window.devicePixelRatio`.
   - Renders 8 vertical bars with emerald, cyan, amber, and crimson color coding, and a dashed vertical red ceiling line at 20.0 ms.

---

## 4. Verification Protocol

- **WJD-T1 (8-Bin Histogram Probability Conservation & Headroom Math)**:
  - Sample array `[4.2, 4.5, 4.8, 5.1, 5.4, 6.0, 7.2, 8.0]` produces fractions summing to `1.000000`, $p_{95} \le 8.0\text{ ms}$, $\text{headroomPct} \ge 60.0\%$, $\text{deadlineOverrunCount} = 0$, and $\text{realTimeVerdict} = \text{'HARD\_RT\_CERTIFIED'}$.
- **WJD-T2 (Reproducible Research Dossier Completeness)**:
  - Validates all 4 numbered sections, `\begin{table}`, and zero `NaN` or `undefined` tokens.
- **WJD-T3 (DOM & Global Layout Invariance Check)**:
  - Verifies presence of `#rt-profiler-panel`, `#worker-jitter-canvas`, `#rt-verdict-badge`, `#rt-headroom-readout`, `#btn-generate-research-dossier`, and `#dossier-markdown-preview` inside `#tab-diagnostics`.
  - Asserts zero git modifications to `frontend/c2-console-theme.css`.
  - Confirms `.rail`, `.topbar`, `.app-shell`, and `#radar-container` layout integrity.
