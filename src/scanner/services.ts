import fs from 'node:fs';
import path from 'node:path';
import { FileEntry, filterFiles, readSafe } from './tree.js';

export interface ServiceInfo {
  name: string;
  file: string;
  kind: 'service' | 'repository' | 'controller' | 'job' | 'consumer' | 'client';
}

export interface DependencyInfo {
  external_apis: string[]; // package names like 'stripe', 'axios', 'aws-sdk'
  databases: string[]; // pg, mysql, mongodb, prisma, sequelize, etc.
  queues: string[]; // bull, bullmq, kafka, sqs, rabbitmq
}

const EXTERNAL_API_PACKAGES = [
  'stripe', 'twilio', 'sendgrid', 'mailgun', 'aws-sdk', '@aws-sdk', 'openai',
  'octokit', '@octokit', 'paypal', 'plaid', 'algolia', 'firebase', 'segment',
];
const DB_PACKAGES = [
  'pg', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'prisma', '@prisma/client',
  'sequelize', 'typeorm', 'knex', 'drizzle-orm', 'sqlite3', 'better-sqlite3',
];
const QUEUE_PACKAGES = [
  'bull', 'bullmq', 'kafkajs', '@aws-sdk/client-sqs', 'amqplib', 'nats',
  'sqs-consumer', 'rabbitmq',
];

const PY_EXTERNAL_API_PACKAGES = [
  'stripe', 'twilio', 'sendgrid', 'mailgun', 'boto3', 'botocore', 'openai',
  'anthropic', 'google-cloud-storage', 'google-cloud-bigquery', 'requests',
  'httpx', 'aiohttp',
];
const PY_DB_PACKAGES = [
  'psycopg', 'psycopg2', 'psycopg2-binary', 'asyncpg', 'sqlalchemy', 'alembic',
  'tortoise-orm', 'peewee', 'pymongo', 'motor', 'redis', 'aioredis',
  'mysqlclient', 'pymysql', 'aiomysql', 'pyodbc',
];
const PY_QUEUE_PACKAGES = [
  'celery', 'kombu', 'pika', 'kafka-python', 'aiokafka', 'confluent-kafka',
  'rq', 'dramatiq', 'huey', 'arq',
];

export function discoverServices(rootDir: string, entries: FileEntry[]): ServiceInfo[] {
  const out: ServiceInfo[] = [];
  const files = filterFiles(entries, ['.ts', '.tsx', '.js', '.mjs', '.py']);
  for (const f of files) {
    const isPy = f.path.toLowerCase().endsWith('.py');
    if (isPy && isPythonTestPath(f.path)) continue;
    const name = path.basename(f.path).toLowerCase();
    const dir = path.dirname(f.path).toLowerCase();
    let kind: ServiceInfo['kind'] | null = classifyByPath(name, dir);
    // Python: also classify by class declarations (class FooService / FooRepository).
    if (!kind && isPy) {
      const src = readSafe(path.join(rootDir, f.path));
      if (src) {
        if (/class\s+\w*Service\b/.test(src)) kind = 'service';
        else if (/class\s+\w*(Repository|Repo)\b/.test(src)) kind = 'repository';
        else if (/class\s+\w*Controller\b/.test(src)) kind = 'controller';
        else if (/class\s+\w*(Worker|Consumer)\b/.test(src)) kind = 'consumer';
        else if (/class\s+\w*Client\b/.test(src)) kind = 'client';
      }
    }
    if (kind) {
      out.push({ name: path.basename(f.path, path.extname(f.path)), file: f.path, kind });
    }
  }
  return out;
}

function classifyByPath(name: string, dir: string): ServiceInfo['kind'] | null {
  if (name.includes('controller') || dir.includes('controllers') || dir.includes('routes')) return 'controller';
  if (name.includes('service') || dir.includes('services')) return 'service';
  if (name.includes('repository') || name.includes('repo') || dir.includes('repositories')) return 'repository';
  if (name.includes('worker') || name.includes('consumer') || dir.includes('workers') || dir.includes('consumers')) return 'consumer';
  if (name.includes('client') || dir.includes('clients')) return 'client';
  if (name.includes('job') || dir.includes('jobs') || dir.includes('cron')) return 'job';
  return null;
}

function isPythonTestPath(file: string): boolean {
  const lower = file.replace(/\\/g, '/').toLowerCase();
  if (lower.startsWith('tests/') || lower.includes('/tests/') || lower.startsWith('test/') || lower.includes('/test/')) {
    return true;
  }
  const base = lower.split('/').pop() ?? '';
  return base.startsWith('test_') || base.endsWith('_test.py');
}

export function detectDependencies(rootDir: string, pkgJson: Record<string, unknown> | null): DependencyInfo {
  const out: DependencyInfo = { external_apis: [], databases: [], queues: [] };

  // Node / TypeScript projects.
  if (pkgJson) {
    const deps = {
      ...((pkgJson.dependencies as Record<string, string>) ?? {}),
      ...((pkgJson.devDependencies as Record<string, string>) ?? {}),
    };
    const has = (target: string): boolean =>
      Object.keys(deps).some((d) => d === target || d.startsWith(target + '/'));
    for (const p of EXTERNAL_API_PACKAGES) if (has(p)) out.external_apis.push(p);
    for (const p of DB_PACKAGES) if (has(p)) out.databases.push(p);
    for (const p of QUEUE_PACKAGES) if (has(p)) out.queues.push(p);
  }

  // Python projects: requirements.txt, pyproject.toml (PEP 621 + Poetry), Pipfile.
  const pyDeps = collectPythonDeps(rootDir);
  if (pyDeps.size) {
    const has = (target: string): boolean => pyDeps.has(target.toLowerCase());
    for (const p of PY_EXTERNAL_API_PACKAGES) if (has(p) && !out.external_apis.includes(p)) out.external_apis.push(p);
    for (const p of PY_DB_PACKAGES) if (has(p) && !out.databases.includes(p)) out.databases.push(p);
    for (const p of PY_QUEUE_PACKAGES) if (has(p) && !out.queues.includes(p)) out.queues.push(p);
  }
  return out;
}

