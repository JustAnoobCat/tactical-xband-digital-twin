# Specification V3-11: Final Typed UI Controller Extraction, Canonical Node/TS Headless Parity Server & Electron Air-Gap Offline Tile Protocol

## 1. Context & Motivation

This specification concludes the multi-phase modularization and air-gap deployment milestone for the Tactical X-Band Digital Twin:

1. **Final Typed UI Controller Extraction (`src/ui/controllers/dashboardAndAuthoringController.ts` & `index.html`):**
   - In prior phases (V3-09 and V3-10), core telemetry DOM updaters, Mission I/O, Command Palette, 2D Radar Renderer, and Direct-Manipulation Terrain Toolbox were extracted into typed modules.
   - However, `index.html` still contained monolithic logic managing Scenario Authoring Studio (Trajectory Editor, TDMA Frame Editor, 3D Obstacle Editor) and Secondary Dashboard / Scope visualizers (Polar Antenna Scope, ECDF Delay Scope, Parametric Sensitivity Sweep Scope, Network Dashboard KPI DOM updaters).
   - V3-11 extracts these remaining monolithic blocks into a strictly typed, pure factory controller (`src/ui/controllers/dashboardAndAuthoringController.ts`), achieving $\ge 1,500$ net lines removed from `index.html` while preserving 100% of DOM IDs, event bridges, accessibility labels, and zero-emoji/zero-duplicate-ID gates.

2. **Canonical Node/TS Headless Parity Server (`server/ts_parity_server.ts`):**
   - The original Python server (`server/app.py`) serves as a legacy reference prototype. The TypeScript engine (`src/`) is the sole authoritative simulation runtime per `AGENTS.md` §1.
   - V3-11 introduces `server/ts_parity_server.ts`, an out-of-the-box, zero-extra-dependency HTTP server utilizing Node.js built-in `node:http`.
   - It instantiates a private, isolated `SimulationWorkerManager` instance, completely decoupled from global state.
   - It exposes canonical endpoints (`/api/capabilities`, `/api/health`, `/api/telemetry`, `/api/tick`, `/api/config`, `/api/control`) with strict payload caps ($\le 1\text{ MB}$), loopback-only CORS, and constant-time token verification via `crypto.timingSafeEqual`.

3. **Electron Air-Gap Offline Tile Protocol & PMTiles v3 (`src/core/offlineTileProtocol.ts` & `electron/main.cjs`):**
   - Tactical military deployments operate under strict air-gap constraints without access to public tile servers or external networks.
   - V3-11 defines a secure custom scheme `xband-tile://` and a high-performance PMTiles v3 binary header parser.
   - `electron/main.cjs` registers a read-only handler confined strictly to `data/tiles/` via normalized prefix validation, preventing directory traversal attacks (`..`, `%2e`, backslashes, null bytes) while strictly preserving all WP-02 Electron security sandboxing invariants.

---

## 2. Operational Invariants & Architecture

1. **Active Authoritative Runtime:** Live mutable simulation physics remains strictly in `src/worker/simWorker.ts` (3,281 lines) at 50 Hz ($\Delta t = 20\text{ ms}$). `simWorker.ts` remains completely untouched.
2. **Stateless Tile Protocol:** `offlineTileProtocol.ts` contains zero top-level mutable state, zero side effects, zero `Math.random()`, and throws zero uncaught exceptions on malformed or malicious inputs.
3. **Canonical TS Server Decoupling:** `createTsParityServer()` never mutates process globals or binds ports upon mere module import. Ephemeral port selection (`port: 0`) allows clean, non-conflicting parallel or isolated test execution.
4. **Security Sandboxing in Electron (`WP-02`):**
   - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`.
   - Custom scheme `xband-tile:` is granted access strictly within `CSP_POLICY` (`img-src` and `connect-src`), with 0 external network hosts permitted.
   - Path-traversal attempts are rejected with HTTP 400; missing assets return HTTP 404.
5. **DOM Contract & Accessibility Preservation:**
   - 100% of existing DOM element IDs in `index.html` are preserved.
   - All `window.*` HTML event bridges (`switchAuthoringPane`, `loadPreset`, `setRadarRange`, etc.) remain fully functional.
   - Zero true emojis and zero duplicate DOM IDs across `index.html`.

---

## 3. Module Specifications

### 3.1 `src/core/offlineTileProtocol.ts`

Stateless URL validation and PMTiles v3 binary header parsing:

```ts
export interface OfflineTileRequest {
  readonly tileset: string;
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly ext: string;
  readonly relativePath: string;
}

