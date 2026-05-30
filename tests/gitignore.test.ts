import { describe, it, expect } from 'vitest';
import { ensureGitignoreLines } from '../src/util/gitignore.js';

const LINES = ['.kafuops/.env', '.kafuops/incidents/'];

describe('ensureGitignoreLines', () => {
  it('adds a KafuOps block to empty content', () => {
    const out = ensureGitignoreLines('', LINES);
    expect(out).toContain('# KafuOps');
    expect(out).toContain('.kafuops/.env');
    expect(out).toContain('.kafuops/incidents/');
  });

  it('only appends the lines that are missing', () => {
    const out = ensureGitignoreLines('node_modules\n.kafuops/.env\n', LINES);
    // .env already present → not duplicated; incidents/ added
    expect(out.match(/\.kafuops\/\.env/g)?.length).toBe(1);
    expect(out).toContain('.kafuops/incidents/');
    expect(out).toContain('node_modules');
  });

  it('returns content unchanged when everything is present', () => {
    const content = 'node_modules\n.kafuops/.env\n.kafuops/incidents/\n';
    expect(ensureGitignoreLines(content, LINES)).toBe(content);
  });
});
