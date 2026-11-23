# SPEC-WP01: Continuous Integration & Deployment Quality Gate

**Specification Document:** `docs/specs/wp01-ci-quality-gate.md`  
**Status:** Approved  
**Execution Lead:** Role 2 Coder / Implementer  
**Classification:** DevOps / Automated Quality Assurance & Verification  
**Applies to Modules:** `.github/workflows/ci.yml`, `.github/workflows/deploy-pages.yml`  

---

## 1. Executive Summary & Objective

This specification establishes an automated Continuous Integration (CI) quality gate for the **DRDO Tactical X-Band Air-to-Ground Network Digital Twin** repository.

### 1.1 Core Objectives
1. **Automated Verification:** Execute comprehensive TypeScript verification (`typecheck`, `verify:all`, `build`) and Python prototype test suites (`pytest -v`) across all pull requests targeting `main` and pushes to `main`.
2. **Deployment Guardrail:** Enforce strict gating on GitHub Pages deployments (`.github/workflows/deploy-pages.yml`), ensuring that production artifacts are only built and deployed if TypeScript typechecking and the full verification test suite pass completely.
3. **Least-Privilege Security & Resource Efficiency:** Standardize workflows to use least-privilege permissions (`contents: read` on CI runs) and automated concurrency cancellation (`cancel-in-progress: true`) for stale in-flight runs.

---

## 2. Architectural Invariants & Scope Boundaries

### 2.1 Operational Boundaries
Per `AGENTS.md`, modifications are strictly confined to CI configuration seams:
- `.github/workflows/ci.yml` (Unified CI workflow)
- `.github/workflows/deploy-pages.yml` (Pages deployment workflow with verification gate)
- `docs/specs/wp01-ci-quality-gate.md` (This specification)

No application source files under `src/`, `core/`, `server/`, `electron/`, `frontend/`, `scripts/`, or `package.json` may be modified.

### 2.2 Simulation Integrity Guard
The CI gate ensures that all changes committed to `main` or proposed in pull requests respect:
1. **Worker State Authority:** The background Web Worker (`src/worker/simWorker.ts`) remains the authoritative state owner.
2. **50 Hz Loop Budget:** Discrete-event loop runtime budget ($\Delta t = 20\text{ ms}$) validated via `verify:worker` and related benchmarks in `verify:all`.
3. **Physical & RF Rigor:** Preserves ITU-R P.676 absorption, ITU-R P.838 rain attenuation, ITU-R P.526 diffraction, DVB-S2X MODCOD lookups, and 3GPP NTN parameters.

---

## 3. Workflow Specifications

### 3.1 Unified CI Workflow (`.github/workflows/ci.yml`)

The primary CI workflow validates both the TypeScript simulation engine and the Python reference modules in parallel jobs.

- **Triggers:**
  - `push`: branches `["main"]`
  - `pull_request`: branches `["main"]`
  - `workflow_dispatch`: manual execution
- **Top-Level Permissions:**
  ```yaml
  permissions:
    contents: read
  ```
- **Concurrency Management:**
  ```yaml
  concurrency:
    group: ${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: true
  ```

#### 3.1.1 Job 1: `ts-verify`
- **Runner:** `ubuntu-latest`
- **Node.js Environment:** Version `22` (aligned with `deploy-pages.yml`), caching `npm`.
- **Execution Pipeline:**
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with `node-version: 22` and `cache: 'npm'`
  3. `npm ci`: Clean install of production and developer dependencies.
  4. `npm run typecheck`: TypeScript compiler verification (`tsc --noEmit`).
  5. `npm run verify:all`: Full verification runner (`node scripts/run_all_verifications.mjs`) covering all 86 registered test suites.
  6. `npm run build`: Vite production bundle compilation (`vite build`).

#### 3.1.2 Job 2: `python-verify`
- **Runner:** `ubuntu-latest`
- **Python Environment:** Version `3.11`, caching `pip`.
- **Execution Pipeline:**
  1. `actions/checkout@v4`
  2. `actions/setup-python@v5` with `python-version: '3.11'` and `cache: 'pip'`
  3. Dependency Installation:
     ```bash
     python -m pip install --upgrade pip
     pip install -r requirements.txt
     pip install pytest python-multipart
     ```
  4. Test Execution:
     ```bash
     pytest -v
     ```
     with `PYTHONPATH: .` to ensure `core` and `server` packages resolve properly.

---

### 3.2 GitHub Pages Deployment Workflow (`.github/workflows/deploy-pages.yml`)

The deployment workflow publishes the production Vite application to GitHub Pages when changes land on `main`.

- **Triggers:** `push` on `["main"]`, `workflow_dispatch`.
- **Permissions:**
  - `contents: read`
  - `pages: write`
  - `id-token: write`
- **Concurrency:** `group: "pages"`, `cancel-in-progress: true`.
- **Gating Architecture:**
  - Inside the `build` job, prior to running `npm run build` and configuring/uploading Pages artifacts:
    1. `npm run typecheck`
    2. `npm run verify:all`
  - If either step fails, the `build` job terminates immediately with a non-zero exit code.
  - The `deploy` job preserves `needs: build`, guaranteeing that broken code is never deployed to the live environment.

---

## 4. Verification Matrix & Acceptance Criteria

| Check / Requirement | Target / Command | Success Criteria |
|---|---|---|
| CI Workflow Creation | `.github/workflows/ci.yml` | Valid YAML, triggers on push/PR to main, parallel `ts-verify` and `python-verify` jobs |
| Pages Workflow Gating | `.github/workflows/deploy-pages.yml` | `npm run typecheck` and `npm run verify:all` run before build; `deploy` requires `build` |
| Security Invariant | `permissions: contents: read` | Default read-only permissions configured at root level for CI |
| TypeScript Typecheck | `npm run typecheck` | Zero type errors (`tsc --noEmit` exits 0) |
| Production Build | `npm run build` | Vite build succeeds and generates `./dist` artifacts |
| Full Test Suite | `npm run verify:all` | All 86 verification suites pass |
| Python Test Suite | `pytest -v` | All 17 physics, scheduler, trajectory, and server tests pass |
| YAML Syntax Validation | Python `yaml.safe_load` | Both workflow YAML files parse without syntax errors |
| Scope Boundary | `git status --short` | Strict confinement to approved files |
