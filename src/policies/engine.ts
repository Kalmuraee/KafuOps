import { minimatch } from 'minimatch';
import { KafuOpsConfig } from '../config/schema.js';

export type PolicyDecision = 'allow' | 'require_approval' | 'deny';

export interface FileDecision {
  file: string;
  decision: PolicyDecision;
  reason?: string;
}

export class PolicyEngine {
  constructor(private readonly config: KafuOpsConfig) {}

  /** Check whether KafuOps may modify a given repo-relative file. */
  decideFile(file: string): FileDecision {
    for (const g of this.config.policies.never_modify) {
      if (minimatch(file, g, { dot: true })) {
        return { file, decision: 'deny', reason: `Matches never_modify pattern \`${g}\`` };
      }
    }
    for (const g of this.config.policies.require_approval_to_modify) {
      if (minimatch(file, g, { dot: true })) {
        return { file, decision: 'require_approval', reason: `Matches require_approval pattern \`${g}\`` };
      }
    }
    return { file, decision: 'allow' };
  }

  decideFiles(files: string[]): FileDecision[] {
    return files.map((f) => this.decideFile(f));
  }

  /** Combine many file decisions into an overall outcome. */
  combine(decisions: FileDecision[]): { outcome: PolicyDecision; reasons: string[] } {
    const reasons: string[] = [];
    let worst: PolicyDecision = 'allow';
    for (const d of decisions) {
      if (d.decision === 'deny') {
        worst = 'deny';
        if (d.reason) reasons.push(`${d.file}: ${d.reason}`);
      } else if (d.decision === 'require_approval' && worst !== 'deny') {
        worst = 'require_approval';
        if (d.reason) reasons.push(`${d.file}: ${d.reason}`);
      }
    }
    return { outcome: worst, reasons };
  }

  decideMrFromConfidence(score: number): {
    decision: 'open_mr' | 'request_human_approval' | 'block';
    reason: string;
  } {
    const open = this.config.policies.confidence.open_mr_if_score_at_least;
    const approval = this.config.policies.confidence.require_human_approval_if_below;
    if (score < open) return { decision: 'block', reason: `confidence ${score} below open threshold ${open}` };
    if (score < approval) return { decision: 'request_human_approval', reason: `confidence ${score} below auto-approval threshold ${approval}` };
    return { decision: 'open_mr', reason: `confidence ${score} >= ${approval}` };
  }
}
