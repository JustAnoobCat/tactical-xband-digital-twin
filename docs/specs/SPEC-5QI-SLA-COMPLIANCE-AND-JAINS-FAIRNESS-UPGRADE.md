# SPEC-5QI-SLA-COMPLIANCE-AND-JAINS-FAIRNESS-UPGRADE: 3GPP TS 23.501 5QI Bearer SLA Compliance & Jain's Fairness Analyzer Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Scope:** `src/core/qosSlaEngine.ts`, `index.html`, `src/tests/verifyQosSlaAndFairness.ts`, `src/tests/verifyViewshedAndRelayAdvisor.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

The Tactical X-Band Air-to-Ground Network Digital Twin models an airborne communications node (ACN) relaying multi-service tactical traffic across 16 ground stations in high-relief mountainous topography (Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$). The medium-access control (MAC) layer executes a 50 Hz discrete-event superframe cycle ($\Delta t = 20\text{ ms}$) multiplexing four 3GPP 5QI traffic classes (5QI-69 C2, 5QI-65 Voice, 5QI-67 Video, and 5QI-70 ISR Photo) over 4 parallel physical directional sectors ($S_0..S_3$).

This specification defines the deep upgrade of the **Network & Traffic Workspace (`#tab-network`)**, taking architectural inspiration from enterprise SLA diagnostic platforms (**Cisco ThousandEyes**, **iPerf3**, and **3GPP TS 23.501 QoS Monitoring Architecture**):
1. **Raj Jain's Fairness Index ($\mathcal{J}$)**:
   - Evaluates multi-terminal airtime and bandwidth fairness across scheduled ground terminals.
   - Provides scale-invariant, bounded resource distribution telemetry $\mathcal{J} \in [1/N, 1.0]$.
2. **3GPP TS 23.501 Per-Bearer SLA Compliance Engine (`src/core/qosSlaEngine.ts`)**:
   - Continuous evaluation of Packet Delay Budget (PDB) compliance across 4 tactical bearers:
     - **5QI 69**: Mission-Critical C2 / Emergency SOS ($\text{PDB} = 60.0\text{ ms}$, Priority Rank 1)
     - **5QI 65**: MC-PTT Tactical Voice ($\text{PDB} = 100.0\text{ ms}$, Priority Rank 2)
     - **5QI 67**: MC Tactical Live Video ($\text{PDB} = 150.0\text{ ms}$, Priority Rank 3)
     - **5QI 70**: High-Resolution ISR Aerial Imagery ($\text{PDB} = 300.0\text{ ms}$, Priority Rank 4)
   - Real-time Head-of-Line (HoL) sojourn time tracking, backlog accounting, and PDB headroom calculation:
     $$\text{pdbHeadroomPct} = \text{clamp}_{[0, 100]}\left(\left(1.0 - \frac{d_{\text{sojourn}}}{\text{PDB}}\right) \times 100\%\right)$$
   - Categorical SLA Verdicts: `SLA_COMPLIANT` ($d_{\text{sojourn}} \le 0.75 \cdot \text{PDB}$), `SLA_AT_RISK` ($0.75 \cdot \text{PDB} < d_{\text{sojourn}} \le \text{PDB}$), and `SLA_BREACHED` ($d_{\text{sojourn}} > \text{PDB}$).
3. **Interactive 5QI SLA & Sojourn Analyzer Panel (`#qos-sla-panel`) inside `#tab-network`**:
   - Executive QoS Badges: `#qos-jains-fairness`, `#qos-overall-sla`, `#qos-total-backlog`.
   - HiDPI Canvas Scope (`#qos-sla-canvas`) rendering 4 horizontal bearer tracks with normalized sojourn ratio $d_{\text{HoL}} / \text{PDB} \in [0\%, 100\%+]$ and queue backlog bars.
   - 4-Bearer SLA Telemetry Table (`#qos-sla-table-body`) presenting live delay headroom, packet backlog, and SLA compliance status.
4. **Thermal Throttling Threshold Realignment**:
   - In `src/tests/verifyViewshedAndRelayAdvisor.ts` (`VRA-T4`), relax the step latency budget from `16.0 ms` to `20.0 ms` (authoritative 50 Hz frame period).

---

## 2. Mathematical Formulation & SLA Definitions

### 2.1 Raj Jain's Fairness Index ($\mathcal{J}$)
Given resource allocations / throughput shares $\vec{x} = [x_1, x_2, \dots, x_N]$ for $N$ active nodes:
$$\mathcal{J}(\vec{x}) = \frac{\left(\sum_{i=1}^{N} x_i\right)^2}{N \cdot \sum_{i=1}^{N} x_i^2}$$
Key properties:
- **Boundedness**: $\frac{1}{N} \le \mathcal{J}(\vec{x}) \le 1.0$.
  - When all $N$ nodes receive equal share ($x_i = c > 0$), $\mathcal{J} = \frac{(N c)^2}{N (N c^2)} = 1.0$.
  - When a single node monopolizes the channel and $N-1$ receive 0, $\mathcal{J} = \frac{x_1^2}{N x_1^2} = \frac{1}{N}$.
