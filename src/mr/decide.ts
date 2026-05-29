import { KafuOpsConfig } from '../config/schema.js';

export interface MrActionInput {
  /** Caller asked for a dry-run (no push/open). */
  dryRun?: boolean;
  /** Post-apply policy says the changed files need human approval. */
  requiresApproval?: boolean;
}

export interface MrActionDecision {
  action: 'open' | 'save_only';
  /** Whether to auto-merge after opening (only ever true when action='open'). */
  merge: boolean;
  reasons: string[];
}

/**
 * Decide what to do with a generated patch once it has passed policy +
 * confidence + blast-radius gates. This is the single source of truth for the
 * repo.mr.enabled / auto_create / auto_merge knobs (previously auto_create and
 * auto_merge were declared but never actually gated anything).
 */
export function decideMrAction(config: KafuOpsConfig, input: MrActionInput): MrActionDecision {
  const reasons: string[] = [];
  const mr = config.repo.mr;
  if (input.dryRun) {
    reasons.push('dry-run requested');
    return { action: 'save_only', merge: false, reasons };
  }
  if (!mr.enabled) {
    reasons.push('repo.mr.enabled=false');
    return { action: 'save_only', merge: false, reasons };
  }
  if (!mr.auto_create) {
    reasons.push('repo.mr.auto_create=false — saving MR body without opening');
    return { action: 'save_only', merge: false, reasons };
  }
  if (input.requiresApproval) {
    reasons.push('changed files require human approval (policy) — not auto-opening');
    return { action: 'save_only', merge: false, reasons };
  }
  const merge = !!mr.auto_merge;
  if (merge) reasons.push('repo.mr.auto_merge=true');
  return { action: 'open', merge, reasons };
}
