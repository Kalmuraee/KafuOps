import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { recordDeploy, recentDeploy } from '../src/incident/deploys.js';
import { IncidentEngine } from '../src/incident/engine.js';
import { IncidentStore } from '../src/incident/store.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { Incident, RuntimeEvent } from '../src/types/index.js';

function dir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-dep-'));
  ensureDirs(getPaths(d));
  return d;
}
function errorEvent(over: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id: 'e', service: 'api', environment: 'production', type: 'error.log', severity: 'error',
    timestamp: new Date().toISOString(), message: 'boom', ...over,
  };
}

describe('deploy markers', () => {
  it('records and finds a recent deploy within the window', () => {
    const d = dir();
    recordDeploy(d, { version: 'v1', at: '2026-05-30T00:00:00.000Z' });
    const at10 = new Date('2026-05-30T00:10:00.000Z').getTime();
    expect(recentDeploy(d, 30, at10)?.version).toBe('v1'); // 10min ago, within 30
    expect(recentDeploy(d, 5, at10)).toBeNull(); // 10min ago, outside 5
  });

  it('returns null when there are no deploys', () => {
    expect(recentDeploy(dir(), 60)).toBeNull();
  });
});

describe('deployment_regression trigger', () => {
  const cfg = (rules: unknown[]) =>
    ConfigSchema.parse({ project: { name: 'api' }, triggers: { create_incident_when: rules } });

  it('fires when an error follows a recent deploy', () => {
    const d = dir();
    recordDeploy(d, { version: 'v2' }); // now
    const engine = new IncidentEngine(d, cfg([{ type: 'deployment_regression', error_started_within_minutes: 30 }]));
    const inc = engine.ingest(errorEvent());
    expect(inc).not.toBeNull();
    expect(inc!.trigger_reason).toMatch(/deployment_regression/);
  });

  it('does not fire without a recent deploy', () => {
    const d = dir();
    const engine = new IncidentEngine(d, cfg([{ type: 'deployment_regression', error_started_within_minutes: 30 }]));
    expect(engine.ingest(errorEvent())).toBeNull();
  });
});

describe('recurrence detection', () => {
  it('flags a new incident as a recurrence of a prior merged incident with the same fingerprint', () => {
    const d = dir();
    const store = new IncidentStore(d);
    const prior: Incident = {
      id: 'inc_prior', service: 'api', environment: 'production', severity: 'high', fingerprint: 'api|-|TypeError|x',
      status: 'merged', summary: 'old', first_seen: '2026-05-01', last_seen: '2026-05-01', event_count: 1, events: [],
    };
    store.save(prior);
    const cfg = ConfigSchema.parse({ project: { name: 'api' } }); // default triggers incl. uncaught_exception
    const engine = new IncidentEngine(d, cfg);
    const inc = engine.ingest(errorEvent({ type: 'uncaught_exception', attributes: { fingerprint: 'api|-|TypeError|x' } }));
    expect(inc).not.toBeNull();
    expect(inc!.recurrence_of).toBe('inc_prior');
  });
});
