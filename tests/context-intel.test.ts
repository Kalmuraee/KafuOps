import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ConfigSchema } from '../src/config/schema.js';
import { extractFocusSnippet, recentFileHistory, buildContext } from '../src/context/builder.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { Incident } from '../src/types/index.js';

describe('extractFocusSnippet', () => {
  it('returns a numbered window with a marker on the failing line', () => {
    const content = ['line1', 'line2', 'BOOM', 'line4', 'line5'].join('\n');
    const snippet = extractFocusSnippet(content, 3, 1);
    expect(snippet).toContain('BOOM');
    expect(snippet).toMatch(/>\s*3/); // marker + line number on the failing line
    expect(snippet).toContain('line2'); // one line of context before
    expect(snippet).toContain('line4'); // one line of context after
    expect(snippet).not.toContain('line1'); // window=1 excludes farther lines
  });
});

function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-git-'));
  const git = (args: string[]) => spawnSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'pay.ts'), 'export const v = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: initial payment module']);
  fs.writeFileSync(path.join(dir, 'src', 'pay.ts'), 'export const v = 2;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'refactor: change payment retry logic']);
  return dir;
}

describe('recentFileHistory', () => {
  it('returns recent commit subjects for a tracked file', () => {
    const dir = gitRepo();
    const h = recentFileHistory(dir, 'src/pay.ts', 5);
    expect(h.commits.length).toBeGreaterThanOrEqual(2);
    expect(h.commits.join('\n')).toContain('change payment retry logic');
  });

  it('returns empty for a non-git directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-nogit-'));
    expect(recentFileHistory(dir, 'x.ts', 3).commits).toEqual([]);
  });
});

function incident(file: string): Incident {
  return {
    id: 'inc_ctx', service: 'demo', environment: 'staging', severity: 'high', fingerprint: 'fp',
    status: 'created', summary: 'TypeError', first_seen: new Date().toISOString(), last_seen: new Date().toISOString(),
    event_count: 1, top_frame_file: file, top_frame_line: 1,
    events: [{ id: 'e', service: 'demo', environment: 'staging', type: 'uncaught_exception', severity: 'error', timestamp: new Date().toISOString(), message: 'boom', stacktrace: `at h (${file}:1:10)` }],
  };
}

describe('buildContext intelligence', () => {
  it('attaches a focus snippet (failing region) to the top-frame file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-ctxi-'));
    ensureDirs(getPaths(dir));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'x.ts'), 'export function f(c){ return c.a.b; }\n');
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const res = buildContext(dir, cfg, { incident: incident('src/x.ts') });
    const file = res.bundle.files.find((f) => f.path === 'src/x.ts');
    expect(file?.focus?.line).toBe(1);
    expect(file?.focus?.snippet).toContain('c.a.b');
  });

  it('surfaces recent git history of suspect files as a memory snippet', () => {
    const dir = gitRepo();
    ensureDirs(getPaths(dir));
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const res = buildContext(dir, cfg, { incident: incident('src/pay.ts') });
    const mem = res.bundle.memory.find((m) => m.path.includes('recent-changes'));
    expect(mem).toBeTruthy();
    expect(mem!.content).toContain('payment retry');
  });
});
