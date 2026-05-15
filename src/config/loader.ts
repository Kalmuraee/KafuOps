import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ConfigSchema, KafuOpsConfig } from './schema.js';

export const DEFAULT_CONFIG_FILENAME = '.kafuops.yml';

export interface LoadConfigOptions {
  cwd?: string;
  configPath?: string;
  /** When true, returns defaults if no config file is present. */
  allowMissing?: boolean;
}

export interface LoadedConfig {
  config: KafuOpsConfig;
  configPath: string | null;
  rootDir: string;
}

export function resolveConfigPath(opts: LoadConfigOptions = {}): {
  configPath: string | null;
  rootDir: string;
} {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.configPath) {
    const p = path.isAbsolute(opts.configPath)
      ? opts.configPath
      : path.resolve(cwd, opts.configPath);
    return { configPath: p, rootDir: path.dirname(p) };
  }
  let dir = cwd;
  // Walk up to find .kafuops.yml.
  // Stop at filesystem root or after 8 levels.
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, DEFAULT_CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      return { configPath: candidate, rootDir: dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { configPath: null, rootDir: cwd };
}

export function loadConfig(opts: LoadConfigOptions = {}): LoadedConfig {
  const { configPath, rootDir } = resolveConfigPath(opts);
  if (!configPath) {
    if (opts.allowMissing) {
      return { config: ConfigSchema.parse({ project: { name: path.basename(rootDir) } }), configPath: null, rootDir };
    }
    throw new Error(
      `No ${DEFAULT_CONFIG_FILENAME} found. Run \`kafuops init\` to create one.`,
    );
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${(err as Error).message}`);
  }
  const result = ConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid ${DEFAULT_CONFIG_FILENAME}:\n${issues}`);
  }
  return { config: result.data, configPath, rootDir: path.dirname(configPath) };
}

export function writeConfig(targetPath: string, config: KafuOpsConfig): void {
  const yaml = YAML.stringify(config, { lineWidth: 100 });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, yaml, 'utf8');
}
