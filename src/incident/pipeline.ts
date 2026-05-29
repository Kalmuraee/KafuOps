import { KafuOpsConfig } from '../config/schema.js';
import { IncidentStore } from './store.js';
import { buildContext } from '../context/builder.js';
import { LLMOrchestrator } from '../llm/orchestrator.js';
import { PatchSandbox } from '../sandbox/runner.js';
import { PolicyEngine } from '../policies/engine.js';
import { scoreConfidence } from '../confidence/score.js';
import { computeBlastRadius } from '../blast-radius/index.js';
import { loadGraph } from '../graph/query.js';
import { buildMrPayload } from '../mr/creator.js';
import { openGithubPr, mergeGithubPr, MrCreateResult } from '../mr/github.js';
import { openGitlabMr, mergeGitlabMr } from '../mr/gitlab.js';
import { decideMrAction } from '../mr/decide.js';
import { recordIncidentMemory } from '../scanner/incident-memory.js';
import { log } from '../util/logger.js';

export interface PipelineOptions {
  inPlace?: boolean;
  dryRun?: boolean;
  /** 'manual' = human CLI; 'auto' = background worker. Passed to the orchestrator
   *  so llm.trigger_mode=manual_only can block automatic model calls. */
  invocation?: 'manual' | 'auto';
}

export type PipelineStatus =
  | 'not_found'
  | 'no_fix'
  | 'blocked'
  | 'mr_opened'
  | 'mr_merged'
  | 'mr_saved';

export interface PipelineResult {
  incidentId: string;
  status: PipelineStatus;
  reason?: string;
  mrUrl?: string;
  confidence?: number;
  riskLevel?: string;
}

/**
 * The full incident → MR pipeline: build context, analyse, plan, patch,
 * sandbox-validate, gate on policy/confidence/blast-radius, then open (or save)
 * an MR honoring auto_create/auto_merge. Shared by the `incidents open-mr` CLI
 * command (invocation='manual') and the background worker (invocation='auto').
 */
