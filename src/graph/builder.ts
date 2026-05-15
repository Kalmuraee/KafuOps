import fs from 'node:fs';
import path from 'node:path';
import { walkRepo, filterFiles, readSafe, FileEntry } from '../scanner/tree.js';
import { discoverRoutes, RouteInfo } from '../scanner/routes.js';

export type NodeType = 'file' | 'route' | 'package' | 'test';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  meta?: Record<string, unknown>;
}

export type EdgeType = 'imports' | 'handled_by' | 'tests' | 'depends_on';

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface ArchitectureGraph {
  generated_at: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const IMPORT_REGEX = /^\s*(?:import\s+[^'"]*from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|const\s+\w+\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\))/gm;
const PY_IMPORT = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;

export function buildGraph(rootDir: string): ArchitectureGraph {
  const entries = walkRepo(rootDir);
  return buildGraphFromEntries(rootDir, entries);
}

export function buildGraphFromEntries(rootDir: string, entries: FileEntry[]): ArchitectureGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // File nodes
  const codeFiles = filterFiles(entries, ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.go', '.java']);
  for (const f of codeFiles) {
    const id = `file:${f.path}`;
    nodes.set(id, { id, type: 'file', label: f.path });
  }
  for (const e of entries.filter((x) => !x.isDir && (x.path.toLowerCase().endsWith('.test.ts') || x.path.toLowerCase().endsWith('.test.js') || x.path.toLowerCase().endsWith('.spec.ts') || x.path.toLowerCase().endsWith('_test.py') || x.path.toLowerCase().endsWith('.spec.js')))) {
    const id = `test:${e.path}`;
    nodes.set(id, { id, type: 'test', label: e.path });
  }

  // Routes
  const routes = discoverRoutes(rootDir, entries);
  for (const r of routes) {
    const rid = `route:${r.method} ${r.path_pattern}`;
    nodes.set(rid, { id: rid, type: 'route', label: `${r.method} ${r.path_pattern}` });
    const fid = `file:${r.file}`;
    if (nodes.has(fid)) edges.push({ from: rid, to: fid, type: 'handled_by' });
  }

  // Imports — resolve relative paths to known file nodes
  for (const f of codeFiles) {
    const fullPath = path.join(rootDir, f.path);
    const src = readSafe(fullPath);
    if (!src) continue;
    const fromId = `file:${f.path}`;
    if (f.path.endsWith('.py')) {
      for (const m of src.matchAll(PY_IMPORT)) {
        const mod = (m[1] || m[2] || '').trim();
        if (!mod || mod.startsWith('_')) continue;
        // Try to resolve module path within repo
        const candidate = mod.replace(/\./g, '/') + '.py';
        const target = entries.find((e) => !e.isDir && e.path === candidate);
        if (target) {
          edges.push({ from: fromId, to: `file:${target.path}`, type: 'imports' });
        } else {
          // External package node
          const pkgId = `package:${mod.split('.')[0]}`;
          if (!nodes.has(pkgId)) nodes.set(pkgId, { id: pkgId, type: 'package', label: mod.split('.')[0] });
          edges.push({ from: fromId, to: pkgId, type: 'depends_on' });
        }
      }
      continue;
    }
    for (const m of src.matchAll(IMPORT_REGEX)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(rootDir, f.path, spec, entries);
        if (resolved) edges.push({ from: fromId, to: `file:${resolved}`, type: 'imports' });
      } else {
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        const pkgId = `package:${pkg}`;
        if (!nodes.has(pkgId)) nodes.set(pkgId, { id: pkgId, type: 'package', label: pkg });
        edges.push({ from: fromId, to: pkgId, type: 'depends_on' });
      }
    }
  }

  // Tests → source: a `tests/foo.test.ts` is heuristically linked to `src/foo.ts`-like paths via imports already.
  // Add explicit edges when a test imports a file.
  for (const e of [...nodes.values()].filter((n) => n.type === 'test')) {
    const testFile = e.label;
    const src = readSafe(path.join(rootDir, testFile));
    if (!src) continue;
    for (const m of src.matchAll(IMPORT_REGEX)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec || !spec.startsWith('.')) continue;
      const resolved = resolveRelative(rootDir, testFile, spec, entries);
      if (resolved) edges.push({ from: e.id, to: `file:${resolved}`, type: 'tests' });
    }
  }

  // Deduplicate edges
  const seen = new Set<string>();
  const deduped = edges.filter((e) => {
    const k = `${e.from}|${e.to}|${e.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    generated_at: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges: deduped,
  };
}

const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];

function resolveRelative(rootDir: string, fromFile: string, spec: string, entries: FileEntry[]): string | null {
  const fromDir = path.dirname(fromFile);
  const baseRel = path.normalize(path.join(fromDir, spec));
  // Try direct file
  const direct = entries.find((e) => !e.isDir && e.path === baseRel);
  if (direct) return direct.path;
  // If the spec ended in .js / .mjs / .cjs (NodeNext convention), also try TS extensions on the same stem.
  const stripped = baseRel.replace(/\.(js|mjs|cjs)$/, '');
  if (stripped !== baseRel) {
    for (const ext of TS_EXTS) {
      const candidate = stripped + ext;
      const hit = entries.find((e) => !e.isDir && e.path === candidate);
      if (hit) return hit.path;
    }
  }
  // Try with extensions
  for (const ext of TS_EXTS) {
    const candidate = baseRel + ext;
    const hit = entries.find((e) => !e.isDir && e.path === candidate);
    if (hit) return hit.path;
  }
  // Try as index file
  for (const ext of TS_EXTS) {
    const candidate = path.join(baseRel, `index${ext}`);
    const hit = entries.find((e) => !e.isDir && e.path === candidate);
    if (hit) return hit.path;
  }
  return null;
}

export function writeGraph(rootDir: string, graph: ArchitectureGraph): string[] {
  const dir = path.join(rootDir, '.kafuops', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'architecture-graph.json');
  fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2));
  const md = renderMarkdown(graph);
  const mdPath = path.join(dir, 'architecture-graph.md');
  fs.writeFileSync(mdPath, md);
  return [jsonPath, mdPath];
}

function renderMarkdown(graph: ArchitectureGraph): string {
  const lines: string[] = [];
  lines.push(`# Architecture Graph`, '');
  lines.push(`Generated: ${graph.generated_at}`, '');
  const routes = graph.nodes.filter((n) => n.type === 'route');
  const files = graph.nodes.filter((n) => n.type === 'file');
  const packages = graph.nodes.filter((n) => n.type === 'package');
  lines.push(`Nodes: ${graph.nodes.length} (files=${files.length}, routes=${routes.length}, packages=${packages.length})`);
  lines.push(`Edges: ${graph.edges.length}`, '');
  lines.push(`## Routes`, '');
  for (const r of routes) lines.push(`- ${r.label}`);
  return lines.join('\n');
}