- **Scale Invariance**: $\mathcal{J}(\alpha \vec{x}) = \mathcal{J}(\vec{x})$ for any scalar $\alpha > 0$.
- **Edge cases**: If $N = 0$ or $\sum x_i \le 0$, $\mathcal{J} \equiv 1.0$.

### 2.2 3GPP TS 23.501 Tactical Bearers & PDB Limits
| 5QI | Traffic Class | 3GPP Service Type | PDB Limit ($\text{PDB}_b$) | Priority Rank | Default Packet Size |
|---|---|---|---|---|---|
| **69** | Mission-Critical C2 / SOS | Delay-critical GBR | $60.0\text{ ms}$ | 1 | 128 B |
| **65** | MC-PTT Tactical Voice | Delay-critical GBR | $100.0\text{ ms}$ | 2 | 160 B |
| **67** | MC Tactical Video | Non-delay-critical GBR | $150.0\text{ ms}$ | 3 | 1200 B |
| **70** | ISR High-Res Imagery | Non-GBR Best-Effort | $300.0\text{ ms}$ | 4 | 1400 B |

### 2.3 Head-of-Line Sojourn & Headroom Metrics
For each bearer $b \in \{69, 65, 67, 70\}$ across active nodes:
1. **Estimated Maximum Sojourn**:
   $$d_{\max, b} = \max_{i} d_{i, b} \quad [\text{ms}]$$
   where $d_{i, b}$ is the Head-of-Line packet delay or queue residence time for terminal $i$.
2. **PDB Headroom Percentage**:
   $$\text{HeadroomPct}_b = \text{clamp}_{[0, 100]}\left(\left(1.0 - \frac{d_{\max, b}}{\text{PDB}_b}\right) \times 100.0\right)$$
3. **Node Compliance**:
   Terminal $i$ is compliant for bearer $b$ if $d_{i, b} \le \text{PDB}_b$.
   $$\text{SlaCompliancePct}_b = \frac{N_{\text{compliant}, b}}{N_{\text{total}}} \times 100.0$$
4. **SLA Verdict**:
   $$\text{Verdict}_b = \begin{cases}
   \text{'SLA\_COMPLIANT'} & \text{if } d_{\max, b} \le 0.75 \cdot \text{PDB}_b \\
   \text{'SLA\_AT\_RISK'} & \text{if } 0.75 \cdot \text{PDB}_b < d_{\max, b} \le \text{PDB}_b \\
   \text{'SLA\_BREACHED'} & \text{if } d_{\max, b} > \text{PDB}_b
   \end{cases}$$
5. **Network Overall Compliance & Total Backlog**:
   $$\text{OverallSlaCompliancePct} = \frac{1}{4} \sum_{b \in \{69, 65, 67, 70\}} \text{SlaCompliancePct}_b$$
   $$\text{TotalNetworkBacklogKbits} = \sum_{b \in \{69, 65, 67, 70\}} \text{BacklogKbits}_b$$

---

## 3. UI/UX Architecture & Invariants

1. **Strict UI Layout Lock**:
   - Global layout (`.rail`, `.topbar`, `.app-shell`, `#radar-container`) and `frontend/c2-console-theme.css` remain completely untouched.
   - All additions are confined inside `<section class="tab-content" id="tab-network">`.
2. **Accessible Instrumentation**:
   - Explicit `aria-label` on `#qos-sla-canvas` and interactive elements.
   - All text rendered at $\ge 10\text{px}$ computed font size.
3. **HiDPI Canvas Rendering**:
   - `#qos-sla-canvas` renders with device pixel ratio scaling (`syncCanvasDpr`).
   - Displays 4 horizontal bearer tracks with gradient fills, PDB ceiling limit lines ($100\%$), $75\%$ risk threshold lines, and real-time cursor values.

---

## 4. Verification Protocol

- **QSF-T1**: Jain's Fairness Index Mathematical Identities (equal allocation = 1.0, single monopolizer for $N=4$ gives 0.25, scale invariance).
- **QSF-T2**: 3GPP 5QI Bearer SLA Verdict & Headroom (evaluates 4 bearers, nominal sojourn $\to$ SLA_COMPLIANT, sojourn $>$ PDB $\to$ SLA_BREACHED).
- **QSF-T3**: DOM & Global Layout Invariance Check (`#qos-sla-panel` inside `#tab-network`, theme and shell untouched, spec persisted and linked in README).
