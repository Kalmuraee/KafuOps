import { KafuOpsConfig } from '../config/schema.js';
import { Incident, IncidentStatus } from '../types/index.js';
import { IncidentStore } from './store.js';
import { processIncidentToMr, PipelineResult } from './pipeline.js';
import { log } from '../util/logger.js';

/** Statuses that still warrant an automatic processing pass. */
const ACTIONABLE: IncidentStatus[] = ['created', 'context_built', 'analyzed'];

/** Pure selection: which incidents the worker should pick up this tick. */
export function selectPendingIncidents(incidents: Incident[]): Incident[] {
  return incidents.filter((i) => ACTIONABLE.includes(i.status));
}

export interface WorkerRunOptions {
  rootDir: string;
  config: KafuOpsConfig;
  inPlace?: boolean;
  dryRun?: boolean;
}

/** Process every pending incident once. Returns the per-incident results. */
export async function runWorkerOnce(opts: WorkerRunOptions): Promise<PipelineResult[]> {
  const store = new IncidentStore(opts.rootDir);
  const pending = selectPendingIncidents(store.list());
  const results: PipelineResult[] = [];
  for (const inc of pending) {
    // Claim the incident so a second worker (or a concurrent `open-mr`) doesn't
    // process it at the same time. Skip if already claimed.
    if (!store.tryClaim(inc.id)) {
      log.debug(`worker: ${inc.id} already claimed; skipping`);
      continue;
    }
    try {
      const r = await processIncidentToMr(opts.rootDir, opts.config, inc.id, {
        invocation: 'auto',
        inPlace: opts.inPlace,
        dryRun: opts.dryRun,
      });
      results.push(r);
      log.info(`worker: ${r.incidentId} → ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    } catch (err) {
      log.error(`worker: ${inc.id} failed: ${(err as Error).message}`);
    } finally {
      store.releaseClaim(inc.id);
    }
  }
  return results;
}

export interface WorkerLoopOptions extends WorkerRunOptions {
  intervalSeconds?: number;
  /** Run a single pass and return (used by tests and one-shot CLI). */
  once?: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Background analysis loop: poll the incident store and drive each pending
 * incident through the pipeline. Honors a stop signal so it shuts down cleanly.
 */
export async function runWorkerLoop(opts: WorkerLoopOptions): Promise<void> {
  const interval = (opts.intervalSeconds ?? 30) * 1000;
  if (opts.once) {
    const results = await runWorkerOnce(opts);
    log.ok(`worker: processed ${results.length} incident(s).`);
    return;
  }
  let stop = false;
  const onSignal = (): void => {
    log.info('worker: shutting down…');
    stop = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  log.ok(`worker: polling every ${opts.intervalSeconds ?? 30}s. Ctrl-C to stop.`);
  while (!stop) {
    await runWorkerOnce(opts);
    // Sleep in short slices so a stop signal is honored promptly.
    for (let waited = 0; waited < interval && !stop; waited += 500) {
      await sleep(Math.min(500, interval - waited));
    }
  }
}
