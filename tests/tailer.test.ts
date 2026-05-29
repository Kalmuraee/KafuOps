import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { LogTailer } from '../src/runtime/tailer.js';
import { RuntimeEvent } from '../src/types/index.js';

function waitForEvent(tailer: LogTailer, predicate: (e: RuntimeEvent) => boolean, timeoutMs = 2000): Promise<RuntimeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for event')), timeoutMs);
    tailer.on('event', (e: RuntimeEvent) => {
      if (predicate(e)) {
        clearTimeout(timer);
        resolve(e);
      }
    });
  });
}

describe('LogTailer', () => {
  it('tails appended lines from a file source and emits a parsed error event', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-tail-'));
    const logFile = path.join(dir, 'app.log');
    fs.writeFileSync(logFile, 'starting up\n');

    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const tailer = new LogTailer({
      sources: [{ type: 'file', path: logFile }],
      service: 'demo',
      environment: 'production',
      config: cfg,
      rootDir: dir,
      pollIntervalMs: 20,
    });
    tailer.start();
    try {
      const pending = waitForEvent(tailer, (e) => e.type === 'uncaught_exception');
      // Append an error AFTER the tailer has started so we exercise tailing, not initial read.
      await new Promise((r) => setTimeout(r, 60));
      fs.appendFileSync(
        logFile,
        'TypeError: Cannot read properties of undefined\n    at handler (src/app.ts:10:5)\n',
      );
      const ev = await pending;
      expect(ev.service).toBe('demo');
      expect(ev.attributes?.top_frame_file).toBe('src/app.ts');
    } finally {
      tailer.stop();
    }
  });

  it('captures tailed lines into the ring buffer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-tail2-'));
    const logFile = path.join(dir, 'app.log');
    fs.writeFileSync(logFile, '');
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const tailer = new LogTailer({
      sources: [{ type: 'file', path: logFile }],
      service: 'demo',
      environment: 'production',
      config: cfg,
      rootDir: dir,
      pollIntervalMs: 20,
    });
    tailer.start();
    try {
      fs.appendFileSync(logFile, 'hello world\n');
      await new Promise((r) => setTimeout(r, 120));
      const snap = tailer.getBuffer().snapshot();
      expect(snap.some((e) => e.message.includes('hello world'))).toBe(true);
    } finally {
      tailer.stop();
    }
  });
});
