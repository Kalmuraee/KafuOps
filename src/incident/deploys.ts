import fs from 'node:fs';
import path from 'node:path';
import { getPaths, ensureDir } from '../util/paths.js';

export interface DeployRecord {
  version: string;
  commit?: string;
  at: string; // ISO timestamp
}

function file(rootDir: string): string {
  return path.join(getPaths(rootDir).base, 'deploys.json');
}

function load(rootDir: string): DeployRecord[] {
  try {
    return JSON.parse(fs.readFileSync(file(rootDir), 'utf8')) as DeployRecord[];
  } catch {
    return [];
  }
}

/** Record a deploy marker (used to correlate later errors as regressions). */
export function recordDeploy(rootDir: string, rec: { version: string; commit?: string; at?: string }): DeployRecord {
  ensureDir(getPaths(rootDir).base);
  const record: DeployRecord = { version: rec.version, commit: rec.commit, at: rec.at ?? new Date().toISOString() };
  const list = load(rootDir);
  list.push(record);
  fs.writeFileSync(file(rootDir), JSON.stringify(list.slice(-100), null, 2));
  return record;
}

/** The most recent deploy within `withinMinutes` of `nowMs`, or null. */
export function recentDeploy(rootDir: string, withinMinutes: number, nowMs = Date.now()): DeployRecord | null {
  const cutoff = nowMs - withinMinutes * 60 * 1000;
  let best: DeployRecord | null = null;
  for (const d of load(rootDir)) {
    const t = new Date(d.at).getTime();
    if (Number.isNaN(t) || t < cutoff || t > nowMs) continue;
    if (!best || t > new Date(best.at).getTime()) best = d;
  }
  return best;
}
