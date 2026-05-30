import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  compareVersions,
  fetchLatestVersion,
  getPackageVersion,
  installCommand,
  checkForUpdate,
  defaultCacheFile,
  updateChecksEnabled,
  PackageManager,
} from '../../update/checker.js';
import { runShell, tail } from '../../util/shell.js';
import { box, spinner } from '../../util/ui.js';
import { log } from '../../util/logger.js';

/** The lines shown in the "update available" notice. Pure. */
export function updateNoticeLines(current: string, latest: string): string[] {
  return [`KafuOps ${current}  →  ${latest}`, '', 'Update with:  kafuops update'];
}

/**
 * `kafuops update` — check the registry and (by default) run the global install.
 * `--print` only shows the command; `--pm` picks the package manager.
 */
export async function updateCommand(opts: { print?: boolean; pm?: PackageManager } = {}): Promise<void> {
  const current = getPackageVersion();
  const sp = spinner('Checking for the latest version…');
  const latest = await fetchLatestVersion('kafuops');
  if (!latest) {
    sp.fail('Could not reach the npm registry (offline, or package not yet published).');
    return;
  }
  if (compareVersions(latest, current) <= 0) {
    sp.succeed(`KafuOps is up to date (v${current}).`);
    return;
  }
  sp.stop();
  const cmd = installCommand(opts.pm ?? 'npm');
  log.info(`Update available: v${current} → v${latest}`);
  if (opts.print) {
    log.info(`  ${cmd}`);
    return;
  }
  const sp2 = spinner(`Updating with \`${cmd}\`…`);
  const res = await runShell(cmd, { timeoutMs: 180_000 });
  if (res.code === 0) {
    sp2.succeed(`Updated to v${latest}. Run \`kafuops --version\` to confirm.`);
  } else {
    sp2.fail('Update command failed — run it manually:');
    log.info(`  ${cmd}`);
    const detail = tail(res.stderr || res.stdout, 4).trim();
    if (detail) log.dim(detail);
  }
}

/** Hidden `__check-update`: refresh the cache (network) then exit. */
export async function refreshUpdateCache(): Promise<void> {
  try {
    await checkForUpdate({ current: getPackageVersion() });
  } catch {
    // best-effort
  }
}

/**
 * Set up update checking for a normal CLI run: show a notice (from cache) after
 * the command, and refresh the cache in a detached background process when
 * stale. Never blocks the command and never throws.
 */
export function bootstrapUpdateChecks(argv: string[] = process.argv): void {
  if (!updateChecksEnabled() || !process.stdout.isTTY) return;
  if (argv.slice(2)[0] === '__check-update') return; // don't recurse

  const current = getPackageVersion();
  let cache: { checkedAt: number; latest: string | null } | null = null;
  try {
    cache = JSON.parse(fs.readFileSync(defaultCacheFile(), 'utf8'));
  } catch {
    cache = null;
  }

  if (cache?.latest && compareVersions(cache.latest, current) > 0) {
    const latest = cache.latest;
    process.on('exit', () => {
      try {
        console.log('\n' + box('Update available', updateNoticeLines(current, latest)));
      } catch {
        // ignore
      }
    });
  }

  const stale = !cache || Date.now() - cache.checkedAt >= 24 * 3600_000;
  if (stale) {
    try {
      const child = spawn(process.execPath, [argv[1], '__check-update'], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch {
      // ignore — checking is best-effort
    }
  }
}
