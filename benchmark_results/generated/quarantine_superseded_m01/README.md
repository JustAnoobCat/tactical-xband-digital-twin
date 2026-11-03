# Quarantined & Superseded M0.1 Benchmark Artifacts

The benchmark reports in this directory were generated during the initial implementation of Milestone M0.1 prior to independent audit remediation:

- `typescript-benchmark-2026-11-03T07-16-33-115Z.*`
- `typescript-benchmark-2026-11-03T07-17-03-262Z.*`
- `typescript-benchmark-2026-11-03T07-17-15-974Z.*`

## Reason for Quarantine
During the initial implementation of the `--warmup` option, warm-up ticks were executed directly on the timed `SimulationWorkerManager` instance. While individual tick latencies during warm-up were excluded from the latency measurement arrays, the worker's internal cumulative state counters (`frames_completed`, `staticGoodputBits`, `tacGoodputBits`, packet drops, and airtime) accumulated the warm-up ticks:
1. `frames_completed` recorded `105` frames instead of the requested `100` frames.
2. Throughput averages were distorted because warm-up payload was included in numerator counters while `sim_duration_s` was calculated as `frames * 0.020`.

## Remediation
Warm-up was decoupled onto a separate, isolated `warmupManager` instance (`SimulationWorkerManager(999_999)`). The isolated manager runs the warm-up ticks to compile and optimize V8 Turbofan JIT paths without altering the state or counters of the benchmark manager. Every subsequent benchmark run starts at $t=0$, `frameIndex=0`, and finishes with `frames_completed === frames_requested`.

These superseded files are preserved here solely for provenance and audit trail transparency.
