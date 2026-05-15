import fs from 'node:fs';
import path from 'node:path';
import { Incident } from '../types/index.js';
import { getPaths } from '../util/paths.js';

export class IncidentStore {
  constructor(private readonly rootDir: string) {}

  private dir(incidentId: string): string {
    return path.join(getPaths(this.rootDir).incidents, incidentId);
  }

  save(incident: Incident): string {
    const d = this.dir(incident.id);
    fs.mkdirSync(d, { recursive: true });
    const file = path.join(d, 'incident.json');
    fs.writeFileSync(file, JSON.stringify(incident, null, 2));
    return file;
  }

  load(incidentId: string): Incident | null {
    const file = path.join(this.dir(incidentId), 'incident.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Incident;
  }

  list(): Incident[] {
    const base = getPaths(this.rootDir).incidents;
    if (!fs.existsSync(base)) return [];
    const out: Incident[] = [];
    for (const id of fs.readdirSync(base)) {
      const inc = this.load(id);
      if (inc) out.push(inc);
    }
    return out.sort((a, b) => b.first_seen.localeCompare(a.first_seen));
  }

  /** Find an open incident matching a fingerprint inside a time window. */
  findOpenByFingerprint(fingerprint: string, windowSeconds: number): Incident | null {
    const cutoff = Date.now() - windowSeconds * 1000;
    for (const inc of this.list()) {
      if (
        inc.fingerprint === fingerprint &&
        new Date(inc.last_seen).getTime() >= cutoff &&
        !['merged', 'rejected', 'resolved'].includes(inc.status)
      ) {
        return inc;
      }
    }
    return null;
  }

  /** Save free-form artifact next to the incident. */
  writeArtifact(incidentId: string, filename: string, content: string): string {
    const d = this.dir(incidentId);
    fs.mkdirSync(d, { recursive: true });
    const target = path.join(d, filename);
    fs.writeFileSync(target, content);
    return target;
  }
}
