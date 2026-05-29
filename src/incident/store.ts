import fs from 'node:fs';
import path from 'node:path';
import { Incident, LogExcerpt } from '../types/index.js';
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

  /**
   * Find prior incidents similar to the given one — same fingerprint (a
   * recurrence) or same top stack frame / exception type (a likely relative).
   * Excludes the incident itself. Most-recent first, capped at `limit`. Used to
   * give the model awareness of recurring failures and past fixes.
   */
  findRelated(incident: Incident, limit = 5): Incident[] {
    return this.list()
      .filter((i) => i.id !== incident.id)
      .filter(
        (i) =>
          i.fingerprint === incident.fingerprint ||
          (!!incident.top_frame_file && i.top_frame_file === incident.top_frame_file) ||
          (!!incident.exception_type && i.exception_type === incident.exception_type),
      )
      .slice(0, limit);
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

  /**
   * Persist the rolling-log excerpt captured around an incident. This is how
   * the ring buffer (which is in-memory and dies with the wrapper/agent
   * process) reaches the context builder later, even across process restarts.
   */
  saveLogs(incidentId: string, logs: LogExcerpt[]): string {
    return this.writeArtifact(incidentId, 'runtime-logs.json', JSON.stringify(logs, null, 2));
  }

  loadLogs(incidentId: string): LogExcerpt[] | null {
    const file = path.join(this.dir(incidentId), 'runtime-logs.json');
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as LogExcerpt[];
    } catch {
      return null;
    }
  }

  /**
   * Atomically claim an incident for processing so concurrent workers don't
   * double-process it. Uses an exclusive-create lock file (`wx`), which is atomic
   * on a local filesystem. A lock older than `staleMs` (default 30 min) is
   * treated as abandoned (crashed worker) and stolen. Returns true if claimed.
   */
  tryClaim(incidentId: string, staleMs = 30 * 60 * 1000): boolean {
    const d = this.dir(incidentId);
    fs.mkdirSync(d, { recursive: true });
    const lock = path.join(d, '.claim.lock');
    const write = (): boolean => {
      try {
        const fd = fs.openSync(lock, 'wx');
        fs.writeSync(fd, new Date().toISOString());
        fs.closeSync(fd);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw err;
      }
    };
    if (write()) return true;
    // Lock exists — steal it only if it is stale.
    try {
      const age = Date.now() - fs.statSync(lock).mtimeMs;
      if (age > staleMs) {
        fs.rmSync(lock, { force: true });
        return write(); // may still lose a race with another stealer → false
      }
    } catch {
      // Lock vanished underneath us; fall through to a best-effort claim.
      return write();
    }
    return false;
  }

  releaseClaim(incidentId: string): void {
    try {
      fs.rmSync(path.join(this.dir(incidentId), '.claim.lock'), { force: true });
    } catch {
      // best-effort
    }
  }

  /** Persist the files a patch actually changed (used by `policies explain --incident`). */
  saveChangedFiles(incidentId: string, files: string[]): string {
    return this.writeArtifact(incidentId, 'changed-files.json', JSON.stringify(files, null, 2));
  }

  loadChangedFiles(incidentId: string): string[] | null {
    const file = path.join(this.dir(incidentId), 'changed-files.json');
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as string[];
    } catch {
      return null;
    }
  }
}
