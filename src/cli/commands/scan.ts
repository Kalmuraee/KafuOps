import { loadConfigOrExit } from '../util.js';
import { runScan } from '../../scanner/memory.js';
import { buildGraph, writeGraph } from '../../graph/builder.js';
import { log } from '../../util/logger.js';

export interface ScanOptions {
  full?: boolean;
  memoryOnly?: boolean;
  graphOnly?: boolean;
  write?: boolean;
}

export async function scanCommand(opts: ScanOptions): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  const write = opts.write !== false;

  if (!opts.graphOnly) {
    const result = runScan(rootDir, config, { write });
    log.ok(`Memory: ${result.memory.routes.length} routes, ${result.memory.services.length} services, ${result.memory.tests.length} tests`);
    for (const f of result.written) log.dim(`  wrote ${f}`);
  }

  if (!opts.memoryOnly) {
    const graph = buildGraph(rootDir);
    log.ok(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    if (write) {
      const written = writeGraph(rootDir, graph);
      for (const f of written) log.dim(`  wrote ${f}`);
    }
  }
}
