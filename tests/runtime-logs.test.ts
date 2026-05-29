import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { IncidentStore } from '../src/incident/store.js';
import { buildContext } from '../src/context/builder.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { Incident } from '../src/types/index.js';

function freshRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-rtlogs-'));
  ensureDirs(getPaths(dir));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
  return dir;
}

function incident(id: string): Incident {
  return {
    id,
    service: 'demo',
    environment: 'staging',
    severity: 'high',
    fingerprint: 'fp',
    status: 'created',
    summary: 'boom',
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    event_count: 1,
    events: [
      {
        id: 'evt_1',
        service: 'demo',
        environment: 'staging',
        type: 'uncaught_exception',
        severity: 'error',
        timestamp: new Date().toISOString(),
        message: 'EVENT_MESSAGE_ONLY',
      },
    ],
  };
}

describe('IncidentStore runtime logs', () => {
  it('round-trips persisted log excerpts', () => {
    const dir = freshRepo();
    const store = new IncidentStore(dir);
    const logs = [
      { timestamp: new Date().toISOString(), message: 'line one' },
      { timestamp: new Date().toISOString(), message: 'line two' },
    ];
    store.saveLogs('inc_x', logs);
    const loaded = store.loadLogs('inc_x');
    expect(loaded).toEqual(logs);
  });

  it('returns null when no logs were persisted', () => {
    const dir = freshRepo();
    const store = new IncidentStore(dir);
    expect(store.loadLogs('inc_missing')).toBeNull();
  });
});

describe('Context builder uses persisted runtime logs', () => {
  it('prefers persisted ring-buffer logs over raw event messages', () => {
    const dir = freshRepo();
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const store = new IncidentStore(dir);
    const inc = incident('inc_logs');
    store.save(inc);
    store.saveLogs(inc.id, [
      { timestamp: inc.first_seen, message: 'RINGBUFFER_LOG_LINE around the error' },
    ]);

    const res = buildContext(dir, cfg, { incident: inc });
    const messages = res.bundle.evidence_packet.logs.map((l) => l.message).join('\n');
    expect(messages).toContain('RINGBUFFER_LOG_LINE');
    // It should NOT fall back to raw event messages when real logs exist.
    expect(messages).not.toContain('EVENT_MESSAGE_ONLY');
  });
});
