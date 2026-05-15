import fs from 'node:fs';
import path from 'node:path';

export const KAFUOPS_DIR = '.kafuops';

export interface KafuOpsPaths {
  root: string;
  base: string;
  memory: string;
  incidents: string;
  audit: string;
  modelCalls: string;
  sandbox: string;
  policies: string;
  configFile: string;
}

export function getPaths(rootDir: string): KafuOpsPaths {
  const base = path.join(rootDir, KAFUOPS_DIR);
  return {
    root: rootDir,
    base,
    memory: path.join(base, 'memory'),
    incidents: path.join(base, 'incidents'),
    audit: path.join(base, 'audit'),
    modelCalls: path.join(base, 'audit', 'model-calls'),
    sandbox: path.join(base, 'sandbox'),
    policies: path.join(base, 'policies'),
    configFile: path.join(rootDir, '.kafuops.yml'),
  };
}

export function ensureDirs(p: KafuOpsPaths): void {
  for (const dir of [p.base, p.memory, p.incidents, p.audit, p.modelCalls, p.sandbox, p.policies]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
