import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_IGNORES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.kafuops',
  'venv',
  '.venv',
  '__pycache__',
  '.gradle',
  'target',
  'out',
]);

export interface FileEntry {
  path: string; // repo-relative
  size: number;
  isDir: boolean;
}

export function walkRepo(rootDir: string, maxFiles = 20000): FileEntry[] {
  const out: FileEntry[] = [];
  const stack: string[] = [rootDir];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && DEFAULT_IGNORES.has(e.name)) continue;
      if (DEFAULT_IGNORES.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(rootDir, full);
      if (e.isDirectory()) {
        out.push({ path: rel, size: 0, isDir: true });
        stack.push(full);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          // ignore
        }
        out.push({ path: rel, size, isDir: false });
      }
    }
  }
  return out;
}

export function filterFiles(entries: FileEntry[], exts: string[]): FileEntry[] {
  const set = new Set(exts.map((e) => e.toLowerCase()));
  return entries.filter((e) => !e.isDir && set.has(path.extname(e.path).toLowerCase()));
}

export function readSafe(file: string, maxBytes = 1024 * 256): string | null {
  try {
    const stat = fs.statSync(file);
    if (stat.size > maxBytes * 4) {
      // skip very large files
      return null;
    }
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
