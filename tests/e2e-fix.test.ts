import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ConfigSchema } from '../src/config/schema.js';
import { LLMOrchestrator } from '../src/llm/orchestrator.js';
import { IncidentStore } from '../src/incident/store.js';
import { processIncidentToMr } from '../src/incident/pipeline.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { Incident } from '../src/types/index.js';

const ORIG_OPENAI = process.env.OPENAI_API_KEY;

const BUGGY = 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n';
const CHECK = "const { add } = require('./src/math.js');\nif (add(2, 3) !== 5) { console.error('FAIL', add(2, 3)); process.exit(1); }\nconsole.log('OK');\n";
const FIX_DIFF = [
  '--- a/src/math.js',
  '+++ b/src/math.js',
  '@@ -1,4 +1,4 @@',
  ' function add(a, b) {',
  '-  return a - b;',
  '+  return a + b;',
  ' }',
  ' module.exports = { add };',
  '',
].join('\n');

function buggyRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-e2e-'));
  ensureDirs(getPaths(dir));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mathy' }));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'math.js'), BUGGY);
  fs.writeFileSync(path.join(dir, 'check.js'), CHECK);
  return dir;
}

// A fake OpenAI client that returns a valid response for each pipeline stage,
// keyed off the task wording in the user prompt.
function fixingClient() {
  return {
    chat: {
      completions: {
        create: async (args: any) => {
          const user: string = args.messages.map((m: any) => m.content).join('\n');
          let payload: unknown;
          if (user.includes('classify the issue')) {
            payload = { classification: 'code_bug', suspected_root_cause: 'add() subtracts instead of adds', evidence: ['check.js fails'], files_to_read_next: ['src/math.js'], should_attempt_fix: true, confidence: 0.9 };
          } else if (user.includes('plan the smallest viable patch')) {
            payload = { patch_type: 'bug_fix', files_to_modify: ['src/math.js'], test_strategy: 'run check.js', risk_level: 'low', reason: 'use + instead of -' };
          } else if (user.includes('Produce a unified diff')) {
            payload = { unified_diff: FIX_DIFF, summary: 'fix add()', new_test_files: [] };
          } else {
            payload = { text: 'Fixes add() to use addition.' };
          }
          return { choices: [{ message: { content: JSON.stringify(payload) } }] };
        },
      },
    },
  } as any;
}

function incident(): Incident {
  return {
    id: 'inc_e2e', service: 'mathy', environment: 'staging', severity: 'high',
    fingerprint: 'fp', status: 'created', summary: 'add() returns wrong result',
    first_seen: new Date().toISOString(), last_seen: new Date().toISOString(),
    event_count: 1, top_frame_file: 'src/math.js', top_frame_line: 2,
    events: [{ id: 'e1', service: 'mathy', environment: 'staging', type: 'uncaught_exception', severity: 'error', timestamp: new Date().toISOString(), message: 'AssertionError: add(2,3) !== 5', stacktrace: 'at add (src/math.js:2:3)' }],
  };
}

describe('end-to-end fix (mocked provider)', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => { if (ORIG_OPENAI) process.env.OPENAI_API_KEY = ORIG_OPENAI; else delete process.env.OPENAI_API_KEY; });

  it('the buggy fixture fails its check before any patch (red)', () => {
    const dir = buggyRepo();
    const res = spawnSync('node', ['check.js'], { cwd: dir });
    expect(res.status).not.toBe(0);
  });

  it('a generated diff is applied and makes the failing test pass (green)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const dir = buggyRepo();
    const cfg = ConfigSchema.parse({
      project: { name: 'mathy' },
      repo: { provider: 'none' },
      llm: { provider: 'openai' },
      sandbox: { install_command: '', test_command: 'node check.js' },
    });
    const store = new IncidentStore(dir);
    store.save(incident());

    const orchestrator = new LLMOrchestrator({ rootDir: dir, config: cfg, client: fixingClient() });
    const result = await processIncidentToMr(dir, cfg, 'inc_e2e', { orchestrator });

    // The fix was applied, validated, and the previously-failing test now passes.
    expect(result.status).toBe('mr_saved'); // provider=none → dry-run save
    const validation = JSON.parse(fs.readFileSync(path.join(getPaths(dir).incidents, 'inc_e2e', 'validation.json'), 'utf8'));
    expect(validation.tests_passed).toBe(true);
    const changed = JSON.parse(fs.readFileSync(path.join(getPaths(dir).incidents, 'inc_e2e', 'changed-files.json'), 'utf8'));
    expect(changed).toContain('src/math.js');
  });
});
