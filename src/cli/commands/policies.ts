import { loadConfigOrExit } from '../util.js';
import { PolicyEngine } from '../../policies/engine.js';
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

export async function policiesExplain(file: string): Promise<void> {
  const { config } = loadConfigOrExit();
  const policy = new PolicyEngine(config);
  const decision = policy.decideFile(file);
  log.info(`File: ${file}`);
  log.info(`Decision: ${decision.decision}`);
  if (decision.reason) log.info(`Reason: ${decision.reason}`);
}
