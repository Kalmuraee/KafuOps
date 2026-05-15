import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { loadConfig, writeConfig } from '../src/config/loader.js';

describe('Config', () => {
  it('applies defaults for an empty project name', () => {
    const c = ConfigSchema.parse({ project: { name: 'demo' } });
    expect(c.runtime.mode).toBe('wrapper');
    expect(c.privacy.send_full_logs_to_llm).toBe(false);
    expect(c.policies.never_modify).toContain('.env');
  });

  it('round-trips through write+load', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-cfg-'));
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const target = path.join(dir, '.kafuops.yml');
    writeConfig(target, cfg);
    const loaded = loadConfig({ cwd: dir });
    expect(loaded.config.project.name).toBe('demo');
    expect(loaded.configPath).toBe(target);
  });
});
