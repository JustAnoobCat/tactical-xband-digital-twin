# SPEC-WP02: Backend Security, Concurrency Hardening & Electron Desktop Containment

**Specification Document:** `docs/specs/wp02-backend-electron-hardening.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** Backend Security, Concurrency Architecture & Desktop Sandbox Hardening  
**Applies to Modules:** `server/app.py`, `electron/main.cjs`, `tests/test_server_security.py`  

---

## 1. Executive Summary & Objective

This specification hardens the Python prototype backend (`server/app.py`) and the Electron desktop wrapper (`electron/main.cjs`) for the **DRDO Tactical X-Band Air-to-Ground Network Digital Twin**.

### 1.1 Core Objectives
1. **CORS Hardening:** Restrict cross-origin access to an explicit localhost/loopback whitelist and validated local ports, preventing unauthorized external websites from issuing unauthorized commands or exfiltrating telemetry.
2. **Opt-In API Token Authentication (`XBAND_API_TOKEN`):** Provide secure bearer token and API-key validation using constant-time comparison (`hmac.compare_digest`) for all mutating HTTP endpoints and WebSocket streams, with automatic zero-configuration fallback when unset.
3. **Concurrency Locking & Input Finiteness Validation:** Eliminate race conditions between WebSocket 50 Hz simulation ticks and concurrent HTTP mutation requests using an asynchronous lock (`asyncio.Lock`), and strictly reject non-finite (`NaN`, `±Inf`) or out-of-range numeric payloads with HTTP `400`/`422` error codes.
4. **Architectural Parity Handshake (`GET /api/capabilities`):** Provide an explicit API contract documenting that Python serves as a reference prototype backend while TypeScript / Vite Web Worker is the sole authoritative simulation runtime.
5. **Electron Desktop Sandbox Hardening:** Configure secure `webPreferences`, enforce response-header Content Security Policy (CSP), deny popups, and restrict navigation to local origins.

---

## 2. Architectural Invariants & Scope Boundaries

### 2.1 Authorized Seams
Modifications are strictly confined to:
- `docs/specs/wp02-backend-electron-hardening.md` (Created)
- `server/app.py` (Modified)
- `electron/main.cjs` (Modified)
- `tests/test_server_security.py` (Created)

No application source files under `src/`, `core/`, `frontend/`, `index.html`, `package.json`, or `scripts/` may be altered.

### 2.2 Compatibility Invariants
1. **Zero-Config Developer Workflow:** When `XBAND_API_TOKEN` is unset or empty, all endpoints function without authentication headers, maintaining 100% backward compatibility with existing tests in `tests/test_server.py`.
2. **Simulation Integrity:** Mutating REST calls and WebSocket commands must never inject `NaN` or `±Inf` into coordinate or RF arrays, protecting subsequent simulation ticks from corrupted arithmetic.
3. **Authoritative Runtime Boundary:** Live production simulation logic remains authoritative in TypeScript Web Worker (`src/worker/simWorker.ts`). The Python backend explicitly identifies its role via `GET /api/capabilities`.

---

## 3. Detailed Specifications

### 3.1 Python Backend Hardening (`server/app.py`)

#### 3.1.1 CORS Policy
- Add `fastapi.middleware.cors.CORSMiddleware`.
- Allow explicit localhost origins:
  - `http://localhost:5173`, `http://127.0.0.1:5173` (Vite dev server)
  - `http://localhost:4173`, `http://127.0.0.1:4173` (Vite preview)
  - `http://localhost:8000`, `http://127.0.0.1:8000` (Python backend)
- Allow regex pattern matching loopback ports: `r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"`
- Support dynamic comma-separated overrides from `os.environ.get("XBAND_CORS_ORIGINS")`.
- Disallow arbitrary remote origins (e.g., `https://evil.example.com`).

#### 3.1.2 Opt-In API Token Authentication (`XBAND_API_TOKEN`)
- Dynamically read `token = os.environ.get("XBAND_API_TOKEN", "").strip()` per request.
- If `token` is non-empty:
  - **Mutating HTTP Methods (`POST`, `PUT`, `PATCH`, `DELETE`):**
    - Inspect `X-API-Key` header or `Authorization: Bearer <key>`.
    - Validate using `hmac.compare_digest`.
    - Return `401 Unauthorized` with `{"ok": false, "error": "Unauthorized: invalid or missing API token"}` if missing or mismatched.
  - **Read-Only HTTP Methods (`GET`, `OPTIONS`, `HEAD`):**
    - Remain public without requiring credentials.
  - **WebSocket (`/ws`):**
    - Inspect query param `?token=...`, header `X-API-Key`, or header `Authorization: Bearer ...`.
    - If missing or invalid, close with status code `1008` (Policy Violation).

