# Benchmark Results Generated Directory

This directory contains output artifacts from headless simulation benchmark runs and verification reports.

## Tracked Legacy Baseline
- `typescript-benchmark-2026-10-27T06-51-55-930Z.json`
- `typescript-benchmark-2026-10-27T06-51-55-930Z.csv`

**Legacy Artifact Annotation**:
This artifact represents the pre-M0.1 baseline executed on October 27, 2026 (schema version 1.1). It captures a 5,000-frame, 10-seed synthetic terrain run. It is tracked in Git for historical comparison. Note that it lacks modern provenance fields introduced in Milestone M0.1:
- Git commit hash, branch, and working-tree dirty status
- CPU model and core counts
- Host operating system and Node.js version
- Cryptographic SHA-256 terrain checksum
- Per-step latency percentiles ($p50, p95, p99$)
- Dedicated setup phase timing (`setup_phase_ms`)

## Modern Schema (Schema 1.3)
Subsequent benchmark artifacts (schema 1.3) include complete machine and environment provenance, setup latency separate from step latency, isolated warm-up execution, and SHA-256 asset checksums for authentic satellite DEM ingestion.
