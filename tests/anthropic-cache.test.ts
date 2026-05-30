import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { LLMOrchestrator } from '../src/llm/orchestrator.js';
import { ContextBundle, Incident } from '../src/types/index.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

const ORIG = process.env.ANTHROPIC_API_KEY;

function dir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-cache-'));
  ensureDirs(getPaths(d));
  return d;
}
function inc(): Incident {
  return { id: 'i', service: 's', environment: 'e', severity: 'high', fingerprint: 'f', status: 'created', summary: 's', first_seen: 'T', last_seen: 'T', event_count: 1, events: [] };
}
function bundle(): ContextBundle {
  return { incident_id: 'i', evidence_packet: { incident_id: 'i', logs: [] }, files: [{ path: 'x', reason: 'r', evidence_strength: 'high', content: 'c', original_bytes: 1 }], memory: [], privacy: { redaction_applied: true, full_logs_sent: false, full_repo_sent: false, patterns_matched: {}, files_excluded: [] } };
}
const RC = JSON.stringify({ classification: 'code_bug', suspected_root_cause: 'x', evidence: [], files_to_read_next: [], should_attempt_fix: true, confidence: 0.5 });

function fakeAnthropic(captured: { args?: any }) {
  return { messages: { create: async (args: any) => { captured.args = args; return { content: [{ type: 'text', text: RC }] }; } } } as any;
}

describe('Anthropic prompt caching', () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'sk-ant-test'; });
  afterEach(() => { if (ORIG) process.env.ANTHROPIC_API_KEY = ORIG; else delete process.env.ANTHROPIC_API_KEY; });

  it('marks the system prompt with cache_control when prompt_cache is on', async () => {
    const captured: { args?: any } = {};
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'anthropic', prompt_cache: true } });
    const o = new LLMOrchestrator({ rootDir: dir(), config: cfg, anthropicClient: fakeAnthropic(captured) });
    await o.rootCause(inc(), bundle());
    const sys = captured.args.system;
    expect(Array.isArray(sys)).toBe(true);
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends a plain string system when prompt_cache is off', async () => {
    const captured: { args?: any } = {};
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'anthropic', prompt_cache: false } });
    const o = new LLMOrchestrator({ rootDir: dir(), config: cfg, anthropicClient: fakeAnthropic(captured) });
    await o.rootCause(inc(), bundle());
    expect(typeof captured.args.system).toBe('string');
  });
});
