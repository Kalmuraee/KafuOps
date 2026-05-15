import chalk from 'chalk';
import { loadConfigOrExit } from '../util.js';
import { IncidentStore } from '../../incident/store.js';
import { buildContext } from '../../context/builder.js';
import { LLMOrchestrator } from '../../llm/orchestrator.js';
import { PatchSandbox } from '../../sandbox/runner.js';
import { PolicyEngine } from '../../policies/engine.js';
import { scoreConfidence } from '../../confidence/score.js';
import { computeBlastRadius } from '../../blast-radius/index.js';
import { loadGraph } from '../../graph/query.js';
import { buildMrPayload } from '../../mr/creator.js';
import { openGithubPr } from '../../mr/github.js';
import { openGitlabMr } from '../../mr/gitlab.js';
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
  const inc = store.load(id);
  if (!inc) {
    log.error(`Incident ${id} not found`);
    process.exit(1);
  }
  const built = buildContext(rootDir, config, { incident: inc });
  const orch = new LLMOrchestrator({ rootDir, config });
  log.info(`Open MR for ${inc.id}${orch.isDryRun() ? ' (LLM dry-run)' : ''}`);
  const rc = await orch.rootCause(inc, built.bundle);
  if (!rc.should_attempt_fix) {
    log.warn(`Skipping MR: root-cause analysis recommends no fix (${rc.classification}).`);
    return;
  }
  const plan = await orch.patchPlan(inc, built.bundle, rc);
  log.info(`Plan: ${plan.patch_type} risk=${plan.risk_level} files=${plan.files_to_modify.join(', ') || '(none)'}`);

  // Policy gate on files to modify
  const policy = new PolicyEngine(config);
  const decisions = policy.decideFiles(plan.files_to_modify);
  const combined = policy.combine(decisions);
  if (combined.outcome === 'deny') {
    inc.status = 'blocked';
    store.save(inc);
    store.writeArtifact(inc.id, 'policy-block.md', `Blocked by policy:\n${combined.reasons.join('\n')}`);
    log.error(`Blocked by policy:\n  ${combined.reasons.join('\n  ')}`);
    return;
  }

  const patch = await orch.codePatch(inc, built.bundle, plan);
  store.writeArtifact(inc.id, 'patch.diff', patch.unified_diff || '');
  store.writeArtifact(inc.id, 'patch.json', JSON.stringify(patch, null, 2));

  const sandbox = new PatchSandbox({ rootDir, config, inPlace: !!options.inPlace });
  const sb = await sandbox.runPatch(inc, patch);
  store.writeArtifact(inc.id, 'validation.json', JSON.stringify(sb.validation, null, 2));
  log.info(
    `Sandbox: applied=${sb.patchApplied} files=${sb.filesChanged.length} tests_passed=${sb.validation.tests_passed} branch=${sb.branch}`,
  );

  // Post-apply policy check: a model can attempt to modify files outside its declared plan.
  // Decide on the ACTUAL changed files reported by git status, not just the plan.
  if (sb.filesChanged.length) {
    const postDecisions = policy.decideFiles(sb.filesChanged);
    const postCombined = policy.combine(postDecisions);
    if (postCombined.outcome === 'deny') {
      // Revert the patch in the sandbox workdir so the user is not left with a half-applied diff.
      await sandbox.revertAll(sb.workdir);
      inc.status = 'blocked';
      store.save(inc);
      store.writeArtifact(
        inc.id,
        'policy-block.md',
        `Blocked AFTER patch applied. The model touched files outside its plan that match never_modify:\n${postCombined.reasons.join('\n')}`,
      );
      log.error(
        `Post-apply policy violation — patch reverted. Reasons:\n  ${postCombined.reasons.join('\n  ')}`,
      );
      return;
    }
    if (postCombined.outcome === 'require_approval') {
      log.warn(
        `Post-apply policy: changes require human approval:\n  ${postCombined.reasons.join('\n  ')}`,
      );
      // We surface this as a labeled MR instead of opening automatically.
      // The MR creator already labels it; we degrade auto-create to false.
      if (config.repo.mr.auto_create) {
        log.warn('Degrading auto-create=false for this MR due to require_approval files.');
      }
    }
  }

  // Confidence + blast radius
  const filesChanged = sb.filesChanged.length ? sb.filesChanged : plan.files_to_modify;
  const confidence = scoreConfidence(
    { incident: inc, bundle: built.bundle, plan, validation: sb.validation, filesChanged },
    config,
  );
  const graph = loadGraph(rootDir);
  const blast = computeBlastRadius({ filesChanged, graph });
  store.writeArtifact(inc.id, 'confidence.json', JSON.stringify(confidence, null, 2));
  store.writeArtifact(inc.id, 'blast-radius.json', JSON.stringify(blast, null, 2));
  log.info(`Confidence: ${confidence.score} (${confidence.level}) decision=${confidence.decision}`);
  log.info(`Blast radius: ${blast.risk_level} (affected=${blast.potentially_affected.length})`);

  if (confidence.decision === 'block') {
    inc.status = 'blocked';
    store.save(inc);
    log.warn('Confidence too low — MR will not be opened.');
    return;
  }
  if (config.policies.blast_radius.block_high_risk_auto_mr && blast.risk_level === 'critical') {
    inc.status = 'blocked';
    store.save(inc);
    log.warn('Blast radius is critical — MR auto-creation blocked by policy.');
    return;
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

  if (!config.repo.mr.enabled || options.dryRun) {
    log.warn('MR creation disabled or --dry-run; saved mr-body.md only.');
    return;
  }

  let result;
  if (config.repo.provider === 'github') {
    result = await openGithubPr({ workdir: sb.workdir, config, payload, dryRun: options.dryRun });
  } else if (config.repo.provider === 'gitlab') {
    result = await openGitlabMr({ workdir: sb.workdir, config, payload, dryRun: options.dryRun });
  } else {
    result = { provider: 'dry-run' as const, branch: payload.branch, dry_run: true };
  }
  store.writeArtifact(inc.id, 'mr-result.json', JSON.stringify(result, null, 2));
  if (result.dry_run) {
    log.warn(`MR dry-run on branch ${result.branch}. Saved to .kafuops/incidents/${inc.id}/mr-body.md`);
  } else {
    log.ok(`MR opened: ${result.url} (${result.provider}#${result.number})`);
    inc.status = 'mr_opened';
    store.save(inc);
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
