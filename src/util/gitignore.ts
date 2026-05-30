import fs from 'node:fs';
import path from 'node:path';

/** KafuOps state that must never be committed (secrets + per-incident artifacts). */
export const KAFUOPS_GITIGNORE_LINES = [
  '.kafuops/.env',
  '.kafuops/incidents/',
  '.kafuops/sandbox/',
  '.kafuops/audit/',
  '.kafuops/deploys.json',
];

/** Append any missing lines under a KafuOps header. Pure. */
export function ensureGitignoreLines(content: string, lines: string[]): string {
  const present = new Set(content.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((l) => !present.has(l));
  if (!missing.length) return content;
  const head = content.trim() ? content.replace(/\s*$/, '') + '\n\n' : '';
  return `${head}# KafuOps (added by kafuops init) — never commit secrets/incident state\n${missing.join('\n')}\n`;
}

/** Ensure the repo's .gitignore covers KafuOps secrets/state. Best-effort. */
export function ensureGitignore(rootDir: string): boolean {
  const file = path.join(rootDir, '.gitignore');
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch {
    // no .gitignore yet
  }
  const updated = ensureGitignoreLines(existing, KAFUOPS_GITIGNORE_LINES);
  if (updated === existing) return false;
  try {
    fs.writeFileSync(file, updated);
    return true;
  } catch {
    return false;
  }
}
