import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { LLMOrchestrator } from '../src/llm/orchestrator.js';
import { IncidentStore } from '../src/incident/store.js';
import { processIncidentToMr } from '../src/incident/pipeline.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { Incident } from '../src/types/index.js';

const ORIG_OPENAI = process.env.OPENAI_API_KEY;

const BUGGY = 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n';
const CHECK = "const { add } = require('./src/math.js');\nif (add(2, 3) !== 5) { console.error('FAIL', add(2, 3)); process.exit(1); }\nconsole.log('OK');\n";
const diff = (op: string) =>
  ['--- a/src/math.js', '+++ b/src/math.js', '@@ -1,4 +1,4 @@', ' function add(a, b) {', '-  return a - b;', `+  return a ${op} b;`, ' }', ' module.exports = { add };', ''].join('\n');

function buggyRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-loop-'));
  ensureDirs(getPaths(dir));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mathy' }));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'math.js'), BUGGY);
  fs.writeFileSync(path.join(dir, 'check.js'), CHECK);
  return dir;
}

// First code-patch is WRONG (a * b → tests fail); the revision is CORRECT (a + b).
function selfCorrectingClient() {
  return {
    chat: {
      completions: {
        create: async (args: any) => {
          const user: string = args.messages.map((m: any) => m.content).join('\n');
          let payload: unknown;
          if (user.includes('previous patch did NOT')) {
            payload = { unified_diff: diff('+'), summary: 'corrected', new_test_files: [] };
          } else if (user.includes('classify the issue')) {
            payload = { classification: 'code_bug', suspected_root_cause: 'wrong operator', evidence: [], files_to_read_next: [], should_attempt_fix: true, confidence: 0.9 };
          } else if (user.includes('plan the smallest viable patch')) {
            payload = { patch_type: 'bug_fix', files_to_modify: ['src/math.js'], test_strategy: 'run check', risk_level: 'low', reason: 'operator fix' };
          } else if (user.includes('Produce a unified diff')) {
            payload = { unified_diff: diff('*'), summary: 'first attempt', new_test_files: [] }; // wrong on purpose
          } else {
            payload = { text: 'Fixes add().' };
          }
          return { choices: [{ message: { content: JSON.stringify(payload) } }] };
        },
      },
    },
  } as any;
}

function incident(): Incident {
  return {
    id: 'inc_loop', service: 'mathy', environment: 'staging', severity: 'high', fingerprint: 'fp', status: 'created',
    summary: 'add() wrong', first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), event_count: 1,
    top_frame_file: 'src/math.js', top_frame_line: 2,
    events: [{ id: 'e', service: 'mathy', environment: 'staging', type: 'uncaught_exception', severity: 'error', timestamp: new Date().toISOString(), message: 'bad', stacktrace: 'at add (src/math.js:2:3)' }],
  };
}

describe('agentic self-correcting fix loop', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => { if (ORIG_OPENAI) process.env.OPENAI_API_KEY = ORIG_OPENAI; else delete process.env.OPENAI_API_KEY; });

  it('retries a failing patch using the test output until it passes', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const dir = buggyRepo();
    const cfg = ConfigSchema.parse({
      project: { name: 'mathy' }, repo: { provider: 'none' }, llm: { provider: 'openai', max_fix_attempts: 3 },
      sandbox: { install_command: '', test_command: 'node check.js' },
    });
    const store = new IncidentStore(dir);
    store.save(incident());
    const orchestrator = new LLMOrchestrator({ rootDir: dir, config: cfg, client: selfCorrectingClient() });
    const result = await processIncidentToMr(dir, cfg, 'inc_loop', { orchestrator });

    const validation = JSON.parse(fs.readFileSync(path.join(getPaths(dir).incidents, 'inc_loop', 'validation.json'), 'utf8'));
    expect(validation.tests_passed).toBe(true);   // fixed after the revision
    expect(result.attempts).toBe(2);              // 1 wrong + 1 corrected
    expect(result.status).toBe('mr_saved');
  });
});
