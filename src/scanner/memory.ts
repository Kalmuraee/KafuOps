import fs from 'node:fs';
import path from 'node:path';
import { KafuOpsConfig } from '../config/schema.js';
import { getPaths, ensureDirs } from '../util/paths.js';
import { walkRepo } from './tree.js';
import { detectFramework } from './framework.js';
import { discoverRoutes, RouteInfo } from './routes.js';
import {
  detectDependencies,
  DependencyInfo,
  discoverMigrations,
  discoverServices,
  discoverTests,
  ServiceInfo,
} from './services.js';

export interface ProjectMemory {
  memory_version: 1;
  generated_at: string;
  project: {
    name: string;
    language: string;
    framework: string;
    service_name?: string;
  };
  file_count: number;
  routes: RouteInfo[];
  services: ServiceInfo[];
  tests: string[];
  migrations: string[];
  dependencies: DependencyInfo;
}

export interface ScanResult {
  memory: ProjectMemory;
  written: string[];
}

export function runScan(rootDir: string, config: KafuOpsConfig, opts: { write: boolean } = { write: true }): ScanResult {
  const paths = getPaths(rootDir);
  ensureDirs(paths);

  const entries = walkRepo(rootDir);
  const fwInfo = detectFramework(rootDir);
  const routes = discoverRoutes(rootDir, entries);
  const services = discoverServices(rootDir, entries);
  const tests = discoverTests(entries);
  const migrations = discoverMigrations(entries);

  let pkgJson: Record<string, unknown> | null = null;
  try {
    const raw = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
    pkgJson = JSON.parse(raw);
  } catch {
    pkgJson = null;
  }
  const deps = detectDependencies(rootDir, pkgJson);

  const memory: ProjectMemory = {
    memory_version: 1,
    generated_at: new Date().toISOString(),
    project: {
      name: config.project.name,
      language: config.project.language === 'unknown' ? fwInfo.language : config.project.language,
      framework: config.project.framework === 'unknown' ? fwInfo.framework : config.project.framework,
      service_name: config.project.service_name ?? fwInfo.service_name,
    },
    file_count: entries.filter((e) => !e.isDir).length,
    routes,
    services,
    tests,
    migrations,
    dependencies: deps,
  };

  const written: string[] = [];
  if (opts.write) {
    fs.writeFileSync(path.join(paths.memory, 'memory.json'), JSON.stringify(memory, null, 2));
    written.push(path.join(paths.memory, 'memory.json'));
    written.push(writeMarkdown(paths.memory, memory));
  }
  return { memory, written };
}

function writeMarkdown(memoryDir: string, m: ProjectMemory): string {
  const lines: string[] = [];
  lines.push(`# Project Memory`, '');
  lines.push(`Generated: ${m.generated_at}`, '');
  lines.push(`## Project`, '');
  lines.push(`- Name: ${m.project.name}`);
  lines.push(`- Language: ${m.project.language}`);
  lines.push(`- Framework: ${m.project.framework}`);
  if (m.project.service_name) lines.push(`- Service name: ${m.project.service_name}`);
  lines.push(`- Files indexed: ${m.file_count}`, '');

  lines.push(`## Routes (${m.routes.length})`, '');
  for (const r of m.routes.slice(0, 200)) {
    lines.push(`- ${r.method} ${r.path_pattern} → \`${r.file}\``);
  }
  lines.push('');

  lines.push(`## Services (${m.services.length})`, '');
  const byKind: Record<string, string[]> = {};
  for (const s of m.services) {
    (byKind[s.kind] ||= []).push(`\`${s.file}\``);
  }
  for (const [kind, files] of Object.entries(byKind)) {
    lines.push(`### ${kind}`);
    for (const f of files.slice(0, 100)) lines.push(`- ${f}`);
    lines.push('');
  }

  lines.push(`## Dependencies`, '');
  lines.push(`- External APIs: ${m.dependencies.external_apis.join(', ') || '(none detected)'}`);
  lines.push(`- Databases: ${m.dependencies.databases.join(', ') || '(none detected)'}`);
  lines.push(`- Queues: ${m.dependencies.queues.join(', ') || '(none detected)'}`, '');

  lines.push(`## Tests (${m.tests.length})`, '');
  for (const t of m.tests.slice(0, 100)) lines.push(`- ${t}`);
  if (m.tests.length > 100) lines.push(`- ... and ${m.tests.length - 100} more`);
  lines.push('');

  if (m.migrations.length) {
    lines.push(`## Migrations (${m.migrations.length})`, '');
    for (const t of m.migrations.slice(0, 100)) lines.push(`- ${t}`);
    lines.push('');
  }

  const out = lines.join('\n');
  const file = path.join(memoryDir, 'project.md');
  fs.writeFileSync(file, out);
  return file;
}
