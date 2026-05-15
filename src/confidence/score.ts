import { minimatch } from 'minimatch';
import {
  ConfidenceBreakdown,
  ContextBundle,
  Incident,
  PatchPlan,
  ValidationResult,
} from '../types/index.js';
import { KafuOpsConfig } from '../config/schema.js';

export interface ConfidenceInputs {
  incident: Incident;
  bundle: ContextBundle;
  plan: PatchPlan;
  validation?: ValidationResult;
  filesChanged: string[];
  highRiskGlobs?: string[];
}

const DEFAULT_HIGH_RISK = [
  'src/auth/**',
  'src/security/**',
  'src/payments/**',
  'src/encryption/**',
  'migrations/**',
];

export function scoreConfidence(input: ConfidenceInputs, config: KafuOpsConfig): ConfidenceBreakdown {
  let score = 50;
  const positive: string[] = [];
  const negative: string[] = [];

  // Positive: stack trace maps to a changed file
  const changedSet = new Set(input.filesChanged);
  const topFrame = input.incident.top_frame_file;
  if (topFrame && [...changedSet].some((f) => topFrame.endsWith(f) || f.endsWith(topFrame))) {
    score += 15;
    positive.push('stack_trace_maps_to_changed_file');
  } else if (topFrame) {
    score += 3;
    positive.push('stack_trace_present');
  } else {
    score -= 10;
    negative.push('no_stack_trace');
  }

  // Positive: regression test added
  if (input.plan.test_strategy.toLowerCase().includes('regression') || input.filesChanged.some((f) => /test|spec/.test(f))) {
    score += 10;
    positive.push('regression_test_added_or_planned');
  } else {
    negative.push('no_regression_test');
    score -= 5;
  }

  // Tests outcome
  if (input.validation) {
    if (input.validation.tests_passed) {
      score += 15;
      positive.push('targeted_tests_passed');
    } else if (input.validation.test_commands.length === 0) {
      negative.push('tests_could_not_run');
      score -= 5;
    } else {
      score -= 25;
      negative.push('tests_failed');
    }
    if (!input.validation.install_ok) {
      negative.push('install_failed');
      score -= 5;
    }
  } else {
    negative.push('no_validation_performed');
    score -= 5;
  }

  // Patch size proxy: count of files changed
  if (input.filesChanged.length <= 3) {
    score += 5;
    positive.push('patch_is_small');
  } else if (input.filesChanged.length >= 8) {
    score -= 5;
    negative.push('patch_is_large');
  }

  // Risk based on glob matches
  const risky = [...DEFAULT_HIGH_RISK, ...(input.highRiskGlobs ?? [])];
  const riskyHits = input.filesChanged.filter((f) => risky.some((g) => minimatch(f, g, { dot: true })));
  if (riskyHits.length) {
    score -= 15;
    negative.push(`patch_touches_high_risk_files: ${riskyHits.join(', ')}`);
  }

  // Plan-declared risk
  if (input.plan.risk_level === 'critical') {
    score -= 25;
    negative.push('plan_risk_critical');
  } else if (input.plan.risk_level === 'high') {
    score -= 15;
    negative.push('plan_risk_high');
  } else if (input.plan.risk_level === 'low') {
    score += 5;
    positive.push('plan_risk_low');
  }

  // Bundle privacy / evidence breadth
  if (input.bundle.files.length === 0) {
    score -= 30;
    negative.push('no_repo_files_in_context');
  }
  if (Object.keys(input.bundle.privacy.patterns_matched).length > 5) {
    score -= 3;
    negative.push('heavy_redaction');
  }

  const clamped = Math.max(0, Math.min(100, score));
  const level: ConfidenceBreakdown['level'] =
    clamped >= 90 ? 'very_high' : clamped >= 70 ? 'high' : clamped >= 40 ? 'medium' : 'low';
  const policyOpen = config.policies.confidence.open_mr_if_score_at_least;
  const policyApproval = config.policies.confidence.require_human_approval_if_below;
  let decision: ConfidenceBreakdown['decision'];
  if (clamped < policyOpen) decision = 'block';
  else if (clamped < policyApproval) decision = 'request_human_approval';
  else decision = 'open_mr';

  return { score: clamped, level, positive, negative, decision };
}
