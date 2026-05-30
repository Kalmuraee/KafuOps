import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Compare two semver triples. Ignores a leading `v` and any prerelease suffix. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): number[] =>
    v.trim().replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** The global-install command for a package manager. */
export function installCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm add -g kafuops@latest';
    case 'yarn':
      return 'yarn global add kafuops@latest';
    case 'bun':
      return 'bun add -g kafuops@latest';
    case 'npm':
    default:
      return 'npm install -g kafuops@latest';
  }
}

/** Read the running package's version from package.json (next to dist/). */
export function getPackageVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface FetchOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Fetch the latest published version from the npm registry. Null on any error. */
export async function fetchLatestVersion(pkg: string, opts: FetchOpts = {}): Promise<string | null> {
  const f = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 3000);
  try {
    // NB: do NOT send `application/vnd.npm.install-v1+json` here — the registry
    // returns 406 for that abbreviated-metadata type on the /<pkg>/latest
    // endpoint (it's only valid on the packument root). Default Accept returns
    // the full version document, which carries `.version`.
    const res = await f(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Default location of the per-user update-check cache. */
export function defaultCacheFile(): string {
  return path.join(os.homedir(), '.kafuops', 'update-check.json');
}

export interface UpdateState {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  fromCache: boolean;
}

export interface CheckOpts {
  current: string;
  pkg?: string;
  cacheFile?: string;
  ttlMs?: number;
  now?: number;
  fetchImpl?: typeof fetch;
}

interface CacheData {
  checkedAt: number;
  latest: string | null;
}

function readCache(file: string): CacheData | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as CacheData;
  } catch {
    return null;
  }
}

function writeCache(file: string, data: CacheData): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {
    // best-effort
  }
}

/**
 * Determine whether a newer version is available, using a throttled per-user
 * cache so we hit the registry at most once per `ttlMs`. Never throws.
 */
export async function checkForUpdate(opts: CheckOpts): Promise<UpdateState> {
  const pkg = opts.pkg ?? 'kafuops';
  const cacheFile = opts.cacheFile ?? defaultCacheFile();
  const ttlMs = opts.ttlMs ?? 24 * 3600_000;
  const now = opts.now ?? Date.now();

  const cache = readCache(cacheFile);
  let latest: string | null;
  let fromCache: boolean;
  if (cache && now - cache.checkedAt < ttlMs) {
    latest = cache.latest;
    fromCache = true;
  } else {
    latest = await fetchLatestVersion(pkg, { fetchImpl: opts.fetchImpl });
    fromCache = false;
    if (latest) writeCache(cacheFile, { checkedAt: now, latest });
    else if (cache) latest = cache.latest; // fall back to stale cache on network failure
  }
  return {
    current: opts.current,
    latest,
    updateAvailable: !!latest && compareVersions(latest, opts.current) > 0,
    fromCache,
  };
}

/** Whether update checking is allowed in this environment. */
export function updateChecksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.KAFUOPS_NO_UPDATE_CHECK && !env.CI && env.NODE_ENV !== 'test';
}
