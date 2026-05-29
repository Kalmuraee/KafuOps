import { loadConfigOrExit } from '../util.js';
import { startWebhookServer } from '../../webhooks/server.js';
import { IncidentEngine } from '../../incident/engine.js';
import { IncidentStore } from '../../incident/store.js';
import { LogTailer } from '../../runtime/tailer.js';
import { persistIncidentLogs } from '../../runtime/capture.js';
import { runWorkerLoop } from '../../incident/worker.js';
import { log } from '../../util/logger.js';
import { RuntimeEvent } from '../../types/index.js';

/**
 * `kafuops agent start` — the sidecar. It listens for webhook ingestion AND,
 * when `runtime.log_sources` contains file sources (and observability.logs is
 * enabled), tails those files and feeds parsed errors into the same incident
 * pipeline as wrapper mode.
 */
export async function agentStart(opts: { port?: number }): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  log.banner(`KafuOps agent — service=${config.project.service_name ?? config.project.name}`);
  await startWebhookServer({ rootDir, config, port: opts.port });

  const fileSources = config.runtime.log_sources.filter((s) => s.type === 'file');
  if (config.observability.logs.enabled && fileSources.length) {
    const engine = new IncidentEngine(rootDir, config);
    const store = new IncidentStore(rootDir);
    const tailer = new LogTailer({
      sources: fileSources,
      service: config.project.service_name ?? config.project.name,
      environment: process.env.KAFUOPS_ENV ?? 'production',
      config,
      rootDir,
    });
    tailer.on('event', (ev: RuntimeEvent) => {
      const incident = engine.ingest(ev);
      if (incident) {
        persistIncidentLogs(store, incident, tailer.getBuffer(), config);
        log.warn(`Incident ${incident.id} from logs: ${incident.summary}`);
      }
    });
    tailer.start();
    log.ok(`Tailing ${tailer.sourceCount()} log source(s).`);
  } else if (fileSources.length && !config.observability.logs.enabled) {
    log.warn('runtime.log_sources configured but observability.logs.enabled=false — not tailing.');
  }

  log.info('Agent ready. Send events to POST /v1/events or webhooks/* endpoints.');
  process.stdin.resume();
}

/**
 * `kafuops worker start` — background analysis loop. Polls the incident store
 * and drives each pending incident through the analyze → patch → validate → MR
 * pipeline automatically (invocation='auto', so llm.trigger_mode=manual_only is
 * respected). Use --once for a single pass, --interval to tune the cadence.
 */
export async function workerStart(opts: { intervalSeconds?: number; once?: boolean } = {}): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  log.banner(`KafuOps worker — analysis pipeline ready`);
  log.info(
    `LLM provider: ${config.llm.provider}, models: analysis=${config.llm.models.analysis} patch=${config.llm.models.patch}`,
  );
  await runWorkerLoop({
    rootDir,
    config,
    intervalSeconds: opts.intervalSeconds,
    once: opts.once,
  });
}
