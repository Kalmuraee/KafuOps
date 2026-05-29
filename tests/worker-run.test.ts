import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { IncidentStore } from '../src/incident/store.js';
import { runWorkerOnce } from '../src/incident/worker.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { Incident } from '../src/types/index.js';

const ORIG_OPENAI = process.env.OPENAI_API_KEY;
const ORIG_ANTHROPIC = process.env.ANTHROPIC_API_KEY;

function repoWithSource(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-worker-'));
  ensureDirs(getPaths(dir));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const x = 1;\n');
  return dir;
}

function pendingIncident(id: string): Incident {
  return {
    id,
    service: 'demo',
    environment: 'staging',
    severity: 'high',
    fingerprint: 'fp',
    status: 'created',
    summary: 'TypeError in app',
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    event_count: 1,
    top_frame_file: 'src/app.ts',
    top_frame_line: 1,
    events: [
      {
        id: 'evt_1',
        service: 'demo',
        environment: 'staging',
        type: 'uncaught_exception',
        severity: 'error',
        timestamp: new Date().toISOString(),
        message: 'TypeError: boom',
        stacktrace: 'TypeError: boom\n    at handler (src/app.ts:1:5)',
      },
    ],
  };
}

describe('runWorkerOnce', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (ORIG_OPENAI) process.env.OPENAI_API_KEY = ORIG_OPENAI; else delete process.env.OPENAI_API_KEY;
    if (ORIG_ANTHROPIC) process.env.ANTHROPIC_API_KEY = ORIG_ANTHROPIC; else delete process.env.ANTHROPIC_API_KEY;
  });

  it('processes only pending incidents and advances their status', async () => {
    const dir = repoWithSource();
    const cfg = ConfigSchema.parse({
      project: { name: 'demo' },
      llm: { provider: 'none' },
      repo: { provider: 'none' },
      sandbox: { install_command: '', test_command: '' },
    });
    const store = new IncidentStore(dir);
    store.save(pendingIncident('inc_pending'));
    store.save({ ...pendingIncident('inc_done'), status: 'resolved' });

    const results = await runWorkerOnce({ rootDir: dir, config: cfg, inPlace: true, dryRun: true });

    // Only the pending one is processed.
    expect(results.map((r) => r.incidentId)).toEqual(['inc_pending']);
    // The resolved incident is untouched.
    expect(store.load('inc_done')!.status).toBe('resolved');
    // The pending incident moved off 'created'.
    expect(store.load('inc_pending')!.status).not.toBe('created');
  });
});
