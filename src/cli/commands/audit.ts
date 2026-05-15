import fs from 'node:fs';
import path from 'node:path';
import { loadConfigOrExit } from '../util.js';
import { getPaths } from '../../util/paths.js';
import { log } from '../../util/logger.js';

export async function auditList(): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const dir = getPaths(rootDir).modelCalls;
  if (!fs.existsSync(dir)) {
    log.info('No model calls recorded.');
    return;
  }
  const files = fs.readdirSync(dir).sort();
  for (const f of files) log.info(f);
}

export async function auditShow(id: string): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const dir = getPaths(rootDir).modelCalls;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const match = files.find((f) => f.includes(id));
  if (!match) {
    log.error(`No audit entry found for ${id}`);
    process.exit(1);
  }
  process.stdout.write(fs.readFileSync(path.join(dir, match), 'utf8'));
}

export async function auditExport(incidentId: string): Promise<void> {
  const { rootDir } = loadConfigOrExit({ allowMissing: true });
  const dir = getPaths(rootDir).modelCalls;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const matches = files.filter((f) => f.includes(incidentId));
  const collected = matches.map((f) => ({
    file: f,
    content: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
  }));
  process.stdout.write(JSON.stringify(collected, null, 2));
}
