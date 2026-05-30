import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { LLMOrchestrator } from '../src/llm/orchestrator.js';
import { ContextBundle, Incident } from '../src/types/index.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

const ORIG_OPENAI = process.env.OPENAI_API_KEY;
const ORIG_ANTHROPIC = process.env.ANTHROPIC_API_KEY;

function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-orch-'));
  ensureDirs(getPaths(dir));
  return dir;
}

function fakeIncident(): Incident {
  return {
    id: 'inc_1',
    service: 'api',
    environment: 'staging',
    severity: 'high',
    fingerprint: 'fp',
    status: 'created',
    summary: 'TypeError on retry',
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    event_count: 1,
    events: [],
  };
}

function fakeBundle(): ContextBundle {
  return {
    incident_id: 'inc_1',
    evidence_packet: { incident_id: 'inc_1', logs: [] },
    files: [
      { path: 'src/x.ts', reason: 'top frame', evidence_strength: 'high', content: 'x', original_bytes: 1 },
    ],
    memory: [],
    privacy: { redaction_applied: true, full_logs_sent: false, full_repo_sent: false, patterns_matched: {}, files_excluded: [] },
  };
}

describe('LLMOrchestrator provider dispatch', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (ORIG_OPENAI) process.env.OPENAI_API_KEY = ORIG_OPENAI; else delete process.env.OPENAI_API_KEY;
    if (ORIG_ANTHROPIC) process.env.ANTHROPIC_API_KEY = ORIG_ANTHROPIC; else delete process.env.ANTHROPIC_API_KEY;
  });

  it('falls back to dry-run when no provider env var is set', () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'openai' } });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg });
    expect(o.isDryRun()).toBe(true);
    expect(o.getProvider()).toBe('dry-run');
  });

  it('selects anthropic when ANTHROPIC_API_KEY is set and provider=anthropic', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'anthropic' } });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg });
    expect(o.getProvider()).toBe('anthropic');
    expect(o.isDryRun()).toBe(false);
  });

  it('selects openai when OPENAI_API_KEY is set and provider=openai', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'openai' } });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg });
    expect(o.getProvider()).toBe('openai');
  });

  it('honors trigger_mode=off as a hard dry-run gate even with a key set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      llm: { provider: 'openai', trigger_mode: 'off' },
    });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg });
    expect(o.isDryRun()).toBe(true);
    expect(o.getProvider()).toBe('dry-run');
  });

  it('coerces an out-of-enum / partial root-cause response instead of crashing', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    // A real model returned a reasonable-but-off classification and omitted arrays.
    const fakeClient = {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ classification: 'logic_bug', suspected_root_cause: 'wrong operator' }) } }] }) } },
    } as any;
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'openai' } });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, client: fakeClient });
    const rc = await o.rootCause(fakeIncident(), fakeBundle());
    expect(rc.classification).toBe('code_bug'); // coerced from unknown 'logic_bug'
    expect(rc.suspected_root_cause).toBe('wrong operator');
    expect(Array.isArray(rc.evidence)).toBe(true);
    expect(typeof rc.should_attempt_fix).toBe('boolean');
  });

  it('dry-run rootCause still produces a usable result', async () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'none' } });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg });
    const rc = await o.rootCause(fakeIncident(), fakeBundle());
    expect(rc.classification).toBeTruthy();
    expect(typeof rc.confidence).toBe('number');
  });

  it('trigger_mode=manual_only forces dry-run for automatic invocations', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      llm: { provider: 'openai', trigger_mode: 'manual_only' },
    });
    const auto = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, invocation: 'auto' });
    expect(auto.isDryRun()).toBe(true);
    const manual = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, invocation: 'manual' });
    expect(manual.isDryRun()).toBe(false);
    expect(manual.getProvider()).toBe('openai');
  });

  it('trigger_mode=incident_only allows automatic invocations', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      llm: { provider: 'openai', trigger_mode: 'incident_only' },
    });
    const auto = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, invocation: 'auto' });
    expect(auto.isDryRun()).toBe(false);
    expect(auto.getProvider()).toBe('openai');
  });
});

describe('LLMOrchestrator require_redaction policy', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (ORIG_OPENAI) process.env.OPENAI_API_KEY = ORIG_OPENAI; else delete process.env.OPENAI_API_KEY;
    if (ORIG_ANTHROPIC) process.env.ANTHROPIC_API_KEY = ORIG_ANTHROPIC; else delete process.env.ANTHROPIC_API_KEY;
  });

  it('refuses a live call when require_redaction is set but the bundle was not redacted', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      llm: { provider: 'openai' },
      policies: { model_calls: { require_redaction: true } },
    });
    let called = false;
    const fakeClient = {
      chat: { completions: { create: async () => { called = true; return { choices: [{ message: { content: '{}' } }] }; } } },
    };
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, client: fakeClient as any });
    const bundle = fakeBundle();
    bundle.privacy.redaction_applied = false;
    await expect(o.rootCause(fakeIncident(), bundle)).rejects.toThrow(/require_redaction/i);
    expect(called).toBe(false);
  });

  it('allows a live call when the bundle was redacted', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      llm: { provider: 'openai' },
      policies: { model_calls: { require_redaction: true } },
    });
    let called = false;
    const fakeClient = {
      chat: {
        completions: {
          create: async () => {
            called = true;
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      classification: 'code_bug',
                      suspected_root_cause: 'x',
                      evidence: [],
                      files_to_read_next: [],
                      should_attempt_fix: true,
                      confidence: 0.5,
                    }),
                  },
                },
              ],
            };
          },
        },
      },
    };
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, client: fakeClient as any });
    const bundle = fakeBundle(); // redaction_applied: true
    const rc = await o.rootCause(fakeIncident(), bundle);
    expect(called).toBe(true);
    expect(rc.classification).toBe('code_bug');
  });
});