export async function processIncidentToMr(
  rootDir: string,
  config: KafuOpsConfig,
  id: string,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const store = new IncidentStore(rootDir);
  const inc = store.load(id);
  if (!inc) return { incidentId: id, status: 'not_found' };

  const built = buildContext(rootDir, config, { incident: inc });
  const orch = new LLMOrchestrator({ rootDir, config, invocation: options.invocation ?? 'manual' });
  const rc = await orch.rootCause(inc, built.bundle);
  store.writeArtifact(inc.id, 'root-cause.json', JSON.stringify(rc, null, 2));
  if (!rc.should_attempt_fix) {
    inc.status = 'analyzed';
    store.save(inc);
    return { incidentId: id, status: 'no_fix', reason: rc.classification };
  }

  const plan = await orch.patchPlan(inc, built.bundle, rc);
  const policy = new PolicyEngine(config);

  const pre = policy.combine(policy.decideFiles(plan.files_to_modify));
  if (pre.outcome === 'deny') {
    inc.status = 'blocked';
    store.save(inc);
    store.writeArtifact(inc.id, 'policy-block.md', `Blocked by policy:\n${pre.reasons.join('\n')}`);
    return { incidentId: id, status: 'blocked', reason: 'policy_deny_pre_apply' };
  }

  const patch = await orch.codePatch(inc, built.bundle, plan);
  store.writeArtifact(inc.id, 'patch.diff', patch.unified_diff || '');
  store.writeArtifact(inc.id, 'patch.json', JSON.stringify(patch, null, 2));

  const sandbox = new PatchSandbox({ rootDir, config, inPlace: !!options.inPlace });
  const sb = await sandbox.runPatch(inc, patch);
  store.writeArtifact(inc.id, 'validation.json', JSON.stringify(sb.validation, null, 2));

  let requiresApproval = false;
  if (sb.filesChanged.length) {
    const post = policy.combine(policy.decideFiles(sb.filesChanged));
    if (post.outcome === 'deny') {
      await sandbox.revertAll(sb.workdir);
      inc.status = 'blocked';
      store.save(inc);
      store.writeArtifact(
        inc.id,
        'policy-block.md',
        `Blocked AFTER patch applied (files outside plan match never_modify):\n${post.reasons.join('\n')}`,
      );
      return { incidentId: id, status: 'blocked', reason: 'policy_deny_post_apply' };
    }
    if (post.outcome === 'require_approval') requiresApproval = true;
  }

  const filesChanged = sb.filesChanged.length ? sb.filesChanged : plan.files_to_modify;
  store.saveChangedFiles(inc.id, filesChanged);
  const confidence = scoreConfidence(
    {
      incident: inc,
      bundle: built.bundle,
      plan,
      validation: sb.validation,
      filesChanged,
      highRiskGlobs: config.policies.require_approval_to_modify,
    },
    config,
  );
  const graph = loadGraph(rootDir);
  const blast = computeBlastRadius({ filesChanged, graph });
  store.writeArtifact(inc.id, 'confidence.json', JSON.stringify(confidence, null, 2));
  store.writeArtifact(inc.id, 'blast-radius.json', JSON.stringify(blast, null, 2));

  if (confidence.decision === 'block') {
    inc.status = 'blocked';
    store.save(inc);
    return { incidentId: id, status: 'blocked', reason: 'low_confidence', confidence: confidence.score };
  }
  if (confidence.decision === 'request_human_approval') requiresApproval = true;
  if (config.policies.blast_radius.block_high_risk_auto_mr && blast.risk_level === 'critical') {
    inc.status = 'blocked';
    store.save(inc);
    return { incidentId: id, status: 'blocked', reason: 'critical_blast_radius', confidence: confidence.score };
  }

  const explanation = await orch.mrExplanation(inc, built.bundle, plan);
  const payload = buildMrPayload(sb.branch, config.repo.default_branch, {
    incident: inc,
    bundle: built.bundle,
    plan,
    validation: sb.validation,
    confidence,
    blast_radius: blast,
    files_changed: filesChanged,
    grounding_manifest_relpath: `.kafuops/incidents/${inc.id}/grounding-manifest.md`,
    mr_explanation: explanation,
  });
  store.writeArtifact(inc.id, 'mr-body.md', payload.body);

  // Living memory: record the attempt regardless of whether the MR opens.
  recordIncidentMemory(rootDir, inc, {
    rootCause: rc.suspected_root_cause,
    filesChanged,
    confidence: confidence.score,
    riskLevel: blast.risk_level,
  });

  const decision = decideMrAction(config, { dryRun: options.dryRun, requiresApproval });

  if (decision.action === 'save_only') {
    inc.status = 'validated';
    store.save(inc);
    log.warn(`MR not opened (${decision.reasons.join('; ')}). Saved mr-body.md.`);
    return {
      incidentId: id,
      status: 'mr_saved',
      reason: decision.reasons.join('; '),
      confidence: confidence.score,
      riskLevel: blast.risk_level,
    };
  }

  let result: MrCreateResult;
  if (config.repo.provider === 'github') {
    result = await openGithubPr({ workdir: sb.workdir, config, payload, dryRun: options.dryRun });
  } else if (config.repo.provider === 'gitlab') {
    result = await openGitlabMr({ workdir: sb.workdir, config, payload, dryRun: options.dryRun });
  } else {
    result = { provider: 'dry-run', branch: payload.branch, dry_run: true };
  }
  store.writeArtifact(inc.id, 'mr-result.json', JSON.stringify(result, null, 2));

  if (result.dry_run) {
    inc.status = 'validated';
    store.save(inc);
    return { incidentId: id, status: 'mr_saved', reason: 'provider dry-run (no token/url)', confidence: confidence.score };
  }

  inc.status = 'mr_opened';
  store.save(inc);
  let status: PipelineStatus = 'mr_opened';
  if (decision.merge && result.number != null) {
    try {
      if (config.repo.provider === 'github') await mergeGithubPr({ config, number: result.number });
      else if (config.repo.provider === 'gitlab') await mergeGitlabMr({ config, iid: result.number });
      inc.status = 'merged';
      store.save(inc);
      status = 'mr_merged';
    } catch (err) {
      log.warn(`auto-merge failed (MR left open for review): ${(err as Error).message}`);
    }
  }
  return { incidentId: id, status, mrUrl: result.url, confidence: confidence.score, riskLevel: blast.risk_level };
}
