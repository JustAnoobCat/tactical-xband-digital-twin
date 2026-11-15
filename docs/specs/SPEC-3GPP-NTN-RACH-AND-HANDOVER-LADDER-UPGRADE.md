# SPEC-3GPP-NTN-RACH-AND-HANDOVER-LADDER-UPGRADE: 3GPP Rel-17 NTN 4-Step RACH, Timing Advance & Mobility Signaling Analyzer Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Scope:** `src/core/ntnSignalingEngine.ts`, `index.html`, `src/tests/verifyNtnRachSignalingUpgrade.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

In the Tactical X-Band Air-to-Ground Network Digital Twin, an Airborne Communications Node (ACN) provides high-bandwidth data relay across high-relief mountainous topography in the Ladakh sector ($34.5^\circ\text{N}, 76.5^\circ\text{E}$). The medium-access control (MAC) and physical (PHY) layers operate across 4 body-fixed directional antenna sectors ($S_0..S_3$) at 8.0 GHz.

As tactical ground nodes enter, navigate, or experience terrain shadowing in deep alpine valleys, network attachment and beam handover signaling must adhere to **3GPP Release 17 Non-Terrestrial Network (NTN)** protocol specifications:
1. **3GPP TS 38.213 §4.2 / §4.3 Timing Advance (TA) Acquisition**:
   - Accounts for two-way round-trip propagation delays ($\tau_{\text{TA}} = 2 \cdot \tau_{\text{prop}}$) over airborne slant ranges ($d_{3\text{D}} \approx 10\text{--}40\text{ km}$).
   - Discretizes timing advance using 12-bit Timing Advance Command index $T_A \in [0, 3846]$ at Subcarrier Spacing (SCS) $30\text{ kHz}$ granularity ($0.26\text{ \mu s}$ step).
2. **3GPP TS 38.321 / TS 38.300 4-Step Contention-Based Random Access (CBRA)**:
   - **Msg1 (PRACH Preamble)**: UE transmits deterministic Zadoff-Chu preamble index $u = (nodeId \cdot 7 + 13) \pmod{64}$.
   - **Msg2 (Random Access Response - RAR)**: ACN PHY responds with 12-bit TA command $T_A$ and Temporary Cell RNTI (TC-RNTI).
   - **Msg3 (RRCSetupRequest + BSR)**: UE transmits RRC connection request multiplexing 5QI buffer status report (BSR) and negotiated DVB-S2X MODCOD.
   - **Msg4 (Contention Resolution)**: gNB-CU transmits contention resolution identity confirming RRC state transition (`RRC_CONNECTED`).
3. **3GPP TS 38.331 Event A3 Inter-Sector Mobility**:
   - Evaluates beam switching call flows across 4 body-fixed quadrant sectors ($S_0..S_3$) governed by $1.5\text{ dB}$ hysteresis ($H = 1.5\text{ dB}$).
4. **Keysight Protocol R&D Call-Flow Ladder Canvas (`#ntn-signaling-panel` & `#ntn-signaling-canvas`)**:
   - Provides an interactive protocol analyzer embedded directly inside `#tab-registration`, rendering 3 vertical lifelines (`UE [C-RNTI]`, `ACN Beam [S0..S3 PHY]`, `ACN gNB-CU [RRC]`) and 5 directional message transitions with sub-millisecond timeline milestones.

---

## 2. Mathematical Formulation & Protocol Procedures

### 2.1 Terminal Identification & Zadoff-Chu PRACH Preamble
For ground terminal node $i \in \{1, \dots, N\}$:
- **Deterministic C-RNTI**:
  $$\text{C-RNTI} = \text{0x} + (0x4E00 + i)_{16}$$
- **Deterministic Zadoff-Chu Preamble Index** ($u \in [0, 63]$):
  $$u_i = (i \cdot 7 + 13) \pmod{64}$$

### 2.2 Speed-of-Light Propagation Delay & 12-Bit Timing Advance Command
Given 3D slant range $d_{3\text{D}} = \sqrt{(x - x_{\text{ACN}})^2 + (y - y_{\text{ACN}})^2 + (z - z_{\text{ACN}})^2}$:
1. **One-Way Speed-of-Light Delay**:
   $$\tau_{\text{prop,us}} = \frac{d_{3\text{D}}}{c} \times 10^6 \quad [\mu\text{s}], \quad c = 299,792,458.0\text{ m/s}$$
2. **Two-Way Round-Trip Timing Advance**:
   $$\tau_{\text{TA,us}} = 2.0 \cdot \tau_{\text{prop,us}} \quad [\mu\text{s}]$$
3. **3GPP TS 38.213 12-Bit Timing Advance Command Index**:
   With SCS $30\text{ kHz}$ granularity ($\Delta t_{\text{TA}} = 0.26\text{ \mu s}$):
   $$T_{A,\text{index}} = \text{clamp}_{[0, 3846]}\left(\text{round}\left(\frac{\tau_{\text{TA,us}}}{0.26}\right)\right)$$
