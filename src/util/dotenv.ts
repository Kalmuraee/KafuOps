import fs from 'node:fs';
import path from 'node:path';
import { getPaths } from './paths.js';

/** Parse a .env file body into key→value. Supports `export`, quotes, comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

/** Apply parsed vars to an env object, never overriding values already set. */
export function applyDotenv(env: Record<string, string | undefined>, vars: Record<string, string>): string[] {
  const applied: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (env[k] === undefined) {
      env[k] = v;
      applied.push(k);
    }
  }
  return applied;
}

/**
 * Load `<rootDir>/.kafuops/.env` (or `$KAFUOPS_ENV_FILE`) into `env`. So the key
 * stored by `kafuops init` "just works" — no manual `export` needed. Existing
 * env always wins. Silent + safe when the file is absent.
 */
export function loadEnvFile(
  rootDir: string,
  env: Record<string, string | undefined> = process.env,
  filePath?: string,
): string[] {
  const file = filePath ?? env.KAFUOPS_ENV_FILE ?? path.join(getPaths(rootDir).base, '.env');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return applyDotenv(env, parseDotenv(text));
}
