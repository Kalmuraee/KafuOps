import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectDependencies } from '../src/scanner/services.js';

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-pydep-'));
}

describe('Python dependency detection', () => {
  it('parses requirements.txt', () => {
    const dir = tmpRepo();
    fs.writeFileSync(
      path.join(dir, 'requirements.txt'),
      `# comment
fastapi==0.110.0
sqlalchemy>=2.0
stripe ; python_version>='3.10'
celery[redis]==5.4
-r dev-requirements.txt
`,
    );
    const out = detectDependencies(dir, null);
    expect(out.external_apis).toContain('stripe');
    expect(out.databases).toContain('sqlalchemy');
    expect(out.queues).toContain('celery');
  });

  it('parses Poetry pyproject.toml', () => {
    const dir = tmpRepo();
    fs.writeFileSync(
      path.join(dir, 'pyproject.toml'),
      `[tool.poetry]
name = "demo"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.110"
asyncpg = "^0.29"
boto3 = "^1.34"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"
`,
    );
    const out = detectDependencies(dir, null);
    expect(out.databases).toContain('asyncpg');
    expect(out.external_apis).toContain('boto3');
  });

  it('parses PEP 621 pyproject.toml', () => {
    const dir = tmpRepo();
    fs.writeFileSync(
      path.join(dir, 'pyproject.toml'),
      `[project]
name = "demo"
dependencies = ["psycopg2-binary", "redis", "kafka-python", "anthropic"]
`,
    );
    const out = detectDependencies(dir, null);
    expect(out.databases).toContain('psycopg2-binary');
    expect(out.databases).toContain('redis');
    expect(out.queues).toContain('kafka-python');
    expect(out.external_apis).toContain('anthropic');
  });

  it('parses Pipfile', () => {
    const dir = tmpRepo();
    fs.writeFileSync(
      path.join(dir, 'Pipfile'),
      `[packages]
flask = "*"
psycopg2 = "*"
rq = "*"
`,
    );
    const out = detectDependencies(dir, null);
    expect(out.databases).toContain('psycopg2');
    expect(out.queues).toContain('rq');
  });
});