4. **4-Step RACH Acquisition Latency ($T_{\text{RACH}}$)**:
   Accounting for 2 full round trips ($4 \cdot \tau_{\text{prop}}$), gNB RAR processing delay ($2.0\text{ ms}$), and RRC processing delay ($3.0\text{ ms}$):
   $$T_{\text{RACH,ms}} = 5.0 + \frac{4.0 \cdot \tau_{\text{prop,us}}}{1000.0} \quad [\text{ms}]$$

### 2.3 RRC State Machine & 5-Step Call-Flow Steps
1. **RRC State Transitions**:
   $$\text{RRC State} = \begin{cases}
   \text{'RRC\_IDLE'} & \text{if } \neg\text{isRegistered} \\
   \text{'RRC\_RLF\_RECOVERY'} & \text{if } \text{isRegistered} \land \text{isOutage} \quad (\text{T310 radio link failure timer}) \\
   \text{'RRC\_CONNECTED'} & \text{if } \text{isRegistered} \land \neg\text{isOutage}
   \end{cases}$$

2. **5-Step Call-Flow Ladder Structure**:
   | Step | Identifier | Direction | Source $\to$ Target | Message Content | Timestamp Tag | Status |
   |---|---|---|---|---|---|---|
   | **1** | `Msg1` | `UE_TO_SECTOR` | UE $\to$ Sector PHY | `Msg1: PRACH (ZC #u)` | `+0.0 ms` | SUCCESS / PENDING |
   | **2** | `Msg2` | `SECTOR_TO_UE` | Sector PHY $\to$ UE | `Msg2: RAR (T_A=idx, TC-RNTI=hex)` | `+τ_prop` | SUCCESS / PENDING |
   | **3** | `Msg3` | `UE_TO_RRC` | UE $\to$ gNB RRC | `Msg3: RRCSetupRequest + 5QI BSR` | `+2.0ms + 2τ_prop` | SUCCESS / PENDING |
   | **4** | `Msg4` | `RRC_TO_UE` | gNB RRC $\to$ UE | `Msg4: ContentionResolution [STATE]` | `+5.0ms + 3τ_prop` | SUCCESS / FAILED |
   | **5** | `A3` | `RRC_TO_UE` | gNB RRC $\to$ UE | `A3 MeasReport / Beam Lock [Sector]` | `+T_RACH + 5ms` | SUCCESS / FAILED |

---

## 3. UI/UX Architecture & Layout Invariants

1. **Strict UI Layout Lock**:
   - The global page layout (`.rail`, `.topbar`, `.app-shell`, `#radar-container`) and global theme colors in `frontend/c2-console-theme.css` remain 100% untouched.
   - All visual and interactive additions are strictly confined inside `<section class="tab-content" id="tab-registration">`.
2. **Accessible Controls & Font Compliance**:
   - Every input and select element (`#ntn-node-select`) carries explicit, descriptive `aria-label` attributes.
   - Canvas elements carry explicit `aria-label` attributes.
   - All rendered text satisfies computed $\text{font-size} \ge 10\text{px}$.
3. **HiDPI Sequence Canvas Rendering**:
   - `#ntn-signaling-canvas` scales with device pixel ratio (`syncCanvasDpr`).
   - Renders 3 vertical lifelines (`UE [C-RNTI]`, `ACN Beam [PHY]`, `ACN gNB-CU [RRC]`) and horizontal/slanted directional vector arrows with status-aware color coding (Emerald/Cyan for `RRC_CONNECTED`, Crimson dashed for `RRC_RLF_RECOVERY`).

---

## 4. Verification Protocol

- **NRS-T1 (Speed-of-Light Propagation & 12-Bit 3GPP TA Index Math)**:
  - Slant range $d_{3\text{D}} = 14,989.6229\text{ m} \implies \tau_{\text{prop}} = 50.000\text{ \mu s}$, $\tau_{\text{TA}} = 100.000\text{ \mu s}$, $T_A = 385$, $T_{\text{RACH}} = 5.200\text{ ms}$.
- **NRS-T2 (RRC State Transitions & 5-Step Call-Flow Completeness)**:
  - Validates `RRC_CONNECTED`, `RRC_RLF_RECOVERY`, and `RRC_IDLE` state mapping.
  - Verifies all 5 ladder steps are populated with deterministic C-RNTI and parameter bindings.
- **NRS-T3 (DOM Elements & Global Layout Invariance)**:
  - Verifies presence of `#ntn-signaling-panel`, `#ntn-signaling-canvas`, `#ntn-node-select`, `#ntn-rrc-state-badge`, `#ntn-crnti-readout`, `#ntn-rach-latency-readout`, and `#ntn-ta-cmd-readout` inside `#tab-registration`.
  - Asserts zero git modifications to `frontend/c2-console-theme.css`.
  - Confirms `.rail`, `.topbar`, `.app-shell`, and `#radar-container` integrity.
