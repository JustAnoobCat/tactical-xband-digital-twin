/**
 * Node worker_threads entry for executing headless 50 Hz simulation trials in parallel.
 */

import { parentPort } from 'node:worker_threads';
import {
  runSingleHeadlessTrial,
  type HeadlessTrialOptions,
  type HeadlessTrialResult,
} from '../src/core/batchSimulationRunner';

export type CliWorkerInboundMessage =
  | { readonly type: 'RUN_TRIAL'; readonly options: HeadlessTrialOptions }
  | { readonly type: 'SHUTDOWN' };

export type CliWorkerOutboundMessage =
  | { readonly type: 'TRIAL_DONE'; readonly result: HeadlessTrialResult }
  | { readonly type: 'TRIAL_ERROR'; readonly seed: number; readonly error: string };

if (!parentPort) {
  throw new Error('stratos_cli_worker.ts must be executed inside a Node worker_threads Worker');
}

const port = parentPort;

port.on('message', (msg: CliWorkerInboundMessage) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'SHUTDOWN') {
    port.close();
    return;
  }
  if (msg.type === 'RUN_TRIAL') {
    try {
      const result = runSingleHeadlessTrial(msg.options);
      const reply: CliWorkerOutboundMessage = { type: 'TRIAL_DONE', result };
      port.postMessage(reply);
    } catch (err) {
      const reply: CliWorkerOutboundMessage = {
        type: 'TRIAL_ERROR',
        seed: msg.options.seed,
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      };
      port.postMessage(reply);
    }
  }
});
