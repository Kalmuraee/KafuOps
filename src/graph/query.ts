import fs from 'node:fs';
import path from 'node:path';
import { ArchitectureGraph, GraphEdge, GraphNode } from './builder.js';

export function loadGraph(rootDir: string): ArchitectureGraph | null {
  const file = path.join(rootDir, '.kafuops', 'memory', 'architecture-graph.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ArchitectureGraph;
  } catch {
    return null;
  }
}

export interface GraphIndex {
  nodesById: Map<string, GraphNode>;
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
}

export function indexGraph(graph: ArchitectureGraph): GraphIndex {
  const nodesById = new Map<string, GraphNode>();
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  for (const n of graph.nodes) nodesById.set(n.id, n);
  for (const e of graph.edges) {
    (outgoing.get(e.from) ?? outgoing.set(e.from, []).get(e.from)!).push(e);
    (incoming.get(e.to) ?? incoming.set(e.to, []).get(e.to)!).push(e);
  }
  return { nodesById, outgoing, incoming };
}

/**
 * BFS neighbors from a starting node within `depth` hops. Returns nodes (excluding start)
 * in distance order. Use to find candidate files near a failing file.
 */
export function neighbors(index: GraphIndex, startId: string, depth = 2): GraphNode[] {
  const seen = new Set<string>([startId]);
  const queue: Array<{ id: string; d: number }> = [{ id: startId, d: 0 }];
  const out: GraphNode[] = [];
  while (queue.length) {
    const { id, d } = queue.shift()!;
    if (d >= depth) continue;
    const adj = [...(index.outgoing.get(id) ?? []), ...(index.incoming.get(id) ?? [])];
    for (const e of adj) {
      const next = e.from === id ? e.to : e.from;
      if (seen.has(next)) continue;
      seen.add(next);
      const node = index.nodesById.get(next);
      if (node) out.push(node);
      queue.push({ id: next, d: d + 1 });
    }
  }
  return out;
}

/** Forward-only dependents (incoming edges) used for blast-radius computation. */
export function dependents(index: GraphIndex, fileNodeId: string, depth = 3): GraphNode[] {
  const seen = new Set<string>([fileNodeId]);
  const queue: Array<{ id: string; d: number }> = [{ id: fileNodeId, d: 0 }];
  const out: GraphNode[] = [];
  while (queue.length) {
    const { id, d } = queue.shift()!;
    if (d >= depth) continue;
    const incoming = index.incoming.get(id) ?? [];
    for (const e of incoming) {
      if (e.type !== 'imports' && e.type !== 'handled_by' && e.type !== 'tests') continue;
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      const node = index.nodesById.get(e.from);
      if (node) out.push(node);
      queue.push({ id: e.from, d: d + 1 });
    }
  }
  return out;
}

export function findTestsFor(index: GraphIndex, fileId: string): GraphNode[] {
  const out: GraphNode[] = [];
  for (const e of index.incoming.get(fileId) ?? []) {
    if (e.type === 'tests') {
      const n = index.nodesById.get(e.from);
      if (n) out.push(n);
    }
  }
  return out;
}
