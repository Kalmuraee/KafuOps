import { describe, it, expect } from 'vitest';
import { validatePatchPaths, changedFilesFromDiff } from '../src/sandbox/runner.js';

describe('changedFilesFromDiff', () => {
  it('extracts target paths from a unified diff', () => {
    const diff = ['diff --git a/src/x.ts b/src/x.ts', '--- a/src/x.ts', '+++ b/src/x.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n');
    expect(changedFilesFromDiff(diff)).toEqual(['src/x.ts']);
  });
  it('handles new files (--- /dev/null) and dedups', () => {
    const diff = ['--- /dev/null', '+++ b/src/new.ts', '@@ -0,0 +1 @@', '+x', '--- a/src/new.ts', '+++ b/src/new.ts'].join('\n');
    expect(changedFilesFromDiff(diff)).toEqual(['src/new.ts']);
  });
});

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
