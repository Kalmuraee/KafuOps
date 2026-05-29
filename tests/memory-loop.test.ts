import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { recordIncidentMemory, recordReviewFeedback } from '../src/scanner/incident-memory.js';
import { buildContext } from '../src/context/builder.js';
import { Incident } from '../src/types/index.js';

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-mem-'));
  ensureDirs(getPaths(dir));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
  return dir;
}

function inc(id: string): Incident {
  return {
    id, service: 'demo', environment: 'prod', severity: 'high', fingerprint: 'demo|-|TypeError|x',
    status: 'created', summary: 'TypeError in checkout', first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(), event_count: 1, events: [],
  };
}

describe('incident memory', () => {
  it('appends a per-incident record to incidents.md', () => {
    const dir = repo();
    const file = recordIncidentMemory(dir, inc('inc_a'), {
      rootCause: 'null deref on customer.defaultPaymentMethod',
      filesChanged: ['src/payment/retry.ts'],
      confidence: 72,
      riskLevel: 'low',
    });
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('inc_a');
    expect(text).toContain('null deref on customer.defaultPaymentMethod');
    expect(text).toContain('src/payment/retry.ts');
  });

  it('appends multiple records rather than overwriting', () => {
    const dir = repo();
    recordIncidentMemory(dir, inc('inc_a'), { rootCause: 'a', filesChanged: [], confidence: 1, riskLevel: 'low' });
    const file = recordIncidentMemory(dir, inc('inc_b'), { rootCause: 'b', filesChanged: [], confidence: 1, riskLevel: 'low' });
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('inc_a');
    expect(text).toContain('inc_b');
  });

  it('records human review feedback', () => {
    const dir = repo();
    const file = recordReviewFeedback(dir, inc('inc_c'), 'rejected', 'fix masked the real bug');
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('inc_c');
    expect(text).toContain('REJECTED');
    expect(text).toContain('fix masked the real bug');
  });
});

describe('context builder surfaces the learning loop', () => {
  it('includes review-feedback.md as a memory snippet when present', () => {
    const dir = repo();
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    recordReviewFeedback(dir, inc('inc_prev'), 'merged');
    const res = buildContext(dir, cfg, { incident: inc('inc_now') });
    const memPaths = res.bundle.memory.map((m) => m.path);
    expect(memPaths.some((p) => p.includes('review-feedback.md'))).toBe(true);
  });
});
