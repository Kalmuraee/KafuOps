import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { Redactor } from '../src/redaction/index.js';

const baseConfig = ConfigSchema.parse({ project: { name: 'test' } });

describe('Redactor', () => {
  it('redacts emails', () => {
    const r = new Redactor(baseConfig);
    const out = r.redactText('Contact me at user@example.com today.');
    expect(out.text).toContain('[REDACTED_EMAIL]');
    expect(out.text).not.toContain('user@example.com');
    expect(out.stats.patterns_matched.email).toBe(1);
  });

  it('redacts Bearer tokens', () => {
    const r = new Redactor(baseConfig);
    const out = r.redactText('Authorization: Bearer abc.def-123');
    expect(out.text).toContain('Bearer [REDACTED_TOKEN]');
  });

  it('redacts JWT-like tokens', () => {
    const r = new Redactor(baseConfig);
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature_value-x';
    const out = r.redactText(`Header: ${jwt}`);
    expect(out.text).toContain('[REDACTED_JWT]');
  });

  it('redacts API key params with replace_with backreferences', () => {
    const r = new Redactor(baseConfig);
    const out = r.redactText('?api_key=AKIAIOSFODNN7EXAMPLE&other=1');
    expect(out.text).toContain('api_key=[REDACTED_SECRET]');
    expect(out.text).toContain('other=1');
  });

  it('redacts AWS access keys', () => {
    const r = new Redactor(baseConfig);
    const out = r.redactText('AKIAIOSFODNN7EXAMPLE is bad');
    expect(out.text).toContain('[REDACTED_AWS_KEY]');
  });

  it('redacts private key blocks', () => {
    const r = new Redactor(baseConfig);
    const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIB...\n-----END RSA PRIVATE KEY-----';
    const out = r.redactText(block);
    expect(out.text).toBe('[REDACTED_PRIVATE_KEY]');
  });

  it('redacts JSON fields by name', () => {
    const r = new Redactor(baseConfig);
    const { value, stats } = r.redactJson({
      user: 'alice',
      password: 'p@ssw0rd',
      nested: { token: 'xyz' },
    });
    expect((value as any).password).toBe('[REDACTED_FIELD]');
    expect((value as any).nested.token).toBe('[REDACTED_FIELD]');
    expect(stats.patterns_matched['json_field_password']).toBe(1);
  });

  it('respects enabled=false', () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' }, redaction: { enabled: false } });
    const r = new Redactor(cfg);
    const out = r.redactText('user@example.com');
    expect(out.text).toBe('user@example.com');
  });
});
