import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { Redactor } from '../src/redaction/index.js';

describe('Redactor ReDoS guard', () => {
  it('rejects a catastrophic-backtracking pattern from config', () => {
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      redaction: {
        patterns: [
          // Classic ReDoS: (a+)+$ takes exponential time on inputs that almost match.
          { name: 'evil', regex: '(a+)+$', replace_with: 'X' },
        ],
      },
    });
    const r = new Redactor(cfg, { patternProbeBudgetMs: 20 });
    const rejected = r.getRejectedPatterns();
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0].name).toBe('evil');
    expect(rejected[0].reason).toMatch(/budget|ReDoS|probe|backtracking|nested quantifier/i);
  });

  it('accepts a benign user pattern', () => {
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      redaction: {
        patterns: [{ name: 'phone', regex: '\\d{3}-\\d{4}', replace_with: '[REDACTED_PHONE]' }],
      },
    });
    const r = new Redactor(cfg);
    expect(r.getRejectedPatterns()).toEqual([]);
    const out = r.redactText('call me at 555-1234');
    expect(out.text).toContain('[REDACTED_PHONE]');
  });

  it('rejects a syntactically invalid pattern without throwing', () => {
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      redaction: { patterns: [{ name: 'bad', regex: '(unclosed', replace_with: 'X' }] },
    });
    const r = new Redactor(cfg);
    expect(r.getRejectedPatterns()[0].name).toBe('bad');
    expect(r.getRejectedPatterns()[0].reason).toMatch(/invalid regex/);
  });
});
