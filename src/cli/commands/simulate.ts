import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { loadConfigOrExit } from '../util.js';
import { IncidentEngine } from '../../incident/engine.js';
import { RuntimeEvent } from '../../types/index.js';
import { log } from '../../util/logger.js';
import { getPaths } from '../../util/paths.js';

export interface SimulateOptions {
  kind: 'error' | 'alert' | 'crash';
  service?: string;
  severity?: 'critical' | 'high' | 'warn' | 'info' | 'error';
  type?: string;
  count?: number;
}

export async function simulateCommand(opts: SimulateOptions): Promise<void> {
  const { config, rootDir } = loadConfigOrExit({ allowMissing: true });
  const engine = new IncidentEngine(rootDir, config);
  const service = opts.service ?? config.project.service_name ?? config.project.name;
  const count = opts.count ?? 1;
  // If memory exists, use a real file from the scanned repo so the resulting
  // context bundle contains repo content rather than a placeholder.
  const realTarget = pickRealisticTarget(rootDir);

  for (let i = 0; i < count; i++) {
    const ev = mockEvent(opts.kind, service, opts.severity ?? 'error', realTarget);
    const inc = engine.ingest(ev);
    if (inc) {
      log.ok(`Created/updated incident ${inc.id}: ${inc.summary}`);
    } else {
      log.dim(`event ingested (no incident yet, ${i + 1}/${count})`);
    }
  }
}

interface RealisticTarget {
  file: string;
  method: string;
  route: string;
}

function pickRealisticTarget(rootDir: string): RealisticTarget | null {
  const memFile = path.join(getPaths(rootDir).memory, 'memory.json');
  if (!fs.existsSync(memFile)) return null;
  try {
    const mem = JSON.parse(fs.readFileSync(memFile, 'utf8')) as {
      routes?: Array<{ method: string; path_pattern: string; file: string }>;
      services?: Array<{ file: string }>;
    };
    if (mem.routes && mem.routes.length) {
      const r = mem.routes[Math.floor(mem.routes.length / 2)];
      return { file: r.file, method: r.method, route: r.path_pattern };
    }
    if (mem.services && mem.services.length) {
      return { file: mem.services[0].file, method: 'POST', route: '/' };
    }
  } catch {
    // ignore — fall back to default sample
  }
  return null;
}

function mockEvent(
  kind: SimulateOptions['kind'],
  service: string,
  severity: RuntimeEvent['severity'],
  target: RealisticTarget | null,
): RuntimeEvent {
  if (kind === 'crash') {
    return {
      id: `evt_${nanoid(10)}`,
      service,
      environment: 'staging',
      type: 'process_crash',
      severity: 'critical',
      timestamp: new Date().toISOString(),
      message: 'Process exited code=1 signal=SIGTERM',
    };
  }
  const route = target ? `${target.method} ${target.route}` : 'POST /checkout';
  if (kind === 'alert') {
    return {
      id: `evt_${nanoid(10)}`,
      service,
      environment: 'production',
      type: 'alert.webhook',
      severity,
      timestamp: new Date().toISOString(),
      message: 'Simulated alertmanager alert: high error rate',
      attributes: { route },
    };
  }
  const topFile = target?.file ?? 'src/payment/retry.ts';
  const stacktrace = `TypeError: Cannot read properties of undefined
    at handler (${topFile}:42:17)`;
  return {
    id: `evt_${nanoid(10)}`,
    service,
    environment: 'staging',
    type: 'uncaught_exception',
    severity: 'error',
    timestamp: new Date().toISOString(),
    message: 'TypeError: Cannot read properties of undefined',
    stacktrace,
    attributes: {
      route,
      exception_type: 'TypeError',
      top_frame_file: topFile,
      top_frame_line: 42,
      fingerprint: `${service}|${route}|TypeError|${topFile}|Cannot read properties of undefined`,
    },
  };
}
