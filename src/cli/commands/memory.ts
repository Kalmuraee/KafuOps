import fs from 'node:fs';
import path from 'node:path';
import { loadConfigOrExit } from '../util.js';
import { runScan } from '../../scanner/memory.js';
import { log } from '../../util/logger.js';

export async function memoryShow(): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const file = path.join(rootDir, '.kafuops', 'memory', 'project.md');
  if (!fs.existsSync(file)) {
    log.warn('No memory found. Run `kafuops scan` first.');
    return;
  }
  process.stdout.write(fs.readFileSync(file, 'utf8'));
}

export async function memoryUpdate(): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  const res = runScan(rootDir, config, { write: true });
  log.ok(`Memory updated: routes=${res.memory.routes.length} services=${res.memory.services.length}`);
}

export async function memoryValidate(): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const file = path.join(rootDir, '.kafuops', 'memory', 'memory.json');
  if (!fs.existsSync(file)) {
    log.error('No memory.json found. Run `kafuops scan`.');
    process.exit(1);
  }
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    log.ok('Memory: structurally valid');
  } catch (err) {
    log.error(`Memory invalid: ${(err as Error).message}`);
    process.exit(2);
  }
}

export async function memoryDiff(): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  const file = path.join(rootDir, '.kafuops', 'memory', 'memory.json');
  const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const after = runScan(rootDir, config, { write: false }).memory;
  if (!before) {
    log.info('No prior memory; everything is new.');
    return;
  }
  const beforeRoutes = new Set<string>(
    (before.routes ?? []).map((r: any) => `${r.method} ${r.path_pattern}`),
  );
  const afterRoutes = new Set<string>(
    after.routes.map((r) => `${r.method} ${r.path_pattern}`),
  );
  const added: string[] = [];
  const removed: string[] = [];
  for (const r of afterRoutes) if (!beforeRoutes.has(r)) added.push(r);
  for (const r of beforeRoutes) if (!afterRoutes.has(r)) removed.push(r);
  log.info(`Route diff: +${added.length} -${removed.length}`);
  for (const a of added) log.ok(`+ ${String(a)}`);
  for (const r of removed) log.warn(`- ${String(r)}`);
}
