import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { detectFramework, FrameworkInfo } from '../scanner/framework.js';

export type RepoProvider = 'github' | 'gitlab' | 'none';
export type RuntimeMode = 'wrapper' | 'sidecar' | 'webhook' | 'kubernetes';

export interface Containerization {
  dockerfile: boolean;
  compose: boolean;
  kubernetes: boolean;
}

export interface AiTooling {
  codexCli: boolean;
  claudeCli: boolean;
  openaiKeyEnv: boolean;
  anthropicKeyEnv: boolean;
}

export interface RepoRemote {
  provider: RepoProvider;
  url: string | null;
}

export interface DiscoveryResult {
  framework: FrameworkInfo;
  startCommand: string | null;
  installCommand: string;
  testCommand: string;
  repo: RepoRemote;
  containerization: Containerization;
  suggestedMode: RuntimeMode;
  logFiles: string[];
  tooling: AiTooling;
}

export interface DiscoveryProbes {
  /** Override CLI existence check (default uses `<cmd> --version`). */
  commandExists?: (cmd: string) => boolean;
  /** Override environment (default process.env). */
  env?: NodeJS.ProcessEnv;
}

/** Infer a likely start command from package.json scripts or framework. */
export function inferStartCommand(rootDir: string): string | null {
  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      for (const name of ['start', 'dev', 'serve']) {
        if (scripts[name]) return `npm run ${name}`;
      }
    } catch {
      // ignore
    }
  }
  const fw = detectFramework(rootDir);
  switch (fw.framework) {
    case 'django':
      return 'python manage.py runserver';
    case 'fastapi':
      return 'uvicorn main:app --reload';
    case 'flask':
      return 'flask run';
    default:
      break;
  }
  switch (fw.language) {
    case 'go':
      return 'go run .';
    case 'rust':
      return 'cargo run';
    case 'java':
      return fs.existsSync(path.join(rootDir, 'pom.xml')) ? 'mvn spring-boot:run' : './gradlew bootRun';
    default:
      return null;
  }
}

/** Classify a git remote URL into a known provider. */
export function classifyRemote(url: string): RepoProvider {
  const u = url.toLowerCase();
  if (u.includes('github')) return 'github';
  if (u.includes('gitlab')) return 'gitlab';
  return 'none';
}

/** Read the origin remote and classify it. */
export function detectRepoRemote(rootDir: string): RepoRemote {
  try {
    const res = spawnSync('git', ['-C', rootDir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) {
      const url = res.stdout.trim();
      return { provider: classifyRemote(url), url };
    }
  } catch {
    // ignore
  }
  return { provider: 'none', url: null };
}

export function detectContainerization(rootDir: string): Containerization {
  const exists = (p: string): boolean => fs.existsSync(path.join(rootDir, p));
  const dockerfile = exists('Dockerfile') || exists('dockerfile');
  const compose =
    exists('docker-compose.yml') || exists('docker-compose.yaml') || exists('compose.yml') || exists('compose.yaml');
  // Kubernetes: Helm chart, kustomization, or a conventional manifest dir with yaml.
  let kubernetes = exists('Chart.yaml') || exists('kustomization.yaml') || exists('kustomization.yml');
  if (!kubernetes) {
    for (const dir of ['k8s', 'kubernetes', 'manifests', 'deploy', 'charts', 'helm']) {
      const full = path.join(rootDir, dir);
      try {
        if (fs.existsSync(full) && hasYaml(full)) {
          kubernetes = true;
          break;
        }
      } catch {
        // ignore
      }
    }
  }
  return { dockerfile, compose, kubernetes };
}

function hasYaml(dir: string, depth = 2): boolean {
  if (depth < 0) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile() && /\.(ya?ml)$/i.test(e.name)) return true;
    if (e.isDirectory() && hasYaml(path.join(dir, e.name), depth - 1)) return true;
  }
  return false;
}

/** Suggest a runtime mode from containerization signals. */
export function suggestRuntimeMode(c: Containerization): RuntimeMode {
  if (c.kubernetes) return 'kubernetes';
  if (c.dockerfile || c.compose) return 'sidecar';
  return 'wrapper';
}

/** Find candidate log files at the repo root and in a logs/ directory. */
export function detectLogFiles(rootDir: string, max = 10): string[] {
  const out: string[] = [];
  const scan = (rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(rootDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.isFile() && e.name.toLowerCase().endsWith('.log')) {
        out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  scan('');
  scan('logs');
  scan('log');
  return out;
}

/** Detect locally-available AI tooling: installed CLIs and provider env keys. */
export function detectAiTooling(probes: DiscoveryProbes = {}): AiTooling {
  const env = probes.env ?? process.env;
  const commandExists = probes.commandExists ?? defaultCommandExists;
  return {
    codexCli: commandExists('codex'),
    claudeCli: commandExists('claude'),
    openaiKeyEnv: !!env.OPENAI_API_KEY,
    anthropicKeyEnv: !!env.ANTHROPIC_API_KEY,
  };
}

function defaultCommandExists(cmd: string): boolean {
  try {
    // `--version` is cheap and supported by both codex and claude CLIs.
    return spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}

/** Run the full discovery sweep for the setup wizard. */
export function runDiscovery(rootDir: string, probes: DiscoveryProbes = {}): DiscoveryResult {
  const framework = detectFramework(rootDir);
  const containerization = detectContainerization(rootDir);
  return {
    framework,
    startCommand: inferStartCommand(rootDir),
    installCommand: framework.install_command ?? 'npm ci',
    testCommand: framework.test_command ?? 'npm test',
    repo: detectRepoRemote(rootDir),
    containerization,
    suggestedMode: suggestRuntimeMode(containerization),
    logFiles: detectLogFiles(rootDir),
    tooling: detectAiTooling(probes),
  };
}
