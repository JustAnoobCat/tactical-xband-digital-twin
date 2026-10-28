# Metrics-correction patch notes

## Changed
- `src/core/scheduler.ts`
  - Added explicit available, scheduled, and unused uplink airtime fields.
  - Added payload-bits-dequeued separately from goodput bits.
  - Added final queue backlog bits.
  - Preserved cumulative drop totals and added per-frame drop deltas using scheduler-local snapshots.
  - Tac-TAD now skips links marked as outage as well as hard-shadow/zero-rate links, preventing queue dequeue on a link explicitly marked unusable.
  - Replaced the misleading hardcoded comment with an explicit definition: Tac-TAD's outage-wasted dequeued payload is zero because unusable links are filtered before dequeue.
- `src/worker/simWorker.ts`
  - Accumulates per-run scheduled/available/unused airtime, payload dequeued, drop deltas, and final backlog for both schedulers.
  - Keeps final cumulative drop counts as final counters; it does not incorrectly add cumulative values each frame.
- `scripts/run_ts_benchmark.ts`
  - Bumped result schema to 1.1.
  - Exports run-level airtime utilization, unused airtime, payload dequeued, outage-wasted payload, observed drop increments, final cumulative drops, and final backlog.
  - Adds explicit metric definitions and limitations.
- `src/tests/verifyScheduler.ts`
  - Added checks that outage queues remain queued under Tac-TAD, airtime totals reconcile, and cumulative drops are not misreported as per-frame deltas.
- `scripts/verify-project.mjs`
  - Added structural checks for the new instrumentation.

## Verification performed in this environment
- `npm test`: PASS, 19/19 structural checks.
- TypeScript compilation of scheduler, worker, benchmark runner, and scheduler verification suite using the globally available TypeScript compiler and a temporary Node type shim: PASS.
- `src/tests/verifyScheduler.ts`: PASS, all six scheduler/queue/trajectory checks.
- Headless benchmark smoke run: PASS, 100 frames each for seeds 1 and 2. Ratios were 2.662763 and 2.978923, matching the previously observed short-run ratios.
- `npm run build`: NOT VERIFIED. The uploaded ZIP had no complete installed dependencies; `npm ci` timed out in this environment and `vite` was unavailable. Run `npm ci` then `npm run build` on the project machine.

## Interpretation cautions
- Goodput is actual packet payload dequeued while the scheduler reports a usable link; it is not an independent receiver/ACK measurement.
- Tac-TAD's zero outage-waste metric means it does not dequeue payload while a link is marked unusable. It does not mean zero unused airtime or zero RF energy waste.
- Scheduled airtime includes each allocation's guard interval. Unused airtime is available uplink time minus scheduled airtime.
- The original 10-seed, 5,000-frame result was produced before this patch and must be rerun to report corrected metrics.
- No Python/TypeScript parity claim is made.