export type ParseTileResult =
  | { readonly ok: true; readonly request: OfflineTileRequest }
  | { readonly ok: false; readonly error: string };

export function parseOfflineTileRequestUrl(rawUrl: string): ParseTileResult;

export interface PmTilesV3Header {
  readonly specVersion: number;
  readonly rootDirectoryOffset: number;
  readonly rootDirectoryLength: number;
  readonly jsonMetadataOffset: number;
  readonly jsonMetadataLength: number;
  readonly leafDirectoryOffset: number;
  readonly leafDirectoryLength: number;
  readonly tileDataOffset: number;
  readonly tileDataLength: number;
  readonly addressedTilesCount: number;
  readonly tileEntriesCount: number;
  readonly tileContentsCount: number;
  readonly clustered: boolean;
  readonly internalCompression: string;
  readonly tileCompression: string;
  readonly tileType: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly minLonDeg: number;
  readonly minLatDeg: number;
  readonly maxLonDeg: number;
  readonly maxLatDeg: number;
  readonly centerZoom: number;
  readonly centerLonDeg: number;
  readonly centerLatDeg: number;
}

export type ParsePmTilesHeaderResult =
  | { readonly ok: true; readonly header: PmTilesV3Header }
  | { readonly ok: false; readonly error: string };

export function parsePmTilesV3Header(buffer: ArrayBuffer): ParsePmTilesHeaderResult;
```

#### Traversal Defense Invariants:
- Scheme must be `xband-tile:`.
- Rejects any presence of `..`, `%2e`, `%2E`, `\`, `%5c`, `%5C`, `%00`, or null bytes.
- Validates zoom $z \in [0, 22]$ integer.
- Validates tile coordinates $x, y \in [0, 2^z - 1]$ integers.
- Allowlisted file extensions: `png`, `jpg`, `jpeg`, `webp`, `pbf`, `mvt`.
- Validates tileset identifier matches `^[a-zA-Z0-9_-]+$`.

#### PMTiles v3 Binary Invariants:
- Minimum buffer length: 127 bytes.
- Magic signature: bytes 0–6 ASCII `"PMTiles"`.
- Spec version: byte 7 uint8 `3`.
- Offsets and lengths parsed via 64-bit Little-Endian `DataView.getBigUint64`.
- Coordinates parsed via 32-bit signed Little-Endian integer divided by $10^7$.
- Compressions decoded to `'unknown' | 'none' | 'gzip' | 'brotli' | 'zstd'`.
- Tile types decoded to `'unknown' | 'mvt' | 'png' | 'jpeg' | 'webp' | 'avif'`.

---

### 3.2 `server/ts_parity_server.ts`

Canonical Node/TS Parity Server wrapping `SimulationWorkerManager`:

```ts
export interface TsParityServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly apiToken?: string;
  readonly seedOffset?: number;
}

export interface TsParityServerInstance {
  readonly server: import('node:http').Server;
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
  getAddress(): { host: string; port: number };
  getWorker(): SimulationWorkerManager;
}

