import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IncidentStore } from '../src/incident/store.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

function freshStore(): { store: IncidentStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-claim-'));
  ensureDirs(getPaths(dir));
  return { store: new IncidentStore(dir), dir };
}

describe('IncidentStore claim locking', () => {
  it('grants a claim once and refuses a second concurrent claim', () => {
    const { store } = freshStore();
    expect(store.tryClaim('inc_a')).toBe(true);
    expect(store.tryClaim('inc_a')).toBe(false);
  });

  it('allows re-claim after release', () => {
    const { store } = freshStore();
    expect(store.tryClaim('inc_a')).toBe(true);
    store.releaseClaim('inc_a');
    expect(store.tryClaim('inc_a')).toBe(true);
  });

  it('steals a stale lock (crashed worker) past the staleness window', () => {
    const { store, dir } = freshStore();
    expect(store.tryClaim('inc_a')).toBe(true);
    // Backdate the lock file to simulate a crashed holder.
    const lock = path.join(getPaths(dir).incidents, 'inc_a', '.claim.lock');
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(lock, old, old);
    expect(store.tryClaim('inc_a', 1000)).toBe(true); // age 5s > 1s stale window
  });

  it('keeps a fresh lock against an eager re-claim', () => {
    const { store } = freshStore();
    expect(store.tryClaim('inc_a')).toBe(true);
    expect(store.tryClaim('inc_a', 1000)).toBe(false); // fresh lock, not stale
  });
});
