import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  compareVersions,
  installCommand,
  fetchLatestVersion,
  checkForUpdate,
  getPackageVersion,
} from '../src/update/checker.js';
import { updateNoticeLines } from '../src/cli/commands/update.js';

describe('compareVersions', () => {
  it('orders semver triples and ignores a leading v / prerelease', () => {
    expect(compareVersions('0.4.0', '0.3.0')).toBe(1);
    expect(compareVersions('0.3.0', '0.4.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('v1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(0); // prerelease stripped
    expect(compareVersions('0.3.1', '0.3.0')).toBe(1);
  });
});

describe('installCommand', () => {
  it('maps package managers to their global-install command', () => {
    expect(installCommand('npm')).toBe('npm install -g kafuops@latest');
    expect(installCommand('pnpm')).toBe('pnpm add -g kafuops@latest');
    expect(installCommand('yarn')).toBe('yarn global add kafuops@latest');
    expect(installCommand('bun')).toBe('bun add -g kafuops@latest');
    expect(installCommand('whatever' as any)).toContain('npm install -g'); // default
  });
});

describe('getPackageVersion', () => {
  it('reads the running package version', () => {
    expect(getPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('updateNoticeLines', () => {
  it('shows the version jump and the update command', () => {
    const lines = updateNoticeLines('0.3.0', '0.4.0').join('\n');
    expect(lines).toContain('0.3.0');
    expect(lines).toContain('0.4.0');
    expect(lines).toContain('kafuops update');
  });
});

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchLatestVersion', () => {
  it('returns the latest version from the registry', async () => {
    const fetchImpl = (async () => jsonResp({ version: '9.9.9' })) as unknown as typeof fetch;
    expect(await fetchLatestVersion('kafuops', { fetchImpl })).toBe('9.9.9');
  });
  it('returns null on error', async () => {
    const fetchImpl = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchLatestVersion('kafuops', { fetchImpl })).toBeNull();
  });
});

describe('checkForUpdate', () => {
  function tmpCache(): string {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-upd-')), 'update.json');
  }

  it('fetches when there is no cache and reports an available update', async () => {
    const cacheFile = tmpCache();
    let fetched = 0;
    const fetchImpl = (async () => { fetched++; return jsonResp({ version: '0.4.0' }); }) as unknown as typeof fetch;
    const r = await checkForUpdate({ current: '0.3.0', cacheFile, fetchImpl, now: 1000 });
    expect(r.latest).toBe('0.4.0');
    expect(r.updateAvailable).toBe(true);
    expect(fetched).toBe(1);
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).latest).toBe('0.4.0');
  });

  it('uses a fresh cache without hitting the network', async () => {
    const cacheFile = tmpCache();
    fs.writeFileSync(cacheFile, JSON.stringify({ checkedAt: 5000, latest: '0.5.0' }));
    let fetched = 0;
    const fetchImpl = (async () => { fetched++; return jsonResp({ version: '9.9.9' }); }) as unknown as typeof fetch;
    const r = await checkForUpdate({ current: '0.3.0', cacheFile, fetchImpl, now: 5000 + 60_000, ttlMs: 24 * 3600_000 });
    expect(fetched).toBe(0);
    expect(r.latest).toBe('0.5.0');
    expect(r.updateAvailable).toBe(true);
  });

  it('reports no update when current is latest', async () => {
    const cacheFile = tmpCache();
    const fetchImpl = (async () => jsonResp({ version: '0.3.0' })) as unknown as typeof fetch;
    const r = await checkForUpdate({ current: '0.3.0', cacheFile, fetchImpl, now: 1 });
    expect(r.updateAvailable).toBe(false);
  });
});
