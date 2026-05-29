import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { LLMOrchestrator } from '../src/llm/orchestrator.js';
import { IncidentStore } from '../src/incident/store.js';
import { incidentPolicyReport } from '../src/cli/commands/policies.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { ContextBundle, Incident } from '../src/types/index.js';

const ORIG_OPENAI = process.env.OPENAI_API_KEY;

function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-cw-'));
  ensureDirs(getPaths(dir));
  return dir;
}
function fakeIncident(): Incident {
  return {
    id: 'inc_1', service: 'api', environment: 'staging', severity: 'high', fingerprint: 'fp',
    status: 'created', summary: 's', first_seen: new Date().toISOString(), last_seen: new Date().toISOString(),
    event_count: 1, events: [],
  };
}
function fakeBundle(): ContextBundle {
  return {
    incident_id: 'inc_1', evidence_packet: { incident_id: 'inc_1', logs: [] },
    files: [{ path: 'src/x.ts', reason: 'top frame', evidence_strength: 'high', content: 'x', original_bytes: 1 }],
    memory: [],
    privacy: { redaction_applied: true, full_logs_sent: false, full_repo_sent: false, patterns_matched: {}, files_excluded: [] },
  };
}
const ROOT_CAUSE_JSON = JSON.stringify({
  classification: 'code_bug', suspected_root_cause: 'x', evidence: [], files_to_read_next: [],
  should_attempt_fix: true, confidence: 0.5,
});

describe('privacy.audit_model_context gates audit logging', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => { if (ORIG_OPENAI) process.env.OPENAI_API_KEY = ORIG_OPENAI; else delete process.env.OPENAI_API_KEY; });

  function fakeClient(captured?: { args?: any }) {
    return {
      chat: { completions: { create: async (args: any) => { if (captured) captured.args = args; return { choices: [{ message: { content: ROOT_CAUSE_JSON } }] }; } } },
    } as any;
  }

  it('writes an audit record when audit_model_context=true', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const dir = freshDir();
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'openai' } });
    const o = new LLMOrchestrator({ rootDir: dir, config: cfg, client: fakeClient() });
    await o.rootCause(fakeIncident(), fakeBundle());
    const files = fs.readdirSync(getPaths(dir).modelCalls);
    expect(files.length).toBe(1);
  });

  it('skips the audit record when audit_model_context=false', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const dir = freshDir();
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'openai' }, privacy: { audit_model_context: false } });
    const o = new LLMOrchestrator({ rootDir: dir, config: cfg, client: fakeClient() });
    await o.rootCause(fakeIncident(), fakeBundle());
    const files = fs.readdirSync(getPaths(dir).modelCalls);
    expect(files.length).toBe(0);
  });

  it('llm.structured_outputs controls the OpenAI response_format', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const dir = freshDir();
    const capturedOn: { args?: any } = {};
    const cfgOn = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'openai', structured_outputs: true } });
    await new LLMOrchestrator({ rootDir: dir, config: cfgOn, client: fakeClient(capturedOn) }).rootCause(fakeIncident(), fakeBundle());
    expect(capturedOn.args.response_format).toEqual({ type: 'json_object' });

    const capturedOff: { args?: any } = {};
    const cfgOff = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'openai', structured_outputs: false } });
    await new LLMOrchestrator({ rootDir: dir, config: cfgOff, client: fakeClient(capturedOff) }).rootCause(fakeIncident(), fakeBundle());
    expect(capturedOff.args.response_format).toBeUndefined();
  });
});

describe('incidentPolicyReport (policies explain --incident)', () => {
  it('reports require_approval for changed files matching a policy glob', () => {
    const dir = freshDir();
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const store = new IncidentStore(dir);
    store.save(fakeIncident());
    store.saveChangedFiles('inc_1', ['src/auth/session.ts', 'src/util/x.ts']);
    const report = incidentPolicyReport(dir, cfg, 'inc_1');
    expect(report).not.toBeNull();
    expect(report!.outcome).toBe('require_approval');
    expect(report!.files.find((f) => f.file === 'src/auth/session.ts')!.decision).toBe('require_approval');
  });

  it('returns null for an unknown incident', () => {
    const dir = freshDir();
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    expect(incidentPolicyReport(dir, cfg, 'nope')).toBeNull();
  });
});
