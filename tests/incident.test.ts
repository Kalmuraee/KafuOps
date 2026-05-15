import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { IncidentEngine } from '../src/incident/engine.js';
import { RuntimeEvent } from '../src/types/index.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-test-'));
}

function makeEvent(overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id: 'evt_' + Math.random().toString(36).slice(2),
    service: 'api',
    environment: 'staging',
    type: 'uncaught_exception',
    severity: 'error',
    timestamp: new Date().toISOString(),
    message: 'TypeError: Cannot read properties of undefined',
    stacktrace: `TypeError: Cannot read properties of undefined\n    at h (src/x.ts:1:1)`,
    attributes: {
      fingerprint: 'api|-|TypeError|src/x.ts|cannot read properties',
      exception_type: 'TypeError',
      top_frame_file: 'src/x.ts',
      top_frame_line: 1,
    },
    ...overrides,
  };
}

describe('IncidentEngine', () => {
  let dir: string;
  beforeEach(() => {
    dir = freshDir();
    ensureDirs(getPaths(dir));
  });

  it('creates an incident on uncaught_exception trigger', () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const engine = new IncidentEngine(dir, cfg);
    const inc = engine.ingest(makeEvent());
    expect(inc).not.toBeNull();
    expect(inc!.event_count).toBe(1);
    expect(inc!.fingerprint).toContain('TypeError');
  });

  it('deduplicates same fingerprint into one incident', () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const engine = new IncidentEngine(dir, cfg);
    const a = engine.ingest(makeEvent());
    const b = engine.ingest(makeEvent());
    expect(a!.id).toBe(b!.id);
    expect(b!.event_count).toBe(2);
  });

  it('respects repeated_stacktrace threshold for log-level events', () => {
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      triggers: {
        create_incident_when: [{ type: 'repeated_stacktrace', count: 3, window_seconds: 60 }],
      },
    });
    const engine = new IncidentEngine(dir, cfg);
    const a = engine.ingest(makeEvent({ type: 'error.log' }));
    expect(a).toBeNull();
    const b = engine.ingest(makeEvent({ type: 'error.log' }));
    expect(b).toBeNull();
    const c = engine.ingest(makeEvent({ type: 'error.log' }));
    expect(c).not.toBeNull();
    expect(c!.event_count).toBe(1);
  });

  it('filters out ignored routes', () => {
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      noise_control: { ignore: [{ route: 'GET /healthz' }] },
    });
    const engine = new IncidentEngine(dir, cfg);
    const ev = makeEvent({ route: 'GET /healthz' });
    expect(engine.ingest(ev)).toBeNull();
  });
});