export function createTsParityServer(options?: TsParityServerOptions): TsParityServerInstance;
```

#### Endpoints:
- `GET /api/capabilities`: Returns `{ engine: "canonical-typescript-node-server", parity_status: "full-canonical-parity", canonical_runtime: "typescript-simulation-worker-manager", features: [...] }`.
- `GET /api/health`: Returns `{ status: "ok", frame_index, sim_time_s }`.
- `GET /api/telemetry`: Returns latest authoritative `TelemetryFrame` JSON.
- `POST /api/tick`: Body `{ steps?: number }` ($1 \le \text{steps} \le 100$). Steps simulation and returns `{ ok: true, stepsExecuted, frame }`.
- `POST /api/config`: Validates and applies `CONFIG_UPDATE` (including HiFi physics, multi-biome, EW/ECCM, constellation). Returns `{ ok: true, result }` or HTTP 400.
- `POST /api/control`: Body `{ action: "pause" | "resume" | "reset" | "load_preset", preset?: string }`.

#### Security Invariants:
- Loopback CORS: checks `Origin` header against `^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$`. Never reflects external origins.
- Constant-time token authentication: uses `crypto.timingSafeEqual` with length matching to prevent side-channel timing attacks. Missing or mismatched tokens on `POST` return HTTP 401.
- Body size cap: strictly terminates requests exceeding $1\text{ MB}$ with HTTP 413.

---

### 3.3 `electron/main.cjs`

Offline Tile Protocol integration into Electron:
- Registers `xband-tile` as a standard, secure, fetch-enabled privileged scheme before `app.whenReady()`.
- Implements `protocol.handle('xband-tile', ...)` inside `app.whenReady()`.
- Enforces normalized path prefix containment within `path.resolve(__dirname, '../data/tiles')`.
- Returns HTTP 400 on traversal attempts (`startsWith(tilesRoot + path.sep)` failure).
- Returns HTTP 404 on missing tile files.
- Updates `CSP_POLICY` to allow `xband-tile:` in `img-src` and `connect-src` while forbidding all external internet origins.

---

### 3.4 `src/ui/controllers/dashboardAndAuthoringController.ts`

Modular extraction of:
- **Trajectory Authoring Controller:** Waypoint list management, ellipse vs. waypoint switching, draft preview sync, validation, altitude mode selection.
- **TDMA Frame Authoring Controller:** Timing calculations (slot duration, guard interval, physical radio reach, overhead percentage), preset application, draft validation, worker synchronization.
- **Obstacle Authoring Controller:** Geometry shape configuration (cuboid vs. cylinder), material profiles, inventory item rendering, draft editing, deletion, undo/redo integration.
- **Secondary Dashboard & Scopes:**
  - `drawPolarAntennaScope(frame, canvas)`: Polar radiation diagram with body-frame heading rotation and 4-sector gain envelopes.
  - `drawEcdfDelayScope(frame, canvas)`: Empirical CDF delay curves comparing Blind Static TDMA, Reactive M-LWDF, and Tac-TAD.
  - `drawSensitivitySweepScope(frame, canvas)`: Parametric sensitivity sweep curves across channel bandwidth, rain rate, and node counts.
  - `updateDashboardDOM(frame, force)`: Secondary dashboard KPI DOM nodes.

---

## 4. Verification Suite 113 (`verifyParityServerAndOfflineTiles.ts`)

Verifies:
- **[PSO-T1] Offline Tile URL Traversal Defense & PMTiles v3 Binary Parser:**
  - Validates correct parsing of standard `xband-tile://terrain/10/732/412.png`.
  - Rejects traversal attempts (`..`, `%2e`, `\`, null bytes, out-of-range $z/x/y$, forbidden file extensions).
  - Synthesizes 127-byte PMTiles v3 binary header and verifies exact field values, coordinate scales, and enums.
  - Tests truncated and corrupted buffers for safe failure without throwing.
- **[PSO-T2] Live Canonical Node/TS Parity Server End-to-End HTTP Tests:**
  - Spawns server on ephemeral port (`port: 0`) with test API token.
  - Verifies `/api/capabilities`, `/api/health`, and `/api/telemetry`.
  - Verifies loopback CORS allows `http://localhost:5173` and blocks `https://evil.example.com`.
  - Verifies constant-time token authentication (401 without/with wrong token, 200 with valid token).
  - Verifies deterministic stepping via `POST /api/tick` and config updates via `POST /api/config`.
  - Shuts down server cleanly in `finally`.
- **[PSO-T3] Electron Hardening & Final Extraction Gate:**
  - Asserts Electron CSP and security sandboxing settings in `electron/main.cjs`.
  - Verifies `dashboardAndAuthoringController.ts` exports and zero top-level mutable state.
  - Asserts net line reduction in `index.html` $\ge 1,500$ lines.
  - Asserts zero true emojis and zero duplicate DOM IDs across `index.html`.
