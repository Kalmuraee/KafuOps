import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema, KafuOpsConfig } from '../config/schema.js';
import { Incident } from '../types/index.js';
import { IncidentStore } from '../incident/store.js';
import { LLMOrchestrator } from '../llm/orchestrator.js';
import { processIncidentToMr } from '../incident/pipeline.js';
import { ensureDirs, getPaths } from '../util/paths.js';

/** A seeded bug: a tiny repo whose `testCommand` fails until the bug is fixed. */
export interface EvalCase {
  name: string;
  files: Record<string, string>;
  testCommand: string;
  incident: Incident;
  /** Whether a competent agent is expected to fix this case (almost always true). */
  expectFix: boolean;
}

export interface EvalCaseResult {
  name: string;
  fixed: boolean;
  status: string;
  confidence?: number;
  attempts?: number;
  expectFix: boolean;
  /** Did the outcome match the expectation? */
  correct: boolean;
}

export interface EvalReport {
  total: number;
  fixed: number;
  fixRate: number;
  avgAttempts: number;
  /** Confidence calibration: are fixed cases more confident than unfixed ones? */
  calibration: { fixedAvgConfidence: number | null; unfixedAvgConfidence: number | null };
  cases: EvalCaseResult[];
}

export type OrchestratorFactory = (rootDir: string, config: KafuOpsConfig) => LLMOrchestrator;

export interface RunEvalOptions {
  llm: { provider: KafuOpsConfig['llm']['provider']; models?: { analysis: string; patch: string } };
  orchestratorFactory: OrchestratorFactory;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export async function runEvalCase(c: EvalCase, opts: RunEvalOptions): Promise<EvalCaseResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kafuops-eval-${c.name}-`));
  try {
    for (const [rel, content] of Object.entries(c.files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    ensureDirs(getPaths(dir));
    const config = ConfigSchema.parse({
      project: { name: c.name, language: 'javascript', framework: 'node' },
      repo: { provider: 'none' },
      llm: { provider: opts.llm.provider, ...(opts.llm.models ? { models: opts.llm.models } : {}) },
      sandbox: { install_command: '', test_command: c.testCommand },
    });
    const store = new IncidentStore(dir);
    store.save(c.incident);
    const orchestrator = opts.orchestratorFactory(dir, config);
    const result = await processIncidentToMr(dir, config, c.incident.id, { orchestrator });

    let fixed = false;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(getPaths(dir).incidents, c.incident.id, 'validation.json'), 'utf8'));
      fixed = v.tests_passed === true;
    } catch {
      fixed = false;
    }
    return {
      name: c.name,
      fixed,
      status: result.status,
      confidence: result.confidence,
      attempts: result.attempts,
      expectFix: c.expectFix,
      correct: fixed === c.expectFix,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runEval(cases: EvalCase[], opts: RunEvalOptions): Promise<EvalReport> {
  const results: EvalCaseResult[] = [];
  for (const c of cases) results.push(await runEvalCase(c, opts));
  const fixed = results.filter((r) => r.fixed);
  const unfixed = results.filter((r) => !r.fixed);
  return {
    total: results.length,
    fixed: fixed.length,
    fixRate: results.length ? fixed.length / results.length : 0,
    avgAttempts: avg(results.map((r) => r.attempts ?? 0)),
    calibration: {
      fixedAvgConfidence: fixed.length ? avg(fixed.map((r) => r.confidence ?? 0)) : null,
      unfixedAvgConfidence: unfixed.length ? avg(unfixed.map((r) => r.confidence ?? 0)) : null,
    },
    cases: results,
  };
}

// ---- Built-in seeded suite (meaningfully fixed only by a real model) ----

function incidentFor(id: string, file: string, summary: string): Incident {
  return {
    id, service: 'eval', environment: 'staging', severity: 'high', fingerprint: `eval|${file}`,
    status: 'created', summary, first_seen: '', last_seen: '', event_count: 1,
    top_frame_file: file, top_frame_line: 2, events: [],
  };
}

export const BUILTIN_CASES: EvalCase[] = [
  {
    name: 'wrong-operator',
    files: {
      'package.json': JSON.stringify({ name: 'mathy' }),
      'src/math.js': 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n',
      'check.js': "const { add } = require('./src/math.js');\nif (add(2, 3) !== 5) { console.error('add(2,3) should be 5'); process.exit(1); }\n",
    },
    testCommand: 'node check.js',
    incident: incidentFor('eval_op', 'src/math.js', 'add() returns the wrong result'),
    expectFix: true,
  },
  {
    name: 'off-by-one',
    files: {
      'package.json': JSON.stringify({ name: 'slicer' }),
      'src/last.js': 'function last(arr) {\n  return arr[arr.length];\n}\nmodule.exports = { last };\n',
      'check.js': "const { last } = require('./src/last.js');\nif (last([1, 2, 3]) !== 3) { console.error('last should be 3'); process.exit(1); }\n",
    },
    testCommand: 'node check.js',
    incident: incidentFor('eval_obo', 'src/last.js', 'last() is undefined (off-by-one)'),
    expectFix: true,
  },
  {
    name: 'missing-null-guard',
    files: {
      'package.json': JSON.stringify({ name: 'guard' }),
      'src/name.js': 'function fullName(user) {\n  return user.profile.name;\n}\nmodule.exports = { fullName };\n',
      'check.js': "const { fullName } = require('./src/name.js');\nif (fullName({}) !== '') { console.error('should return empty string when missing'); process.exit(1); }\n",
    },
    testCommand: 'node check.js',
    incident: incidentFor('eval_null', 'src/name.js', 'TypeError: cannot read name of undefined'),
    expectFix: true,
  },
];
