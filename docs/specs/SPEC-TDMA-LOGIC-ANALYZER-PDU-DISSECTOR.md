# SPEC-TDMA-LOGIC-ANALYZER-PDU-DISSECTOR: Saleae Logic 2 Timing Analyzer & Wireshark L1/L2 MAC PDU Dissector Upgrade

**Status:** APPROVED BY ROLE 1 PLANNER (GEMINI ARGON)  
**Author:** Role 2 Implementer (Antigravity)  
**Scope:** `src/core/pduDissector.ts`, `index.html`, `src/tests/verifyTdmaLogicAnalyzerDissector.ts`, `package.json`, `scripts/run_all_verifications.mjs`, `README.md`  

---

## 1. Executive Summary & Operational Context

The Tactical X-Band Air-to-Ground Network Digital Twin models an airborne communications node (ACN) relaying multi-service tactical traffic across 16 ground stations in high-relief mountainous topography (Ladakh sector, $34.5^\circ\text{N}, 76.5^\circ\text{E}$). The medium-access control (MAC) layer executes a 50 Hz discrete-event superframe cycle ($\Delta t = 20\text{ ms}$) multiplexing four 3GPP 5QI traffic classes (5QI-69 C2, 5QI-65 Voice, 5QI-67 Video, and 5QI-70 ISR Photo) over 4 parallel physical directional sectors ($S_0..S_3$).

This specification defines the deep instrumentation upgrade of the **TDMA Superframe Gantt & Slot Allocation Inspector** (`#tab-scheduler`), taking direct architectural inspiration from premier hardware logic analyzers and protocol dissectors:
1. **Saleae Logic 2 Timing Analyzer**:
   - Sub-microsecond interactive timing cursor across `#waterfall-canvas` / `#gantt-canvas` displaying instantaneous superframe offset $t \in [0.000, 20.000]\text{ ms}$ with microsecond resolution.
   - Interactive spatial hit-testing across all scheduled physical slots with visual hover highlight.
   - Speed-of-light propagation Timing Advance guard-band shading ($\tau_{\text{TA}} = 2 d_{3\text{D}} / c$) rendered as an amber hatched strip at the trailing edge of each slot.
   - Interactive slot pinning and auto-tracking toggle (`#btn-pdu-auto-follow`).
2. **Wireshark Layer-1 / Layer-2 X-Band MAC PDU Frame Dissector (`#pdu-dissector-panel`)**:
   - First-principles pure TypeScript dissector engine (`src/core/pduDissector.ts`).
   - Strict physical and protocol bit accounting with 100% exact bit conservation:
     $$\text{framingOverheadBits} + \text{c2Bits} + \text{voiceBits} + \text{videoBits} + \text{photoBits} + \text{paddingBits} \equiv \text{totalCapacityBits}$$
   - Strict-priority 3GPP 5QI byte multiplexing and visual stacked byte-packing bar (`#pdu-byte-bar`).
   - 3-layer protocol dissector breakdown (`#pdu-layer1-phy`, `#pdu-layer2-mac`, `#pdu-layer3-sched`).
   - Deterministic 16-byte hexadecimal frame header and ASCII decode strip (`#pdu-hex-dump`).

---

## 2. Mathematical & Protocol Formulation

### 2.1 Speed-of-Light Timing Advance ($\tau_{\text{TA}}$)
For an ACN communicating with a ground terminal at 3D slant range $d_{3\text{D}}$, the round-trip propagation delay dictates the required uplink Timing Advance:
$$\tau_{\text{TA}} = \frac{2 d_{3\text{D}}}{c} \times 10^6 \quad [\mu\text{s}]$$
where $c = 299,792,458\text{ m/s}$. In the Gantt timeline, this physical guard-band represents airtime reserved for propagation delay before symbol arrival at the ACN receiver aperture.

### 2.2 First-Principles Protocol Bit Conservation & 5QI Multiplexing
For any scheduled slot of duration $T_{\text{slot}}$ and physical capacity $C_{\text{bits}} = \lfloor B_{\text{ch}} \cdot T_{\text{slot}} \cdot \eta_{\text{modcod}} \rfloor$:
1. **Framing & Physical Layer Overhead**:
   $$\text{framingOverheadBits} = \min(C_{\text{bits}}, 512) \quad (64\text{ bytes DVB-S2X PLHEADER + SOF + MAC Header + CRC-32})$$
2. **Remaining Payload Budget**:
   $$\text{remBits} = \max(0, C_{\text{bits}} - \text{framingOverheadBits})$$
