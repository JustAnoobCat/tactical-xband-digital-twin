# SPEC-FIX-01: Green Playwright CI Hardening, `server:ts` Security & Dependency Fix, and Async PMTiles v3 Byte-Range Serving in Electron

**Document ID:** `docs/specs/fix-01-ci-server-electron-hardening.md`  
**Classification:** CI Reliability, Headless WebGL Diagnostics, Backend Security Parity, and Electron Protocol Hardening  
**Target Architecture:** TypeScript / Vite Web Worker Digital Twin (DRDO X-Band Air-to-Ground Relay Network)  
**Status:** Approved for Implementation (Role 2 Implementer)  

---

## 1. Executive Summary & Problem Diagnosis

This specification addresses three production and CI stability gaps identified during development and continuous integration runs of the Tactical X-Band Digital Twin:

1. **Flaky Playwright Browser UX Gate on GPU-less GitHub Actions Runners:**
   - On headless Ubuntu CI runners (`ubuntu-latest`), hardware GPU acceleration is unavailable. Chromium defaults to software fallback, which can fail or trigger timing delays during WebGL canvas initialization (MapLibre and Three.js 3D terrain scenes).
   - An asynchronous race condition occurs when `#btn-hifi-all-toggle` is clicked: the main thread posts a `CONFIG_UPDATE` command over Web Worker IPC while 50 Hz discrete-event telemetry frames are in transit. An in-flight frame dispatched prior to processing `CONFIG_UPDATE` temporarily overwrites `#toggle-hifi-attitude` to unchecked state during the ~20 ms tick interval. Calling `isChecked()` synchronously without polling causes sporadic assertion failures (`false !== true`).
   - Missing explicit Chromium software-rendering launch flags (`--use-gl=angle`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`, `--no-sandbox`) leads to intermittent WebGL context creation drops on headless Linux containers.

2. **`server:ts` Dependency Failure & Missing Security Parity (WP-02):**
   - The npm script `"server:ts"` previously referenced `tsx server/ts_parity_server.ts`. However, `tsx` is not installed in `devDependencies`, whereas `vite-node` is installed and actively utilized across all 114 test suites. Executing `npm run server:ts` failed immediately with `command not found: tsx`.
   - The TypeScript headless parity server (`server/ts_parity_server.ts`) lacked complete WP-02 parity controls:
     - CORS header reflected any loopback origin without configurable external origin overrides (`XBAND_CORS_ORIGINS`).
     - API token authentication did not protect against timing side-channel attacks for mismatched token lengths.
     - Body parsing lacked an explicit 1 MB size limit returning HTTP `413 Payload Too Large`.
     - Concurrent Server-Sent Events (SSE) connections were uncapped and lacked connection tracking.
     - `/api/capabilities` did not accurately advertise REST+SSE transport.

3. **Electron `xband-tile://` Protocol Performance & PMTiles v3 Byte-Range Serving:**
   - In `electron/main.cjs`, tile fetching used synchronous, blocking `fs.readFileSync` inside `protocol.handle('xband-tile', ...)`. In high-throughput 3D terrain rendering or multi-tile tile fetching, blocking the Node event loop degrades UI responsiveness.
   - Archive formats such as PMTiles v3 require RFC 9110 HTTP Range requests (`Range: bytes=start-end`) to read metadata headers and specific compressed tile byte-ranges without loading multi-megabyte archives into memory. `electron/main.cjs` did not implement RFC 9110 `Range` parsing, returning only full-buffer `200 OK` responses.
   - Symlink traversal defenses relied solely on string prefix matching of normalized paths, which can be bypassed if directory symlinks resolve outside `data/tiles/`. Canonical `fs.promises.realpath` validation was missing.

---

## 2. Architecture & Seams Contract

### 2.1 Authorized Seams
Modifications under FIX-01 are strictly restricted to:
- `docs/specs/fix-01-ci-server-electron-hardening.md` (Specification document)
- `scripts/verify-browser-ux.mjs` (Browser UX test harness)
- `.github/workflows/ci.yml` (CI workflow definition)
- `server/ts_parity_server.ts` (Headless TypeScript parity server)
- `electron/main.cjs` (Electron desktop entrypoint and custom protocol handler)
- `package.json` (Script fix, version sync, and suite registration)
- `src/tests/verifyHardeningFix01.ts` (Verification Suite 115)
- `scripts/run_all_verifications.mjs` (Suite registry)

Application source code under `src/core/*`, `src/worker/*`, `src/ui/*`, `index.html`, `frontend/*`, `core/*`, and `server/app.py` remains untouched.

---

## 3. Detailed Component Specifications

### 3.1 Playwright CI Gate Hardening (`scripts/verify-browser-ux.mjs`, `.github/workflows/ci.yml`)

#### 3.1.1 Chromium Launch Arguments
When running in CI environments or headless Linux, Chromium is launched with:
- `--enable-webgl`: Forces WebGL enablement even when blocklisted.
- `--ignore-gpu-blocklist`: Disregards driver blocklists.
- `--disable-dev-shm-usage`: Uses `/tmp` instead of `/dev/shm` to avoid shared-memory exhaustion in Docker/CI.
- `--use-gl=angle`: Directs Chromium to use the ANGLE translation layer.
- `--use-angle=swiftshader`: Forces CPU-based SwiftShader software rasterizer for ANGLE.
- `--enable-unsafe-swiftshader`: Permits software rasterization in headless mode.
- `--no-sandbox`: Required for unprivileged container runners when `process.env.CI` is active.

#### 3.1.2 CI Adaptive Timeouts & Error Isolation
- Detect `process.env.CI`: Scale 3D WebGL and DOM ready timeouts (e.g., 60,000 ms on CI vs 30,000 ms locally).
- Guard against telemetry IPC race conditions by awaiting target DOM state (`page.waitForFunction(() => document.getElementById('toggle-hifi-attitude')?.checked === true)`).
- Filter harmless software-WebGL console warnings (e.g., SwiftShader driver notifications) from fatal uncaught error traps while preserving all real JavaScript `pageerror` events.
- On step failure, log the active viewport name, step label, and accumulated runtime errors before exiting.

#### 3.1.3 GitHub Actions Workflow Configuration
- In `.github/workflows/ci.yml`, assign `timeout-minutes: 15` to the `browser-ux` job.
- Export `CI: "true"` explicitly.
- Maintain `permissions: contents: read`.

### 3.2 `ts_parity_server.ts` Security & Dependency Hardening

#### 3.2.1 Loopback CORS & Configurable Origins
- Validate origins against `^https?://(localhost|127\.0\.0\.1)(:\d+)?$`.
- In addition, allow origins configured in comma-separated `process.env.XBAND_CORS_ORIGINS`.
- Disallow wildcard `*`. Emit `Vary: Origin`.

#### 3.2.2 Constant-Time API Token Authentication
- Read `process.env.XBAND_API_TOKEN`. When non-empty:
  - Intercept mutating HTTP requests (`POST`, `PUT`, `PATCH`, `DELETE`).
  - Read token from `X-API-Key` or `Authorization: Bearer <token>`.
  - Hash both provided token and configured token with SHA-256 (`crypto.createHash('sha256')`).
  - Compare the 32-byte digests using `crypto.timingSafeEqual(hashProvided, hashExpected)`. This prevents length-leak timing side channels.
  - Return HTTP `401 Unauthorized` (`{"error": "Unauthorized: Invalid or missing API token"}`) on mismatch or absence.
  - Read-only endpoints (`GET`, `OPTIONS`, `HEAD`) remain accessible.

#### 3.2.3 Request Body Sizing & Concurrency
- Enforce `MAX_BODY_BYTES = 1_048_576` (1 MB) in `readJsonBody`. If exceeded, destroy stream and return HTTP `413 Payload Too Large`.
- Malformed JSON returns HTTP `400 Bad Request`.
- Cap concurrent SSE connections to 32. Return HTTP `503 Service Unavailable` with `Retry-After: 5` when saturated. Clean up client references on `req.on('close')` and `res.on('error')`.

#### 3.2.4 Capabilities Handshake Contract
- Support honest capability reporting with `engine: "typescript-parity-server"`, `canonical_runtime: "typescript"`, `parity_status: "full-canonical-ts"`, and `transport: "rest+sse"`.
- Maintain backward-compatible output for existing test suites when queried under default options.

### 3.3 Electron PMTiles v3 RFC 9110 Byte-Range Serving (`electron/main.cjs`)

#### 3.3.1 Async I/O & Realpath Symlink Containment
- Replace synchronous `fs.readFileSync` with `fs.promises` (`stat`, `realpath`, `open`, `readFile`).
- Resolve `realRoot = await fs.promises.realpath(TILES_ROOT)` and `realTarget = await fs.promises.realpath(normalizedTarget)`.
- If `!realTarget.startsWith(realRoot + path.sep)`, return HTTP `403 Forbidden: Symlink traversal outside tiles directory`.
- Return HTTP `404 Not Found` if file does not exist or is not a regular file.

#### 3.3.2 MIME Mapping
- Support `.pmtiles` as `application/octet-stream`.

#### 3.3.3 RFC 9110 Range Header Processing
- Always emit `Accept-Ranges: bytes`.
- When `Range` header is present:
  - Parse `bytes=<start>-<end>`, `bytes=<start>-`, or suffix `bytes=-<suffixLength>`.
  - Validate boundaries against `stats.size`. If invalid (e.g. `start >= size` or `start > end`), return HTTP `416 Range Not Satisfiable` with `Content-Range: bytes */${size}`.
  - Open file handle using `await fs.promises.open(realTarget, 'r')`.
  - Read slice into allocated buffer via `fileHandle.read(buf, 0, len, start)` within a `try / finally { await fileHandle.close(); }` block.
  - Return HTTP `206 Partial Content` with:
    - `Content-Range: bytes ${start}-${end}/${size}`
    - `Content-Length: ${len}`
    - `Accept-Ranges: bytes`
    - `Content-Type: ${mimeType}`
- When no `Range` header is present:
  - If `stats.size > 64 * 1024 * 1024` (64 MB), return HTTP `413 Payload Too Large` to prevent memory exhaustion on giant tile databases.
  - Otherwise, return HTTP `200 OK` with full buffer, `Accept-Ranges: bytes`, and appropriate `Content-Length`.

---

## 4. Verification & Testing Strategy

### 4.1 Suite 115 (`src/tests/verifyHardeningFix01.ts`)
1. **[FIX01-T1] Live `ts_parity_server` Security & Parity Tests:**
   - Spins up server on port `0`.
   - Tests loopback CORS acceptance and remote origin rejection.
   - Tests `XBAND_CORS_ORIGINS` custom allowlist.
   - Tests constant-time API token protection (401 on missing/invalid, 200 on valid `X-API-Key` and `Bearer`).
   - Tests 1 MB body size enforcement (413 response).
   - Tests malformed JSON rejection (400 response).
   - Tests SSE connection lifecycle and client limit enforcement.
   - Tests `/api/capabilities` payload contract.
2. **[FIX01-T2] Electron `xband-tile://` PMTiles Range & Security Audit:**
   - Verifies `electron/main.cjs` has zero synchronous `fs.readFileSync` calls inside `protocol.handle`.
   - Verifies canonical `realpath` symlink containment logic.
   - Verifies RFC 9110 Range handling (`206 Partial Content`, `416 Range Not Satisfiable`, `Accept-Ranges: bytes`).
   - Verifies `.pmtiles` MIME mapping.
3. **[FIX01-T3] `package.json` & CI Workflow Gate:**
   - Verifies `"server:ts"` uses `vite-node server/ts_parity_server.ts`.
   - Verifies `"version": "3.0.0"`.
   - Verifies `.github/workflows/ci.yml` syntax, `timeout-minutes: 15`, and step definitions.
