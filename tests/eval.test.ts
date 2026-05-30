import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigSchema, KafuOpsConfig } from '../src/config/schema.js';
import { LLMOrchestrator } from '../src/llm/orchestrator.js';
import { runEval, EvalCase } from '../src/eval/harness.js';
import { Incident } from '../src/types/index.js';

const ORIG_OPENAI = process.env.OPENAI_API_KEY;

const MATH_CASE: EvalCase = {
  name: 'add-operator',
  files: {
    'package.json': JSON.stringify({ name: 'mathy' }),
    'src/math.js': 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n',
    'check.js': "const { add } = require('./src/math.js');\nif (add(2, 3) !== 5) process.exit(1);\n",
  },
  testCommand: 'node check.js',
  incident: {
    id: 'eval_math', service: 'mathy', environment: 'staging', severity: 'high', fingerprint: 'fp',
    status: 'created', summary: 'add() wrong', first_seen: '', last_seen: '', event_count: 1,
    top_frame_file: 'src/math.js', top_frame_line: 2, events: [],
  } as Incident,
  expectFix: true,
};

const CORRECT_DIFF = ['--- a/src/math.js', '+++ b/src/math.js', '@@ -1,4 +1,4 @@', ' function add(a, b) {', '-  return a - b;', '+  return a + b;', ' }', ' module.exports = { add };', ''].join('\n');

function fixingFactory() {
  return (rootDir: string, config: KafuOpsConfig) =>
    new LLMOrchestrator({
      rootDir,
      config,
      client: {
        chat: {
          completions: {
            create: async (args: any) => {
              const u = args.messages.map((m: any) => m.content).join('\n');
              let p: unknown;
              if (u.includes('classify the issue')) p = { classification: 'code_bug', suspected_root_cause: 'op', evidence: [], files_to_read_next: [], should_attempt_fix: true, confidence: 0.9 };
              else if (u.includes('plan the smallest viable patch')) p = { patch_type: 'bug_fix', files_to_modify: ['src/math.js'], test_strategy: 'check', risk_level: 'low', reason: 'op' };
              else if (u.includes('unified diff')) p = { unified_diff: CORRECT_DIFF, summary: 'fix', new_test_files: [] };
              else p = { text: 'fixed' };
              return { choices: [{ message: { content: JSON.stringify(p) } }] };
            },
          },
        },
      } as any,
    });
}

describe('eval harness', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => { if (ORIG_OPENAI) process.env.OPENAI_API_KEY = ORIG_OPENAI; else delete process.env.OPENAI_API_KEY; });

  it('reports a 100% fix rate when the model fixes the seeded bug', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const report = await runEval([MATH_CASE], {
      llm: { provider: 'openai' },
      orchestratorFactory: fixingFactory(),
    });
    expect(report.total).toBe(1);
    expect(report.fixed).toBe(1);
    expect(report.fixRate).toBe(1);
    expect(report.cases[0].correct).toBe(true);
  });

  it('reports a 0% fix rate in dry-run (empty diffs)', async () => {
    const report = await runEval([MATH_CASE], {
      llm: { provider: 'none' },
      orchestratorFactory: (rootDir, config) => new LLMOrchestrator({ rootDir, config }),
    });
    expect(report.fixRate).toBe(0);
    expect(report.cases[0].fixed).toBe(false);
  });
});
