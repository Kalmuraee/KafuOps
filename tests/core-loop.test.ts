import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { decideMrAction } from '../src/mr/decide.js';
import { selectPendingIncidents } from '../src/incident/worker.js';
import { Incident, IncidentStatus } from '../src/types/index.js';

function cfg(mr: Record<string, unknown> = {}) {
  return ConfigSchema.parse({ project: { name: 't' }, repo: { provider: 'github', mr } });
}

describe('decideMrAction', () => {
  it('opens an MR by default (enabled + auto_create, no merge)', () => {
    const d = decideMrAction(cfg(), {});
    expect(d.action).toBe('open');
    expect(d.merge).toBe(false);
  });

  it('saves only when dry-run', () => {
    expect(decideMrAction(cfg(), { dryRun: true }).action).toBe('save_only');
  });

  it('saves only when repo.mr.enabled is false', () => {
    expect(decideMrAction(cfg({ enabled: false }), {}).action).toBe('save_only');
  });

  it('saves only when auto_create is false (no longer a dead knob)', () => {
    expect(decideMrAction(cfg({ auto_create: false }), {}).action).toBe('save_only');
  });

  it('saves only when the change requires human approval', () => {
    const d = decideMrAction(cfg(), { requiresApproval: true });
    expect(d.action).toBe('save_only');
    expect(d.merge).toBe(false);
  });

  it('marks merge=true when auto_merge is enabled and the MR opens', () => {
    const d = decideMrAction(cfg({ auto_merge: true }), {});
    expect(d.action).toBe('open');
    expect(d.merge).toBe(true);
  });

  it('never merges when approval is required even if auto_merge is on', () => {
    const d = decideMrAction(cfg({ auto_merge: true }), { requiresApproval: true });
    expect(d.action).toBe('save_only');
    expect(d.merge).toBe(false);
  });
});

function inc(id: string, status: IncidentStatus): Incident {
  return {
    id, service: 's', environment: 'e', severity: 'high', fingerprint: 'f',
    status, summary: 's', first_seen: 'x', last_seen: 'x', event_count: 1, events: [],
  };
}

describe('selectPendingIncidents', () => {
  it('selects only incidents that still need processing', () => {
    const all = [
      inc('a', 'created'),
      inc('b', 'context_built'),
      inc('c', 'analyzed'),
      inc('d', 'mr_opened'),
      inc('e', 'blocked'),
      inc('f', 'resolved'),
      inc('g', 'merged'),
      inc('h', 'rejected'),
    ];
    const picked = selectPendingIncidents(all).map((i) => i.id).sort();
    expect(picked).toEqual(['a', 'b', 'c']);
  });
});
