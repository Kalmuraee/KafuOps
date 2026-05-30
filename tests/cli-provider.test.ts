import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { LLMOrchestrator, buildCliCommand } from '../src/llm/orchestrator.js';
import { ContextBundle, Incident } from '../src/types/index.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-cli-'));
  ensureDirs(getPaths(dir));
  return dir;
}
function fakeIncident(): Incident {
  return { id: 'inc_1', service: 'api', environment: 'staging', severity: 'high', fingerprint: 'fp', status: 'created', summary: 's', first_seen: 'T', last_seen: 'T', event_count: 1, events: [] };
}
function fakeBundle(): ContextBundle {
  return { incident_id: 'inc_1', evidence_packet: { incident_id: 'inc_1', logs: [] }, files: [{ path: 'src/x.ts', reason: 'frame', evidence_strength: 'high', content: 'x', original_bytes: 1 }], memory: [], privacy: { redaction_applied: true, full_logs_sent: false, full_repo_sent: false, patterns_matched: {}, files_excluded: [] } };
}
const ROOT_CAUSE_JSON = JSON.stringify({ classification: 'code_bug', suspected_root_cause: 'x', evidence: [], files_to_read_next: [], should_attempt_fix: true, confidence: 0.5 });

describe('buildCliCommand', () => {
  it('builds a claude CLI invocation', () => {
    const { cmd, args } = buildCliCommand('claude-cli', 'PROMPT', 'claude-sonnet-4-6');
    expect(cmd).toBe('claude');
    expect(args).toContain('-p');
    expect(args).toContain('PROMPT');
    expect(args.join(' ')).toContain('--model claude-sonnet-4-6');
  });
  it('builds a codex CLI invocation', () => {
    const { cmd, args } = buildCliCommand('codex', 'PROMPT');
    expect(cmd).toBe('codex');
    expect(args[0]).toBe('exec');
    expect(args).toContain('PROMPT');
  });
});

describe('LLMOrchestrator local CLI providers', () => {
  it('selects the codex provider (no API key required) and runs the CLI', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const cliRunner = async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: '```json\n' + ROOT_CAUSE_JSON + '\n```', stderr: '', timedOut: false };
    };
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'codex' } });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, cliRunner });
    expect(o.getProvider()).toBe('codex');
    expect(o.isDryRun()).toBe(false);
    const rc = await o.rootCause(fakeIncident(), fakeBundle());
    expect(rc.classification).toBe('code_bug');
    expect(calls[0].cmd).toBe('codex');
  });

  it('surfaces a CLI failure as an error', async () => {
    const cliRunner = async () => ({ code: 127, stdout: '', stderr: 'command not found', timedOut: false });
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'claude-cli' } });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, cliRunner });
    await expect(o.rootCause(fakeIncident(), fakeBundle())).rejects.toThrow(/claude|cli|command not found/i);
  });

  it('honors trigger_mode=off for CLI providers too', () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' }, llm: { provider: 'codex', trigger_mode: 'off' } });
    const o = new LLMOrchestrator({ rootDir: freshDir(), config: cfg, cliRunner: async () => ({ code: 0, stdout: '{}', stderr: '', timedOut: false }) });
    expect(o.isDryRun()).toBe(true);
  });
});