3. **Strict-Priority 5QI Drainage**:
   Remaining bits are allocated sequentially to active queues in strict 3GPP TS 23.501 priority order:
   - $Q_{\text{c2}}$ (5QI-69 Mission-Critical C2)
   - $Q_{\text{voice}}$ (5QI-65 Mission-Critical PTT Voice)
   - $Q_{\text{video}}$ (5QI-67 Tactical HD Video)
   - $Q_{\text{photo}}$ (5QI-70 ISR Imagery)
4. **Padding / Headroom**:
   $$\text{paddingBits} = \text{remBits} - (\text{c2Bits} + \text{voiceBits} + \text{videoBits} + \text{photoBits})$$
   Consequently, exact bit conservation holds unconditionally:
   $$\sum \text{bits} = \text{framingOverheadBits} + \text{c2Bits} + \text{voiceBits} + \text{videoBits} + \text{photoBits} + \text{paddingBits} = C_{\text{bits}}$$

### 2.3 Delivery Status Verdict & Reason Codes
- If $\text{isOutage} \lor C_{\text{bits}} \le 0$:
  $$\text{deliveryStatus} = \text{'OUTAGE\_WASTED\_BURST'}, \quad \text{wastedBits} = C_{\text{bits}}, \quad \text{deliveredBits} = 0$$
- Else if $\text{isPreOcclusionFlush}$:
  $$\text{deliveryStatus} = \text{'PRE\_OCCLUSION\_EVAC\_BURST'}, \quad \text{wastedBits} = 0, \quad \text{deliveredBits} = C_{\text{bits}}$$
- Else:
  $$\text{deliveryStatus} = \text{'NOMINAL\_DELIVERED\_BURST'}, \quad \text{wastedBits} = 0, \quad \text{deliveredBits} = C_{\text{bits}}$$

### 2.4 Deterministic Hexadecimal Frame Header Format
The frame header format produces an authentic 16-byte hex dump:
$$\texttt{58 42 } \mathbf{S} \mathbf{N} \mathbf{M} \mathbf{F} \mathbf{L}_{\text{hi}} \mathbf{L}_{\text{lo}} \mathbf{T}_{\text{hi}} \mathbf{T}_{\text{lo}} \mathbf{SNR} \mathbf{CRC}_0 \mathbf{CRC}_1 \mathbf{CRC}_2 \mathbf{CRC}_3 \texttt{ [SYNC:XB | SEC:S}s\texttt{ | NID:}n\texttt{ | CRC32:OK]}$$
- `58 42`: ASCII `'X'` `'B'` X-Band synchronization word.
- $\mathbf{S}$: 1-byte sector index ($0..3$).
- $\mathbf{N}$: 1-byte terminal node ID ($0..15$).
- $\mathbf{M}$: 1-byte MODCOD identifier.
- $\mathbf{F}$: 1-byte flags (outage, pre-occlusion flush, scheduler type).
- $\mathbf{L}$: 2-byte slot payload capacity in bytes.
- $\mathbf{T}$: 2-byte Timing Advance $\tau_{\text{TA}}$ in microseconds.
- $\mathbf{SNR}$: 1-byte quantized SNR level.
- $\mathbf{CRC}_{0..3}$: 4-byte standard IEEE 802.3 CRC-32 over header fields.

---

## 3. UI Architecture & Invariants

1. **Strict UI Layout Lock**:
   - The global `.rail`, `.topbar`, `.app-shell`, and `#radar-container` layout remain 100% untouched.
   - All additions are confined inside `#tab-scheduler`.
2. **Saleae Logic 2 Interactive Cursor on Canvas**:
   - Tracks mouse hover coordinates on `#waterfall-canvas` (`#gantt-canvas`).
   - Draws a cyan dashed vertical cursor line and top timestamp pill `t = XX.XXX ms (XXXX μs)`.
   - Renders speed-of-light Timing Advance guard strips on slot rectangles.
   - Enables slot selection and pinning with `#btn-pdu-auto-follow`.
3. **Wireshark Dissector Panel (`#pdu-dissector-panel`)**:
   - Visual stacked byte-multiplexing bar (`#pdu-byte-bar`) color-coded by 5QI class.
   - 3-column protocol inspector (`#pdu-layer1-phy`, `#pdu-layer2-mac`, `#pdu-layer3-sched`).
   - Monospace hex header decode strip (`#pdu-hex-dump`).
4. **Accessibility & Browser UX Invariants**:
   - Every interactive control has explicit `aria-label` attributes.
   - Minimum computed `font-size` $\ge 10\text{px}$ across all viewports.