#### 3.1.3 Concurrency Control
- Simulation state mutations (`sim.update_config`, `sim.move_node`, `sim.inject_traffic`, `sim.sim_control`, `sim.load_preset`, `sim.load_custom_terrain_array`, `sim.handle_message`) and ticks (`sim.tick_simulation`) are guarded with an `asyncio.Lock` instance (`sim_lock`).

#### 3.1.4 Input Sanitization & Numeric Finiteness
- Reject any payload containing `NaN`, `±Inf`, or out-of-range values:
  - `POST /api/node/move`: `node_id` must be `-1` or `0 <= node_id < 16`. Coordinates `x_m` and `y_m` must be finite numbers within $[-300,000, +300,000]$ m.
  - `POST /api/traffic/inject`: `node_id` in `[0, 15]`, non-empty `traffic_type`.
  - `POST /api/control`: `speed` must be finite and in $[0.0, 100.0]$.
  - `POST /api/config`: All configured numeric parameters must be finite numbers conforming to valid ranges.
- Failure returns clean HTTP `400` / `422` JSON responses.

#### 3.1.5 Capability Handshake Endpoint (`GET /api/capabilities`)
- Add `GET /api/capabilities` returning:
  ```json
  {
    "engine": "python-reference-backend",
    "canonical_runtime": "typescript-web-worker",
    "parity_status": "reference-subset",
    "version": "1.2.0",
    "frequency_hz": 50,
    "timestep_s": 0.02,
    "python_core_models": {
      "link_budget": ["fspl", "itur_p676_absorption", "itur_p838_rain", "dvbs2x_modcod"],
      "queues": ["strict_priority_5qi", "codel_sojourn", "deadline_pruning"],
      "scheduler": ["legacy_static_tdma", "tac_tad_dynamic_tdma", "pre_occlusion_flush"],
      "terrain": ["bilinear_dem_interpolation", "fbm_synthetic_relief", "earth_bulge_4_3", "deygout_p526_diffraction"],
      "trajectory": ["elliptical_orbit_kinematics", "predictive_lookahead_4state"]
    },
    "typescript_only_features": [
      "web_worker_discrete_event_loop",
      "srtm_hgt_mosaic_decompression",
      "quad_sector_antenna_switching",
      "doppler_carrier_frequency_offset",
      "electronic_warfare_jamming_sinr",
      "active_multi_hop_ridge_relay_mesh",
      "3gpp_ntn_rician_fading_cqi_aging",
      "dvbs2x_iq_constellation_vsa",
      "3gpp_ntn_rach_handover_ladder",
      "5qi_sla_compliance_jains_fairness",
      "worker_jitter_dossier_telemetry",
      "precision_geodetic_instruments",
      "tactical_ai_pathfinder",
      "edge_ai_copilot_soldier_eud"
    ]
  }
  ```

---

### 3.2 Electron Desktop Wrapper Hardening (`electron/main.cjs`)

1. **`webPreferences` Security Attributes:**
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - `sandbox: true`
   - `webSecurity: true`
2. **Navigation & Window Containment:**
   - Block popup windows: `webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`
   - Prevent external navigations: intercept `will-navigate` event to deny any URL not starting with `file://` or loopback `http://localhost`, `http://127.0.0.1`.
3. **Content Security Policy (CSP):**
   - Inject restrictive headers via `session.defaultSession.webRequest.onHeadersReceived`:
     - `default-src 'self'`
     - `script-src 'self' 'wasm-unsafe-eval' blob:`
     - `worker-src 'self' blob:`
     - `style-src 'self' 'unsafe-inline'`
     - `img-src 'self' data: blob:`
     - `connect-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:* blob: data:`
     - `font-src 'self' data:`
     - `object-src 'none'`
     - `frame-ancestors 'none'`

---

## 4. Verification Matrix & Acceptance Criteria

| Test / Check | Command / Target | Success Criteria |
|---|---|---|
| CORS Origin Isolation | `tests/test_server_security.py` | Allows localhost origins; rejects evil external origin |
| Opt-In Token Auth (Unset) | `tests/test_server_security.py` | REST & WS connect without credentials when token is unset |
| Opt-In Token Auth (Set) | `tests/test_server_security.py` | Mutating REST returns 401 on missing/bad token, 200 on valid `X-API-Key`/`Bearer`. WS returns 1008 on invalid token |
| Input Sanitization | `tests/test_server_security.py` | Non-finite values (`NaN`, `Inf`) and invalid node IDs return 400 without crashing simulation |
| Concurrency Guard | `tests/test_server_security.py` | State mutations and ticks run safely under concurrency lock |
| Capabilities Endpoint | `tests/test_server_security.py` | `GET /api/capabilities` returns valid engine identity & model taxonomy |
| Electron Syntax Check | `node --check electron/main.cjs` | Zero syntax errors |
| Existing Test Suite Parity | `pytest -v` | All 17 existing tests in `tests/test_server.py` continue to pass |
| Full Verification Suite | `npm run verify:all` | All 86 TypeScript suites pass |
| Git Boundary | `git status --short` | Strict confinement to approved seams |
