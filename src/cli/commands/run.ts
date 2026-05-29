import { loadConfigOrExit } from '../util.js';
import { WrapperRuntime } from '../../runtime/wrapper.js';
import { IncidentEngine } from '../../incident/engine.js';
import { IncidentStore } from '../../incident/store.js';
import { persistIncidentLogs } from '../../runtime/capture.js';
import { log } from '../../util/logger.js';
import { RuntimeEvent } from '../../types/index.js';

export interface RunOptions {
  service?: string;
  env?: string;
  /** When true, do not pipe child output to our own stdio (used in tests). */
  silent?: boolean;
}

/**
 * `kafuops run -- <cmd> [args...]`
 * Spawns the child process under observation and reports incidents.
 */
export async function runCommand(passthrough: string[], options: RunOptions): Promise<number> {
  if (!passthrough.length) {
    log.error('Usage: kafuops run -- <command> [args...]');
    process.exit(2);
  }
  const { config, rootDir } = loadConfigOrExit();
  const service = options.service ?? config.project.service_name ?? config.project.name;
  const environment = options.env ?? process.env.KAFUOPS_ENV ?? 'local';

  const [cmd, ...args] = passthrough;
  const wrapper = new WrapperRuntime({
    command: cmd,
    args,
    service,
    environment,
    config,
  });
  const engine = new IncidentEngine(rootDir, config);
  const store = new IncidentStore(rootDir);

  wrapper.on('event', (ev: RuntimeEvent) => {
    const incident = engine.ingest(ev);
    if (incident) {
      // Snapshot the rolling log window onto the incident so the context
      // builder has real logs around the error — not just the event message.
      persistIncidentLogs(store, incident, wrapper.getBuffer(), config);
      log.warn(
        `Incident ${incident.id} created: ${incident.summary} (event_count=${incident.event_count})`,
      );
      log.dim(`  fingerprint=${incident.fingerprint}`);
      log.dim(`  reason=${incident.trigger_reason}`);
    }
  });

  return new Promise<number>((resolve) => {
    wrapper.on('exit', ({ code }) => {
      resolve(code ?? 0);
    });
    process.on('SIGINT', () => wrapper.stop('SIGINT'));
    process.on('SIGTERM', () => wrapper.stop('SIGTERM'));
    wrapper.start();
  });
}
