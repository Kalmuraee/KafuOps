import { describe, it, expect } from 'vitest';
import { box, visibleLen, spinner } from '../src/util/ui.js';

describe('visibleLen', () => {
  it('ignores ANSI color codes when measuring width', () => {
    const esc = String.fromCharCode(27);
    expect(visibleLen(`${esc}[32mok${esc}[39m`)).toBe(2);
  });
});

describe('box', () => {
  it('draws a titled box containing every line', () => {
    const out = box('Discovered', ['Stack: node', 'Mode: wrapper']);
    expect(out).toContain('Discovered');
    expect(out).toContain('Stack: node');
    expect(out).toContain('Mode: wrapper');
    expect(out).toContain('╭');
    expect(out).toContain('╰');
    // every rendered row is the same visible width (aligned)
    const rows = out.split('\n').map(visibleLen);
    expect(new Set(rows).size).toBe(1);
  });
});

describe('spinner', () => {
  it('returns a safe no-op interface in non-TTY/CI (no throw)', () => {
    const s = spinner('working…');
    expect(() => {
      s.update('still working…');
      s.succeed('done');
      s.fail('nope');
      s.stop();
    }).not.toThrow();
  });
});