/**
 * Collect a flat lower-cased set of Python package names declared in this repo.
 * Parsing is intentionally lenient — we only need the package name, not exact versions.
 */
function collectPythonDeps(rootDir: string): Set<string> {
  const out = new Set<string>();
  // requirements.txt at the root, plus a `requirements/` directory which is the
  // common pattern (heroku/dev/prod split). Follow `-r path/to/other.txt` includes
  // up to a small recursion depth so loops can't cause infinite work.
  const seen = new Set<string>();
  const ingest = (file: string, depth: number): void => {
    if (depth > 4) return;
    const abs = path.resolve(rootDir, file);
    if (seen.has(abs) || !fs.existsSync(abs)) return;
    seen.add(abs);
    let lines: string[];
    try {
      lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    } catch {
      return;
    }
    for (const raw of lines) {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) continue;
      const incMatch = /^-r\s+(.+)$/.exec(line);
      if (incMatch) {
        const includedRel = path.resolve(path.dirname(abs), incMatch[1].trim());
        ingest(path.relative(rootDir, includedRel), depth + 1);
        continue;
      }
      if (line.startsWith('-')) continue;
      const m = /^([A-Za-z0-9._-]+)/.exec(line);
      if (m) out.add(m[1].toLowerCase());
    }
  };

  // Top-level requirements*.txt files.
  let topLevel: string[] = [];
  try {
    topLevel = fs.readdirSync(rootDir).filter(
      (f) => /^requirements[^/]*\.txt$/i.test(f) || f === 'requirements.in',
    );
  } catch {
    // ignore
  }
  for (const f of topLevel) ingest(f, 0);

  // Common nested layout: requirements/<env>.txt
  const reqDir = path.join(rootDir, 'requirements');
  if (fs.existsSync(reqDir)) {
    try {
      for (const f of fs.readdirSync(reqDir)) {
        if (f.endsWith('.txt')) ingest(path.join('requirements', f), 0);
      }
    } catch {
      // ignore
    }
  }
  // pyproject.toml — PEP 621 dependencies and Poetry-style [tool.poetry.dependencies].
  const pyproject = path.join(rootDir, 'pyproject.toml');
  if (fs.existsSync(pyproject)) {
    try {
      const text = fs.readFileSync(pyproject, 'utf8');
      // PEP 621: dependencies = ["fastapi", "sqlalchemy>=2.0"]
      for (const m of text.matchAll(/dependencies\s*=\s*\[([\s\S]*?)\]/g)) {
        for (const entry of m[1].matchAll(/['"]([A-Za-z0-9._-]+)/g)) {
          out.add(entry[1].toLowerCase());
        }
      }
      // Poetry: [tool.poetry.dependencies]\nfastapi = "*"\npg = ...
      const poetrySection = /\[tool\.poetry\.(?:dev-?|group\.[^\]]+\.)?dependencies\]([\s\S]*?)(?:\n\[|$)/g;
      for (const sec of text.matchAll(poetrySection)) {
        for (const line of sec[1].split(/\r?\n/)) {
          const m = /^\s*([A-Za-z0-9._-]+)\s*=/.exec(line);
          if (m && m[1].toLowerCase() !== 'python') out.add(m[1].toLowerCase());
        }
      }
    } catch {
      // ignore
    }
  }
  // Pipfile
  const pipfile = path.join(rootDir, 'Pipfile');
  if (fs.existsSync(pipfile)) {
    try {
      const text = fs.readFileSync(pipfile, 'utf8');
      const section = /\[(?:dev-)?packages\]([\s\S]*?)(?:\n\[|$)/g;
      for (const sec of text.matchAll(section)) {
        for (const line of sec[1].split(/\r?\n/)) {
          const m = /^\s*([A-Za-z0-9._-]+)\s*=/.exec(line);
          if (m) out.add(m[1].toLowerCase());
        }
      }
    } catch {
      // ignore
    }
  }
  return out;
}

export function discoverTests(entries: FileEntry[]): string[] {
  return entries
    .filter((e) => !e.isDir)
    .filter((e) => {
      const lower = e.path.replace(/\\/g, '/').toLowerCase();
      const base = lower.split('/').pop() ?? '';
      return (
        lower.startsWith('test/') ||
        lower.startsWith('tests/') ||
        lower.includes('/test/') ||
        lower.includes('/tests/') ||
        lower.includes('/__tests__/') ||
        lower.endsWith('.test.ts') ||
        lower.endsWith('.test.tsx') ||
        lower.endsWith('.test.js') ||
        lower.endsWith('.spec.ts') ||
        lower.endsWith('.spec.tsx') ||
        lower.endsWith('.spec.js') ||
        // pytest convention: test_*.py or *_test.py
        (base.startsWith('test_') && base.endsWith('.py')) ||
        lower.endsWith('_test.py') ||
        lower.endsWith('_test.go')
      );
    })
    .map((e) => e.path);
}

export function discoverMigrations(entries: FileEntry[]): string[] {
  return entries
    .filter((e) => !e.isDir)
    .filter((e) => {
      const p = e.path.toLowerCase();
      return p.includes('/migrations/') || p.includes('/prisma/migrations/') || p.includes('/db/migrations/');
    })
    .map((e) => e.path);
}
