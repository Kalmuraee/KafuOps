import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { scoreConfidence } from '../src/confidence/score.js';
import { computeBlastRadius } from '../src/blast-radius/index.js';
import { ContextBundle, Incident, PatchPlan, ValidationResult } from '../src/types/index.js';

const cfg = ConfigSchema.parse({ project: { name: 't' } });

function inc(): Incident {
  return {
    id: 'inc_1',
    service: 'api',
    environment: 'staging',
    severity: 'high',
    fingerprint: 'fp',
    status: 'created',
    summary: 'TypeError on checkout',
    first_seen: '2026-05-15T10:00:00Z',
    last_seen: '2026-05-15T10:05:00Z',
    event_count: 5,
    top_frame_file: 'src/payment/retry.ts',
    events: [],
  };
}

function bundle(): ContextBundle {
  return {
    incident_id: 'inc_1',
    evidence_packet: { incident_id: 'inc_1', logs: [] },
    files: [
      { path: 'src/payment/retry.ts', reason: 'top stack frame', evidence_strength: 'high', content: 'x', original_bytes: 100 },
      { path: 'tests/payment/retry.test.ts', reason: 'test', evidence_strength: 'high', content: 'x', original_bytes: 100 },
    ],
    memory: [],
    privacy: { redaction_applied: true, full_logs_sent: false, full_repo_sent: false, patterns_matched: {}, files_excluded: [] },
  };
}

const plan: PatchPlan = {
  patch_type: 'bug_fix',
  files_to_modify: ['src/payment/retry.ts', 'tests/payment/retry.test.ts'],
  test_strategy: 'Add regression test for missing default payment method',
  risk_level: 'low',
  reason: 'null check missing',
};

const validation: ValidationResult = {
  install_command: 'npm ci',
  install_ok: true,
  install_output_tail: '',
  test_commands: ['npm test'],
  tests_passed: true,
  tests_output_tail: '',
  ran_in_sandbox: true,
};

describe('confidence + blast radius', () => {
  it('rewards small patch + passing tests', () => {
    const c = scoreConfidence(
      { incident: inc(), bundle: bundle(), plan, validation, filesChanged: ['src/payment/retry.ts', 'tests/payment/retry.test.ts'] },
      cfg,
    );
    expect(c.score).toBeGreaterThanOrEqual(80);
    expect(c.decision === 'open_mr' || c.decision === 'request_human_approval').toBe(true);
  });

  it('penalizes high-risk paths', () => {
    const c = scoreConfidence(
      {
        incident: inc(),
        bundle: bundle(),
        plan: { ...plan, files_to_modify: ['src/auth/session.ts'] },
        validation,
        filesChanged: ['src/auth/session.ts'],
      },
      cfg,
    );
    expect(c.negative.some((n) => n.includes('high_risk'))).toBe(true);
  });

  it('blast radius marks migrations as high risk', () => {
    const blast = computeBlastRadius({ filesChanged: ['migrations/2026_01_users.sql'] });
    expect(blast.risk_level).toBe('high');
    expect(blast.data_impact.toLowerCase()).toContain('migration');
  });
});
