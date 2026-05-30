import {
  BlastRadius,
  ConfidenceBreakdown,
  ContextBundle,
  Incident,
  PatchPlan,
  ValidationResult,
} from '../types/index.js';

export interface MrBodyInputs {
  incident: Incident;
  bundle: ContextBundle;
  plan: PatchPlan;
  validation?: ValidationResult;
  confidence: ConfidenceBreakdown;
  blast_radius: BlastRadius;
  files_changed: string[];
  grounding_manifest_relpath: string;
  mr_explanation?: string;
}

export interface MrPayload {
  title: string;
  body: string;
  branch: string;
  base: string;
  labels: string[];
}

export function buildMrPayload(branch: string, base: string, inputs: MrBodyInputs): MrPayload {
  const title = `[KafuOps] ${truncate(inputs.incident.summary, 100)}`;
  const labels = [
    'kafuops',
    'auto-generated',
    'incident-fix',
    'needs-review',
    `confidence-${inputs.confidence.level.replace('_', '-')}`,
    `risk-${inputs.blast_radius.risk_level}`,
    ...(inputs.incident.recurrence_of ? ['recurrence'] : []),
  ];
  return { title, body: renderBody(inputs), branch, base, labels };
}

function renderBody(input: MrBodyInputs): string {
  const lines: string[] = [];
  lines.push(`# KafuOps Incident Fix`, '');
  lines.push(`## Incident`, '');
  lines.push(`- Incident ID: ${input.incident.id}`);
  lines.push(`- Service: ${input.incident.service}`);
  lines.push(`- Environment: ${input.incident.environment}`);
  if (input.incident.route) lines.push(`- Route/job: ${input.incident.route}`);
  lines.push(`- First seen: ${input.incident.first_seen}`);
  lines.push(`- Last seen: ${input.incident.last_seen}`);
  lines.push(`- Event count: ${input.incident.event_count}`);
  lines.push(`- Severity: ${input.incident.severity}`);
  if (input.incident.fingerprint) lines.push(`- Fingerprint: \`${input.incident.fingerprint}\``);
  if (input.incident.recurrence_of) {
    lines.push(
      `- ⚠ **Recurrence** of \`${input.incident.recurrence_of}\` — a previously merged/resolved fix for this failure regressed or was incomplete. Review carefully.`,
    );
  }
  lines.push('', `## Root cause`, '');
  lines.push(input.plan.reason);
  lines.push('', `## Evidence`, '');
  for (const f of input.bundle.files.slice(0, 5)) lines.push(`- \`${f.path}\` — ${f.reason}`);
  lines.push('', `## Files inspected`, '');
  for (const f of input.bundle.files) lines.push(`- \`${f.path}\``);
  lines.push('', `## Files changed`, '');
  for (const f of input.files_changed) lines.push(`- \`${f}\``);
  lines.push('', `## Validation`, '');
  if (input.validation) {
    lines.push(`- Install command: \`${input.validation.install_command}\` (${input.validation.install_ok ? 'ok' : 'failed'})`);
    for (const t of input.validation.test_commands) lines.push(`- Test command: \`${t}\``);
    lines.push(`- Tests passed: ${input.validation.tests_passed ? 'yes' : 'no'}`);
    if (input.validation.notes) lines.push(`- Notes: ${input.validation.notes}`);
  } else {
    lines.push('- No validation was performed (see notes in MR body).');
  }
  lines.push('', `## Confidence`, '');
  lines.push(`Score: ${input.confidence.score} / 100 (${input.confidence.level})`);
  if (input.confidence.positive.length) {
    lines.push('', 'Positive signals:');
    for (const p of input.confidence.positive) lines.push(`- ${p}`);
  }
  if (input.confidence.negative.length) {
    lines.push('', 'Negative signals:');
    for (const p of input.confidence.negative) lines.push(`- ${p}`);
  }
  lines.push('', `## Blast radius`, '');
  lines.push(`- Risk level: **${input.blast_radius.risk_level}**`);
  if (input.blast_radius.potentially_affected.length) {
    lines.push(`- Potentially affected:`);
    for (const x of input.blast_radius.potentially_affected.slice(0, 30))
      lines.push(`  - ${x}`);
  }
  if (input.blast_radius.external_dependencies.length) {
    lines.push(`- External dependencies: ${input.blast_radius.external_dependencies.join(', ')}`);
  }
  lines.push(`- Data impact: ${input.blast_radius.data_impact}`);
  lines.push('', `## Grounding manifest`, '');
  lines.push(`See \`${input.grounding_manifest_relpath}\`.`);
  lines.push('', `## Privacy`, '');
  lines.push(`- Redaction applied: ${input.bundle.privacy.redaction_applied}`);
  lines.push(`- Full logs sent to model: ${input.bundle.privacy.full_logs_sent}`);
  lines.push(`- Full repo sent to model: ${input.bundle.privacy.full_repo_sent}`);
  if (input.mr_explanation) {
    lines.push('', `## Notes`, '');
    lines.push(input.mr_explanation);
  }
  lines.push('', `## Rollback`, '');
  lines.push('Revert this MR. The change is scoped to the files listed above.');
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
