import chalk from 'chalk';
import { loadConfigOrExit } from '../util.js';
import { IncidentStore } from '../../incident/store.js';
import { summarizeIncidents, renderStatusLines } from '../../incident/summary.js';
import { printBox } from '../../util/ui.js';

/** `kafuops status` — a one-shot dashboard of incidents and config. */
export async function statusCommand(): Promise<void> {
  const { config, rootDir } = loadConfigOrExit({ allowMissing: true });
  const store = new IncidentStore(rootDir);
  const summary = summarizeIncidents(store.list());
  printBox('KafuOps', renderStatusLines(summary, { mode: config.runtime.mode, provider: config.llm.provider }));
}

/** `kafuops watch` — live-refreshing dashboard (Ctrl-C to stop). */
export async function watchCommand(opts: { intervalSeconds?: number } = {}): Promise<void> {
  const { config, rootDir } = loadConfigOrExit({ allowMissing: true });
  const store = new IncidentStore(rootDir);
  const intervalMs = (opts.intervalSeconds ?? 5) * 1000;
  let stop = false;
  process.on('SIGINT', () => {
    stop = true;
  });
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  while (!stop) {
    process.stdout.write('\x1Bc'); // clear screen
    const summary = summarizeIncidents(store.list());
    printBox('KafuOps · watch', renderStatusLines(summary, { mode: config.runtime.mode, provider: config.llm.provider }));
    console.log(chalk.dim(`refreshing every ${opts.intervalSeconds ?? 5}s · Ctrl-C to stop`));
    await sleep(intervalMs);
  }
}
