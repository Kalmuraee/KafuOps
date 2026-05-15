import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { buildContext } from '../src/context/builder.js';
import { runScan } from '../src/scanner/memory.js';
import { buildGraph, writeGraph } from '../src/graph/builder.js';
import { Incident } from '../src/types/index.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-ctx-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { express: '*' } }));
  fs.mkdirSync(path.join(dir, 'src', 'payment'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.env-fake'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'payment', 'retry.ts'),
    'export function retry(c: any) { return c.defaultPaymentMethod.type; }\n',
  );
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=abcdef\n');
  return dir;
}

describe('Context builder', () => {
  it('selects the top stack frame file and excludes .env', () => {
    const dir = makeRepo();
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    ensureDirs(getPaths(dir));
    runScan(dir, cfg, { write: true });
    writeGraph(dir, buildGraph(dir));

    const incident: Incident = {
      id: 'inc_test',
      service: 'demo',
      environment: 'staging',
      severity: 'high',
      fingerprint: 'fp',
      status: 'created',
      summary: 'TypeError on retry',
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      event_count: 1,
      top_frame_file: 'src/payment/retry.ts',
      top_frame_line: 1,
      events: [
        {
          id: 'evt_1',
          service: 'demo',
          environment: 'staging',
          type: 'uncaught_exception',
          severity: 'error',
          timestamp: new Date().toISOString(),
          message: 'TypeError: Cannot read properties of undefined',
          stacktrace: 'TypeError: ...\n    at retry (src/payment/retry.ts:1:35)',
        },
      ],
    };

    const result = buildContext(dir, cfg, { incident });
    const paths = result.bundle.files.map((f) => f.path);
    expect(paths).toContain('src/payment/retry.ts');
    expect(paths).not.toContain('.env');
    expect(result.bundle.privacy.redaction_applied).toBe(true);
    expect(result.bundle.privacy.full_logs_sent).toBe(false);
    expect(fs.existsSync(result.bundle_path)).toBe(true);
    expect(fs.existsSync(result.manifest_path)).toBe(true);
  });
});
