import { loadConfigOrExit } from '../util.js';
import { KafuOpsConfig } from '../../config/schema.js';
import { PolicyEngine, FileDecision, PolicyDecision } from '../../policies/engine.js';
import { IncidentStore } from '../../incident/store.js';
import { log } from '../../util/logger.js';

export async function policiesValidate(): Promise<void> {
  const { config } = loadConfigOrExit();
  const denyCount = config.policies.never_modify.length;
  const approveCount = config.policies.require_approval_to_modify.length;
  const open = config.policies.confidence.open_mr_if_score_at_least;
  const approval = config.policies.confidence.require_human_approval_if_below;
  if (approval < open) {
    log.error('confidence.require_human_approval_if_below should be >= open_mr_if_score_at_least');
    process.exit(2);
  }
  log.ok(`Policies: ${denyCount} never_modify globs, ${approveCount} require_approval globs`);
  log.ok(`Confidence thresholds: open>=${open}, auto-approval>=${approval}`);
}

export interface IncidentPolicyReport {
  files: FileDecision[];
  outcome: PolicyDecision;
  reasons: string[];
}

/**
 * Evaluate the policy decision for the files an incident's patch actually
 * changed (persisted as changed-files.json by the pipeline). Returns null if the
 * incident does not exist.
 */
export function incidentPolicyReport(
  rootDir: string,
  config: KafuOpsConfig,
  id: string,
): IncidentPolicyReport | null {
  const store = new IncidentStore(rootDir);
  if (!store.load(id)) return null;
  const files = store.loadChangedFiles(id) ?? [];
  const policy = new PolicyEngine(config);
  const decisions = policy.decideFiles(files);
  const combined = policy.combine(decisions);
  return { files: decisions, outcome: combined.outcome, reasons: combined.reasons };
}

export async function policiesExplain(opts: { file?: string; incident?: string }): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  if (opts.incident) {
    const report = incidentPolicyReport(rootDir, config, opts.incident);
    if (!report) {
      log.error(`Incident ${opts.incident} not found`);
      process.exit(1);
    }
    log.info(`Incident: ${opts.incident}`);
    if (!report.files.length) {
      log.warn('No changed files recorded yet (run `incidents open-mr` first).');
      return;
    }
    log.info(`Overall: ${report.outcome}`);
    for (const d of report.files) {
      log.info(`  ${d.decision.padEnd(16)} ${d.file}${d.reason ? ` — ${d.reason}` : ''}`);
    }
    return;
  }
  if (opts.file) {
    const policy = new PolicyEngine(config);
    const decision = policy.decideFile(opts.file);
    log.info(`File: ${opts.file}`);
    log.info(`Decision: ${decision.decision}`);
    if (decision.reason) log.info(`Reason: ${decision.reason}`);
    return;
  }
  log.error('Provide --file <path> or --incident <id>.');
  process.exit(2);
}
