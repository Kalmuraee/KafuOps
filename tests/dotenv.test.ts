import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDotenv, applyDotenv, loadEnvFile } from '../src/util/dotenv.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

describe('parseDotenv', () => {
  it('parses KEY=value, quotes, exports, comments, and blanks', () => {
    const txt = [
      '# a comment',
      '',
      'OPENAI_API_KEY=sk-123',
      'export KAFUOPS_GIT_TOKEN="ghp_abc"',
      "ANTHROPIC_API_KEY='sk-ant'",
      'WITH_EQUALS=a=b=c',
      'badline-no-equals',
    ].join('\n');
    expect(parseDotenv(txt)).toEqual({
      OPENAI_API_KEY: 'sk-123',
      KAFUOPS_GIT_TOKEN: 'ghp_abc',
      ANTHROPIC_API_KEY: 'sk-ant',
      WITH_EQUALS: 'a=b=c',
    });
  });
});

describe('applyDotenv', () => {
  it('sets unset keys but never overrides existing env', () => {
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'real-key' };
    const applied = applyDotenv(env, { OPENAI_API_KEY: 'from-file', NEW_ONE: 'x' });
    expect(env.OPENAI_API_KEY).toBe('real-key'); // existing wins
    expect(env.NEW_ONE).toBe('x');
    expect(applied).toEqual(['NEW_ONE']);
  });
});

describe('loadEnvFile', () => {
  it('loads .kafuops/.env from the project root into the env', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-env-'));
    ensureDirs(getPaths(dir));
    fs.writeFileSync(path.join(getPaths(dir).base, '.env'), 'OPENAI_API_KEY=sk-loaded\nKAFUOPS_GIT_TOKEN=tok\n', { mode: 0o600 });
    const env: Record<string, string | undefined> = {};
    const loaded = loadEnvFile(dir, env);
    expect(env.OPENAI_API_KEY).toBe('sk-loaded');
    expect(env.KAFUOPS_GIT_TOKEN).toBe('tok');
    expect(loaded.sort()).toEqual(['KAFUOPS_GIT_TOKEN', 'OPENAI_API_KEY']);
  });

  it('is a no-op when the file is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-env2-'));
    expect(loadEnvFile(dir, {})).toEqual([]);
  });
});
