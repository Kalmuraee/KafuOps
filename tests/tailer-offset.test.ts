import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { LogTailer } from '../src/runtime/tailer.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LogTailer offset persistence', () => {
  it('resumes from the persisted offset after a restart (no re-read, no gap)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-toff-'));
    ensureDirs(getPaths(dir));
    const logFile = path.join(dir, 'app.log');
    fs.writeFileSync(logFile, 'first\n');
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const opts = {
      sources: [{ type: 'file' as const, path: logFile }],
      service: 'demo',
      environment: 'production',
      config: cfg,
      rootDir: dir,
      pollIntervalMs: 20,
    };

    const t1 = new LogTailer(opts);
    t1.start(); // starts at EOF (offset past "first")
    await sleep(40);
    fs.appendFileSync(logFile, 'second\n');
    await sleep(80);
    expect(t1.getBuffer().snapshot().some((e) => e.message.includes('second'))).toBe(true);
    t1.stop();

    // New tailer, same state file: lines appended while "down" are picked up,
    // and already-consumed lines are NOT re-read.
    fs.appendFileSync(logFile, 'third\n');
    const t2 = new LogTailer(opts);
    t2.start();
    await sleep(80);
    const msgs = t2.getBuffer().snapshot().map((e) => e.message);
    t2.stop();
    expect(msgs.some((m) => m.includes('third'))).toBe(true);
    expect(msgs.some((m) => m.includes('second'))).toBe(false);
    expect(msgs.some((m) => m.includes('first'))).toBe(false);
  });
});
