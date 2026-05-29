import chalk from 'chalk';
import { loadConfigOrExit } from '../util.js';
import { IncidentStore } from '../../incident/store.js';
import { buildContext } from '../../context/builder.js';
import { LLMOrchestrator } from '../../llm/orchestrator.js';
import { processIncidentToMr } from '../../incident/pipeline.js';
import { log } from '../../util/logger.js';

export async function listIncidents(): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const store = new IncidentStore(rootDir);
  const list = store.list();
  if (!list.length) {
    log.info('No incidents recorded yet.');
    return;
  }
  for (const i of list) {
    log.info(
      `${chalk.bold(i.id)} ${chalk.dim(i.first_seen)} ${chalk.yellow(i.severity)} ${i.status} — ${i.summary}`,
    );
  }
}

export async function showIncident(id: string): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const store = new IncidentStore(rootDir);
  const inc = store.load(id);
  if (!inc) {
    log.error(`Incident ${id} not found`);
    process.exit(1);
  }
  console.log(JSON.stringify(inc, null, 2));
}

export async function buildContextCommand(id: string): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  const store = new IncidentStore(rootDir);
  const inc = store.load(id);
  if (!inc) {
    log.error(`Incident ${id} not found`);
    process.exit(1);
  }
  const res = buildContext(rootDir, config, { incident: inc });
  log.ok(`Wrote ${res.bundle_path}`);
  log.ok(`Wrote ${res.manifest_path}`);
  log.info(`  files=${res.bundle.files.length} memory=${res.bundle.memory.length} logs=${res.bundle.evidence_packet.logs.length}`);
  inc.status = 'context_built';
  store.save(inc);
}

export async function analyzeIncident(id: string): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  const store = new IncidentStore(rootDir);
  const inc = store.load(id);
  if (!inc) {
    log.error(`Incident ${id} not found`);
    process.exit(1);
  }
  const built = buildContext(rootDir, config, { incident: inc });
  const orch = new LLMOrchestrator({ rootDir, config });
  log.info(`Analyzing incident ${inc.id}${orch.isDryRun() ? ' (dry-run)' : ''}`);
  const rc = await orch.rootCause(inc, built.bundle);
  log.ok(`Root cause: ${rc.suspected_root_cause}`);
  log.dim(`  classification=${rc.classification} should_attempt_fix=${rc.should_attempt_fix} confidence=${rc.confidence.toFixed(2)}`);
  inc.status = 'analyzed';
  store.save(inc);
  store.writeArtifact(inc.id, 'root-cause.json', JSON.stringify(rc, null, 2));
}

export interface OpenMrOptions {
  inPlace?: boolean;
  dryRun?: boolean;
}

export async function openMrCommand(id: string, options: OpenMrOptions = {}): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  const store = new IncidentStore(rootDir);
  if (!store.load(id)) {
    log.error(`Incident ${id} not found`);
    process.exit(1);
  }
  log.info(`Open MR for ${id}`);
  // The full pipeline (analyse → plan → patch → sandbox → gate → MR) lives in
  // incident/pipeline.ts so the worker can reuse it. invocation='manual' because
  // a human ran this command.
  const result = await processIncidentToMr(rootDir, config, id, {
    inPlace: !!options.inPlace,
    dryRun: !!options.dryRun,
    invocation: 'manual',
  });
  switch (result.status) {
    case 'no_fix':
      log.warn(`No fix attempted: root-cause analysis recommends no fix (${result.reason}).`);
      break;
    case 'blocked':
      log.error(`Blocked (${result.reason}). See artifacts under .kafuops/incidents/${id}/.`);
      break;
    case 'mr_saved':
      log.warn(`MR not opened (${result.reason}). Saved .kafuops/incidents/${id}/mr-body.md.`);
      break;
    case 'mr_opened':
      log.ok(`MR opened: ${result.mrUrl}`);
      break;
    case 'mr_merged':
      log.ok(`MR opened and auto-merged: ${result.mrUrl}`);
      break;
  }
  if (result.confidence != null) {
    log.dim(`  confidence=${result.confidence} risk=${result.riskLevel ?? 'n/a'}`);
  }
}

export async function markResolved(id: string): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const store = new IncidentStore(rootDir);
  const inc = store.load(id);
  if (!inc) {
    log.error(`Incident ${id} not found`);
    process.exit(1);
  }
  inc.status = 'resolved';
  store.save(inc);
  log.ok(`Incident ${id} marked resolved.`);
}
