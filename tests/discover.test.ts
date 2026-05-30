import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inferStartCommand,
  classifyRemote,
  detectContainerization,
  suggestRuntimeMode,
  detectLogFiles,
  detectAiTooling,
  runDiscovery,
} from '../src/wizard/discover.js';

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-disc-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

describe('inferStartCommand', () => {
  it('prefers package.json start, then dev, then serve', () => {
    const dir = tmp({ 'package.json': JSON.stringify({ scripts: { build: 'tsc', dev: 'nodemon', start: 'node .' } }) });
    expect(inferStartCommand(dir)).toBe('npm run start');
    const dir2 = tmp({ 'package.json': JSON.stringify({ scripts: { dev: 'vite', build: 'tsc' } }) });
    expect(inferStartCommand(dir2)).toBe('npm run dev');
  });

  it('suggests a framework-appropriate command for Python', () => {
    const dj = tmp({ 'requirements.txt': 'django\n', 'manage.py': '' });
    expect(inferStartCommand(dj)).toMatch(/manage\.py runserver/);
    const fa = tmp({ 'requirements.txt': 'fastapi\nuvicorn\n' });
    expect(inferStartCommand(fa)).toMatch(/uvicorn/);
  });

  it('returns null when nothing can be inferred', () => {
    const dir = tmp({ 'README.md': '# hi' });
    expect(inferStartCommand(dir)).toBeNull();
  });
});

describe('classifyRemote', () => {
  it('maps hosts to providers', () => {
    expect(classifyRemote('git@github.com:o/r.git')).toBe('github');
    expect(classifyRemote('https://gitlab.example.com/o/r.git')).toBe('gitlab');
    expect(classifyRemote('https://bitbucket.org/o/r.git')).toBe('none');
  });
});

describe('detectContainerization + suggestRuntimeMode', () => {
  it('detects docker and kubernetes signals', () => {
    const d = tmp({ Dockerfile: 'FROM node', 'docker-compose.yml': 'services: {}' });
    const c = detectContainerization(d);
    expect(c.dockerfile).toBe(true);
    expect(c.compose).toBe(true);
    expect(suggestRuntimeMode(c)).toBe('sidecar');

    const k = tmp({ 'deploy/helm/Chart.yaml': 'name: x', Dockerfile: 'FROM node' });
    const ck = detectContainerization(k);
    expect(ck.kubernetes).toBe(true);
    expect(suggestRuntimeMode(ck)).toBe('kubernetes');

    const plain = tmp({ 'index.js': '' });
    expect(suggestRuntimeMode(detectContainerization(plain))).toBe('wrapper');
  });
});

describe('detectLogFiles', () => {
  it('finds .log files at the root and in logs/', () => {
    const dir = tmp({ 'app.log': 'x', 'logs/error.log': 'y', 'src/index.ts': '' });
    const logs = detectLogFiles(dir).map((p) => p.replace(/\\/g, '/'));
    expect(logs).toContain('app.log');
    expect(logs).toContain('logs/error.log');
    expect(logs).not.toContain('src/index.ts');
  });
});

describe('detectAiTooling', () => {
  it('reports installed CLIs and env keys via injected probes', () => {
    const t = detectAiTooling({
      commandExists: (c) => c === 'codex',
      env: { OPENAI_API_KEY: 'x' } as NodeJS.ProcessEnv,
    });
    expect(t.codexCli).toBe(true);
    expect(t.claudeCli).toBe(false);
    expect(t.openaiKeyEnv).toBe(true);
    expect(t.anthropicKeyEnv).toBe(false);
  });
});

describe('runDiscovery', () => {
  it('aggregates a coherent picture of a Node/Express app', () => {
    const dir = tmp({
      'package.json': JSON.stringify({ name: 'svc', dependencies: { express: '^4' }, scripts: { start: 'node server.js' } }),
      Dockerfile: 'FROM node',
      'app.log': 'boot',
    });
    const d = runDiscovery(dir, { commandExists: () => false, env: {} as NodeJS.ProcessEnv });
    expect(d.framework.framework).toBe('express');
    expect(d.startCommand).toBe('npm run start');
    expect(d.suggestedMode).toBe('sidecar');
    expect(d.logFiles).toContain('app.log');
    expect(d.tooling.codexCli).toBe(false);
  });
});
