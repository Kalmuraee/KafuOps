import { Incident, IncidentStatus } from '../types/index.js';

const TERMINAL: IncidentStatus[] = ['resolved', 'merged', 'rejected'];

export interface StatusSummary {
  total: number;
  /** Non-terminal incidents (still need attention). */
  open: number;
  byStatus: Record<string, number>;
  recent: Array<{ id: string; status: string; severity: string; summary: string; first_seen: string }>;
}

/** Aggregate incidents for the `status`/`watch` dashboards. Pure. */
export function summarizeIncidents(incidents: Incident[], recentLimit = 10): StatusSummary {
  const byStatus: Record<string, number> = {};
  let open = 0;
  for (const i of incidents) {
    byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    if (!TERMINAL.includes(i.status)) open += 1;
  }
  const recent = [...incidents]
    .sort((a, b) => b.first_seen.localeCompare(a.first_seen))
    .slice(0, recentLimit)
    .map((i) => ({ id: i.id, status: i.status, severity: i.severity, summary: i.summary, first_seen: i.first_seen }));
  return { total: incidents.length, open, byStatus, recent };
}

export interface StatusMeta {
  mode: string;
  provider: string;
}

/** Render the status dashboard as plain lines (pure — shared by `status` and `watch`). */
export function renderStatusLines(summary: StatusSummary, meta: StatusMeta): string[] {
  const lines: string[] = [];
  lines.push(`KafuOps — mode=${meta.mode} · provider=${meta.provider}`);
  lines.push(`Incidents: ${summary.total} total · ${summary.open} open`);
  const parts = Object.entries(summary.byStatus).map(([k, v]) => `${k}=${v}`);
  if (parts.length) lines.push(`  by status: ${parts.join('  ')}`);
  if (summary.recent.length) {
    lines.push('Recent:');
    for (const r of summary.recent) {
      lines.push(`  ${r.id}  ${r.status.padEnd(13)} ${r.severity.padEnd(8)} ${r.summary.slice(0, 60)}`);
    }
  } else {
    lines.push('No incidents yet.');
  }
  return lines;
}
