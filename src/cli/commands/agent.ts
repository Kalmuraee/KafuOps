import { loadConfigOrExit } from '../util.js';
import { startWebhookServer } from '../../webhooks/server.js';
import { log } from '../../util/logger.js';

/**
 * `kafuops agent start` — for MVP, the agent runs the webhook listener and waits.
 * In a richer implementation it would tail log files configured in runtime.log_sources.
 */
export async function agentStart(opts: { port?: number }): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  log.banner(`KafuOps agent — service=${config.project.service_name ?? config.project.name}`);
  await startWebhookServer({ rootDir, config, port: opts.port });
  log.info('Agent ready. Send events to POST /v1/events or webhooks/* endpoints.');
  process.stdin.resume();
}

/**
 * `kafuops worker start` — placeholder that periodically processes new incidents.
 * For the MVP, the worker simply listens for SIGTERM and stays up so it can be
 * driven by `kafuops incidents *` commands and webhook ingestion.
 */
export async function workerStart(): Promise<void> {
  const { config } = loadConfigOrExit();
  log.banner(`KafuOps worker — analysis pipeline ready`);
  log.info(`LLM provider: ${config.llm.provider}, models: analysis=${config.llm.models.analysis} patch=${config.llm.models.patch}`);
  log.info('Worker idle. Drive analysis with `kafuops incidents analyze <id>` or `open-mr <id>`.');
  process.stdin.resume();
}
