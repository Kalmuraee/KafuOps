import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { PolicyEngine } from '../src/policies/engine.js';

describe('PolicyEngine', () => {
  const cfg = ConfigSchema.parse({ project: { name: 't' } });
  const policy = new PolicyEngine(cfg);

  it('denies .env modifications', () => {
    expect(policy.decideFile('.env').decision).toBe('deny');
    expect(policy.decideFile('.env.production').decision).toBe('deny');
    expect(policy.decideFile('secrets/api-key.json').decision).toBe('deny');
  });

  it('requires approval for auth/payment files', () => {
    expect(policy.decideFile('src/auth/session.ts').decision).toBe('require_approval');
    expect(policy.decideFile('src/payments/stripe.ts').decision).toBe('require_approval');
    expect(policy.decideFile('migrations/2026_01_foo.sql').decision).toBe('require_approval');
  });

  it('allows ordinary src files', () => {
    expect(policy.decideFile('src/util/log.ts').decision).toBe('allow');
  });

  it('combine picks the worst outcome', () => {
    const out = policy.combine([
      { file: 'a.ts', decision: 'allow' },
      { file: 'src/auth/x.ts', decision: 'require_approval', reason: 'r1' },
      { file: '.env', decision: 'deny', reason: 'r2' },
    ]);
    expect(out.outcome).toBe('deny');
  });

  it('maps confidence score to MR decisions', () => {
    expect(policy.decideMrFromConfidence(95).decision).toBe('open_mr');
    expect(policy.decideMrFromConfidence(75).decision).toBe('request_human_approval');
    expect(policy.decideMrFromConfidence(50).decision).toBe('block');
  });
});
