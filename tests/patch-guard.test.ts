import { describe, it, expect } from 'vitest';
import { validatePatchPaths } from '../src/sandbox/runner.js';

const clean = ['diff --git a/src/x.ts b/src/x.ts', '--- a/src/x.ts', '+++ b/src/x.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n');

describe('validatePatchPaths', () => {
  it('accepts a normal repo-relative diff', () => {
    const r = validatePatchPaths(clean);
    expect(r.ok).toBe(true);
    expect(r.offending).toEqual([]);
  });

  it('rejects a diff that escapes the repo via ..', () => {
    const evil = ['--- a/../../etc/passwd', '+++ b/../../etc/passwd', '@@ -1 +1 @@', '-x', '+y'].join('\n');
    const r = validatePatchPaths(evil);
    expect(r.ok).toBe(false);
    expect(r.offending.join(' ')).toContain('..');
  });

  it('rejects an absolute target path', () => {
    const evil = ['--- a/etc/x', '+++ b//etc/shadow', '@@ -1 +1 @@', '-x', '+y'].join('\n');
    const r = validatePatchPaths(evil);
    expect(r.ok).toBe(false);
  });

  it('ignores /dev/null (used for new/deleted files)', () => {
    const add = ['--- /dev/null', '+++ b/src/new.ts', '@@ -0,0 +1 @@', '+hello'].join('\n');
    expect(validatePatchPaths(add).ok).toBe(true);
  });
});
