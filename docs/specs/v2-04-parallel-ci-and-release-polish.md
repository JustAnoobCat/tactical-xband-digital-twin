# SPEC-V2-04: Parallelized Verification Runner, Bulletproof CI & Release Polish

**Specification Document:** `docs/specs/v2-04-parallel-ci-and-release-polish.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** DevOps / Systems Architecture / Performance Optimization  
**Applies to Modules:** `scripts/run_all_verifications.mjs`, `.github/workflows/ci.yml`, `README.md`  

---

## 1. Executive Summary & Objective

This specification details the design and implementation of Milestone **V2-04**, the final engineering milestone of the Tactical X-Band Air-to-Ground Network Digital Twin:
1. **Parallelized Verification Runner (`scripts/run_all_verifications.mjs`):** Replaces the sequential single-threaded execution loop with a bounded, async worker pool (`child_process.spawn`), slashing full verification runtime by $\approx 3\times$ to $4\times$ (from $\sim 300\text{–}340\text{s}$ down to $\sim 75\text{–}110\text{s}$ on multi-core systems) while guaranteeing deterministic ordered reporting, fail-fast gatekeeping, `--concurrency=N` / `VERIFY_CONCURRENCY` controls, and `--serial` fallback.
2. **Hardened Multi-Job CI Quality Gate (`.github/workflows/ci.yml`):**
   - Guarantees `httpx` dependency installation in `python-verify` alongside `requirements.txt`, `pytest`, and `python-multipart` so FastAPI `TestClient` never fails on pristine Ubuntu GitHub runners.
   - Adds a dedicated, automated **`browser-ux`** job installing Playwright Chromium and executing the 4-viewport frontend UX audit (`1440×900`, `1366×768`, `1024×768`, `780×840`) on every push and pull request to `main`.
3. **Canonical Documentation Synchronization (`README.md`):** Synchronizes verification counts to 102 TypeScript suites, 27 Python pytest suites, 4-viewport Playwright CI, and references milestones V2-01 through V2-04 with zero broken local links.

---

## 2. Architectural Invariants & Scope Boundaries

### 2.1 Operational Boundaries
Per `AGENTS.md` and Milestone V2-04 guidelines:
- **Authorized File Seams:**
  - `docs/specs/v2-04-parallel-ci-and-release-polish.md` (new specification)
  - `scripts/run_all_verifications.mjs` (bounded parallel runner implementation)
  - `.github/workflows/ci.yml` (CI dependency and Playwright job hardening)
  - `README.md` (documentation and metric updates)
- **Forbidden Modifications:**
  - No changes to simulation physics (`src/core/*`, `core/*`), Web Worker runtime (`src/worker/*`), UI presentation (`src/ui/*`, `index.html`, `frontend/*`), prototype server (`server/*`), desktop wrapper (`electron/*`), or dependency declarations (`package.json`).
- **Workspace State Integrity:** Zero destructive Git write operations (`git reset`, `git checkout -- .`, `git stash`).

### 2.2 Simulation & Safety Invariants
- **Non-Interference:** Parallel verification processes run in isolated child Node.js processes. No suite modifies or depends on global mutation of shared simulation state.
- **Fail-Fast Integrity:** If any single suite fails or times out, the runner records detailed diagnostic information (exit code, duration, stderr tail, error message) and terminates with a non-zero exit code (`1`).
- **Least-Privilege CI Security:** The top-level workflow retains `permissions: contents: read` with `cancel-in-progress: true` concurrency grouping.

---

## 3. Concurrency Pool Architecture (`scripts/run_all_verifications.mjs`)

### 3.1 Concurrency Resolution & Flag Parsing
The parallel runner resolves execution concurrency with the following precedence:
1. `--serial` CLI argument $\implies \text{concurrency} = 1$.
2. `--concurrency=N` or `--concurrency N` CLI argument $\implies \text{clamped to } [1, 16]$.
3. `process.env.VERIFY_CONCURRENCY` environment variable $\implies \text{clamped to } [1, 16]$.
4. Default fallback: $\min(4, \max(1, \text{os.cpus}().\text{length}))$.

### 3.2 Gatekeeping Phase (Fail-Fast Pre-Flight)
Before launching the parallel worker pool across dozens of suites, the runner executes two essential gatekeeping suites in sequence (if present in the run set):
1. `verify-project`: Validates repository structure, HTML tab mounts, and essential artifacts.
2. `typecheck`: Runs `tsc --noEmit` across all TypeScript modules.

If either gatekeeper fails:
- Diagnostics are immediately emitted.
- If `--bail` is enabled, execution halts immediately before CPU resources are spent on test fan-out.

### 3.3 Bounded Async Worker Pool
The remaining verification suites are queued into an async task pool:
```typescript
interface SuiteTask {
  readonly suite: RegisteredSuite;
  readonly originalIndex: number;
}
```
A fixed number of concurrent workers (matching `concurrency`) pull tasks asynchronously from the shared queue:
- **Non-Blocking Spawning:** Each suite runs via `child_process.spawn(suite.command, suite.args, { stdio: ['ignore', 'pipe', 'pipe'] })`.
- **Per-Suite Timeout Budget:** Retains the 120,000 ms timeout per child process. Hung processes receive `SIGTERM` followed by a hard `SIGKILL` after 2,000 ms.
- **Deterministic Array Placement:** Each completed suite result is written to `results[task.originalIndex]`, preserving the exact canonical registry order regardless of completion sequence.
- **Atomic Progress Logging:** As each suite finishes, a single-line status is printed with its completion index, duration, and any error message without interleaved terminal corruption.

### 3.4 Disk I/O & Temporary File Isolation Audit
An audit of all registered suites confirms:
- 96 suites operate entirely in-memory with zero disk mutations.
- `verifyDeterminismTrace.ts` writes deterministic replay traces to `benchmark_results/generated/temp_trace_t*.json` with unique file names and immediate unlinking within `try { ... } finally { ... }`.
- No race conditions or temp file collisions exist when running suites concurrently.

---

## 4. GitHub Actions CI Hardening (`.github/workflows/ci.yml`)

### 4.1 Explicit `httpx` Guarantee in `python-verify`
FastAPI `TestClient` in modern FastAPI versions requires `httpx` as its underlying transport client. On fresh CI runners, `requirements.txt` might be cached or missing wheel dependencies. Explicitly invoking:
```bash
python -m pip install -r requirements.txt pytest python-multipart httpx
```
ensures all 27 Python tests (`tests/test_server.py`, `tests/test_server_security.py`, etc.) pass reliably across every runner instance.

### 4.2 Dedicated `browser-ux` Job (Playwright Chromium)
Adds an independent, parallel CI job validating the responsive multi-viewport layout:
```yaml
  browser-ux:
    name: Playwright Browser UX Gate
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Chromium & system deps
        run: npx playwright install --with-deps chromium

      - name: Build Vite project
        run: npm run build

      - name: Run Playwright multi-viewport browser UX verification
        run: node scripts/verify-browser-ux.mjs
```
This tests:
1. Desktop (`1440×900`)
2. Standard Laptop (`1366×768`)
3. Constrained Laptop (`1024×768`)
4. Mobile Split (`780×840`)
Ensuring zero overlay collisions, accessible WCAG contrast, proper DOM mounts, and responsive CSS containers.

---

## 5. Documentation Synchronization (`README.md`)

`README.md` is updated to reflect the full, hardened engineering matrix:
- **Suite Metrics:** 102 TypeScript suites (parallelized `npm run verify:all`), 27 Python pytest suites (`pytest -v`), and 4-viewport Playwright Chromium UX gate.
- **Milestones V2-01 to V2-04:** Documented in Key Scientific & Architectural Capabilities and Architecture Specifications with zero broken local links.
- **CLI Options:** Documents `--concurrency=N` and `--serial` runner flags.

---

## 6. Verification Criteria

Completion of V2-04 requires clean execution of:
1. `python3 -c "import yaml, glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]; print('YAML OK')"`
2. Markdown local link validator on `README.md` (0 broken links).
3. `npm run typecheck`
4. `pytest -v` (27 / 27 passed)
5. `npm run build`
6. `node scripts/verify-browser-ux.mjs` (4 / 4 viewports passed)
7. `npm run verify:all` (parallel execution completing within target duration)
8. `git status --short` ensuring clean state across non-seam files.
