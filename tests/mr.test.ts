import { describe, it, expect } from 'vitest';
import { parseGithubUrl } from '../src/mr/github.js';
import { parseGitlabUrl } from '../src/mr/gitlab.js';
import { buildMrPayload } from '../src/mr/creator.js';
import { BlastRadius, ConfidenceBreakdown, ContextBundle, Incident, PatchPlan } from '../src/types/index.js';

describe('parseGithubUrl', () => {
  it('parses https and .git URLs', () => {
    expect(parseGithubUrl('https://github.com/acme/widgets.git')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGithubUrl('https://github.com/acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets' });
  });
  it('parses ssh URLs', () => {
    expect(parseGithubUrl('git@github.com:acme/widgets.git')).toEqual({ owner: 'acme', repo: 'widgets' });
  });
  it('returns null for non-github URLs', () => {
    expect(parseGithubUrl('https://example.com/x/y')).toBeNull();
  });
});

describe('parseGitlabUrl', () => {
  it('parses https with subgroups', () => {
    expect(parseGitlabUrl('https://gitlab.com/org/sub/repo.git')).toEqual({
      host: 'gitlab.com',
      projectPath: 'org/sub/repo',
    });
  });
  it('parses ssh and self-hosted hosts', () => {
    expect(parseGitlabUrl('git@gitlab.example.com:team/app.git')).toEqual({
      host: 'gitlab.example.com',
      projectPath: 'team/app',
    });
  });
});

function fixtures() {
  const incident: Incident = {
    id: 'inc_42', service: 'api', environment: 'production', severity: 'high', fingerprint: 'fp',
    status: 'validated', summary: 'TypeError on /checkout', first_seen: 'T0', last_seen: 'T1',
    event_count: 3, route: 'POST /checkout', events: [],
  };
  const bundle: ContextBundle = {
    incident_id: 'inc_42', evidence_packet: { incident_id: 'inc_42', logs: [] },
    files: [{ path: 'src/payment/retry.ts', reason: 'top frame', evidence_strength: 'high', content: 'x', original_bytes: 10 }],
    memory: [],
    privacy: { redaction_applied: true, full_logs_sent: false, full_repo_sent: false, patterns_matched: {}, files_excluded: [] },
  };
  const plan: PatchPlan = { patch_type: 'bug_fix', files_to_modify: ['src/payment/retry.ts'], test_strategy: 'add regression test', risk_level: 'low', reason: 'null deref guard' };
  const confidence: ConfidenceBreakdown = { score: 82, level: 'high', positive: ['targeted_tests_passed'], negative: [], decision: 'open_mr' };
  const blast: BlastRadius = { changed_files: ['src/payment/retry.ts'], potentially_affected: ['route: POST /checkout'], not_directly_affected: [], external_dependencies: ['stripe'], data_impact: 'No schema change detected.', risk_level: 'low' };
  return { incident, bundle, plan, confidence, blast };
}

describe('buildMrPayload', () => {
  it('builds title, labels and an evidence-rich body', () => {
    const { incident, bundle, plan, confidence, blast } = fixtures();
    const payload = buildMrPayload('kafuops/fix/inc_42-typeerror', 'main', {
      incident, bundle, plan, confidence, blast_radius: blast,
      files_changed: ['src/payment/retry.ts'],
      grounding_manifest_relpath: '.kafuops/incidents/inc_42/grounding-manifest.md',
      mr_explanation: 'Guards against undefined paymentMethod.',
    });
    expect(payload.title).toBe('[KafuOps] TypeError on /checkout');
    expect(payload.branch).toBe('kafuops/fix/inc_42-typeerror');
    expect(payload.base).toBe('main');
    expect(payload.labels).toContain('confidence-high');
    expect(payload.labels).toContain('risk-low');
    // Body covers the documented sections.
    expect(payload.body).toContain('## Root cause');
    expect(payload.body).toContain('null deref guard');
    expect(payload.body).toContain('## Confidence');
    expect(payload.body).toContain('82 / 100');
    expect(payload.body).toContain('## Blast radius');
    expect(payload.body).toContain('## Rollback');
    expect(payload.body).toContain('Guards against undefined paymentMethod.');
  });
});
