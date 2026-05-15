import { minimatch } from 'minimatch';
import { BlastRadius } from '../types/index.js';
import { ArchitectureGraph } from '../graph/builder.js';
import { indexGraph, dependents, GraphIndex } from '../graph/query.js';

export interface BlastRadiusInput {
  filesChanged: string[];
  graph?: ArchitectureGraph | null;
}

export function computeBlastRadius(input: BlastRadiusInput): BlastRadius {
  const changed = input.filesChanged;
  const affected = new Set<string>();
  const externalDeps = new Set<string>();

  let index: GraphIndex | null = null;
  if (input.graph) index = indexGraph(input.graph);
  if (index) {
    for (const f of changed) {
      const id = `file:${f}`;
      if (!index.nodesById.has(id)) continue;
      for (const dep of dependents(index, id, 3)) {
        if (dep.type === 'route') affected.add(`route: ${dep.label}`);
        else if (dep.type === 'file') affected.add(`file: ${dep.label}`);
        else if (dep.type === 'test') affected.add(`test: ${dep.label}`);
      }
      // External package deps for changed files
      for (const e of index.outgoing.get(id) ?? []) {
        if (e.type === 'depends_on') externalDeps.add(e.to.replace(/^package:/, ''));
      }
    }
  } else {
    for (const f of changed) affected.add(`file: ${f}`);
  }

  // Risk classification by file globs
  const highRisk = [
    'src/auth/**',
    'src/security/**',
    'src/payments/**',
    'src/encryption/**',
    'migrations/**',
    'infra/**',
  ];
  const dataImpactGlobs = ['migrations/**', 'prisma/migrations/**', 'db/migrations/**'];
  const touchesHighRisk = changed.some((f) => highRisk.some((g) => minimatch(f, g, { dot: true })));
  const touchesMigrations = changed.some((f) => dataImpactGlobs.some((g) => minimatch(f, g, { dot: true })));

  let risk: BlastRadius['risk_level'] = 'low';
  if (touchesHighRisk || touchesMigrations) risk = 'high';
  if (changed.length > 10) risk = risk === 'low' ? 'medium' : risk;
  if (touchesMigrations && changed.some((f) => /drop|truncate|delete/i.test(f))) risk = 'critical';

  return {
    changed_files: changed,
    potentially_affected: [...affected],
    not_directly_affected: [],
    external_dependencies: [...externalDeps],
    data_impact: touchesMigrations
      ? 'Migration files changed — verify rollback plan and data preservation.'
      : 'No schema change detected.',
    risk_level: risk,
  };
}
