import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { IncidentStore } from '../src/incident/store.js';
import { buildContext } from '../src/context/builder.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';
import { Incident } from '../src/types/index.js';

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-rel-'));
  ensureDirs(getPaths(dir));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
  return dir;
}

function inc(id: string, over: Partial<Incident> = {}): Incident {
  return {
    id, service: 'demo', environment: 'prod', severity: 'high',
    fingerprint: 'demo|-|TypeError|src/a.ts|x', status: 'created',
    summary: 'TypeError in a', first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(), event_count: 1,
    top_frame_file: 'src/a.ts', exception_type: 'TypeError', events: [], ...over,
  };
}

describe('similar-incident matching', () => {
  it('surfaces a recurring incident (same fingerprint) as related', () => {
    const dir = repo();
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const store = new IncidentStore(dir);
    store.save(inc('inc_old', { status: 'merged' }));

    const res = buildContext(dir, cfg, { incident: inc('inc_new') });
    expect(res.bundle.evidence_packet.related_incidents).toContain('inc_old');
  });

  it('matches by top_frame_file even when fingerprints differ', () => {
    const dir = repo();
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const store = new IncidentStore(dir);
    store.save(inc('inc_frame', { fingerprint: 'different', summary: 'other error', exception_type: 'RangeError' }));

    const res = buildContext(dir, cfg, { incident: inc('inc_new') });
    expect(res.bundle.evidence_packet.related_incidents).toContain('inc_frame');
  });

  it('does not relate an unrelated incident or itself', () => {
    const dir = repo();
    const cfg = ConfigSchema.parse({ project: { name: 'demo' } });
    const store = new IncidentStore(dir);
    store.save(inc('inc_unrelated', { fingerprint: 'zzz', top_frame_file: 'src/z.ts', exception_type: 'KeyError' }));

    const res = buildContext(dir, cfg, { incident: inc('inc_new') });
    const related = res.bundle.evidence_packet.related_incidents ?? [];
    expect(related).not.toContain('inc_unrelated');
    expect(related).not.toContain('inc_new');
  });
});
