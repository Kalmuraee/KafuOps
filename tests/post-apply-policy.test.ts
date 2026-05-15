import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { PolicyEngine } from '../src/policies/engine.js';

/**
 * The post-apply policy fix lives in the `incidents open-mr` command and is
 * driven by PolicyEngine.combine() — verify the building blocks behave the way
 * the command code relies on, since we cannot easily integration-test the full
 * sandbox+git flow inside vitest.
 */
describe('Post-apply policy', () => {
  const cfg = ConfigSchema.parse({ project: { name: 't' } });
  const policy = new PolicyEngine(cfg);

  it('flags model that touched .env even if plan only listed safe files', () => {
    const planFiles = ['src/payment/retry.ts'];
    const actualFiles = ['src/payment/retry.ts', '.env'];

    // Plan looked safe...
    expect(policy.combine(policy.decideFiles(planFiles)).outcome).toBe('allow');
    // ...but the actual diff includes .env, which must be blocked.
    expect(policy.combine(policy.decideFiles(actualFiles)).outcome).toBe('deny');
  });

  it('downgrades to require_approval when only auth files were silently touched', () => {
    const planFiles = ['src/util/log.ts'];
    const actualFiles = ['src/util/log.ts', 'src/auth/session.ts'];
    expect(policy.combine(policy.decideFiles(planFiles)).outcome).toBe('allow');
    expect(policy.combine(policy.decideFiles(actualFiles)).outcome).toBe('require_approval');
  });
});
