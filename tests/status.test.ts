import { describe, it, expect } from 'vitest';
import { summarizeIncidents, renderStatusLines } from '../src/incident/summary.js';
import { Incident, IncidentStatus } from '../src/types/index.js';

function inc(id: string, status: IncidentStatus, seen: string): Incident {
  return {
    id, service: 's', environment: 'prod', severity: 'high', fingerprint: 'f',
    status, summary: `sum ${id}`, first_seen: seen, last_seen: seen, event_count: 1, events: [],
  };
}

describe('summarizeIncidents', () => {
  const incidents = [
    inc('a', 'created', '2026-05-01'),
    inc('b', 'mr_opened', '2026-05-03'),
    inc('c', 'resolved', '2026-05-02'),
    inc('d', 'merged', '2026-05-04'),
    inc('e', 'blocked', '2026-05-05'),
  ];

  it('counts totals and per-status', () => {
    const s = summarizeIncidents(incidents);
    expect(s.total).toBe(5);
    expect(s.byStatus.created).toBe(1);
    expect(s.byStatus.mr_opened).toBe(1);
    expect(s.byStatus.merged).toBe(1);
  });

  it('counts open (non-terminal) incidents', () => {
    // terminal = resolved/merged/rejected → open = created, mr_opened, blocked = 3
    expect(summarizeIncidents(incidents).open).toBe(3);
  });

  it('returns the most recent incidents first, capped', () => {
    const s = summarizeIncidents(incidents, 2);
    expect(s.recent.map((r) => r.id)).toEqual(['e', 'd']); // newest first_seen first
    expect(s.recent.length).toBe(2);
  });

  it('handles an empty list', () => {
    const s = summarizeIncidents([]);
    expect(s.total).toBe(0);
    expect(s.open).toBe(0);
    expect(s.recent).toEqual([]);
  });
});

describe('renderStatusLines', () => {
  it('renders mode/provider, totals, and recent incident ids', () => {
    const s = summarizeIncidents([inc('a', 'created', '2026-05-01')]);
    const lines = renderStatusLines(s, { mode: 'sidecar', provider: 'anthropic' }).join('\n');
    expect(lines).toContain('mode=sidecar');
    expect(lines).toContain('provider=anthropic');
    expect(lines).toContain('1 total');
    expect(lines).toContain('1 open');
    expect(lines).toContain('a');
  });

  it('says so when there are no incidents', () => {
    const lines = renderStatusLines(summarizeIncidents([]), { mode: 'wrapper', provider: 'none' }).join('\n');
    expect(lines).toContain('No incidents yet');
  });
});
