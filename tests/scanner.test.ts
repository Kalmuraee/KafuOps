import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { runScan } from '../src/scanner/memory.js';
import { buildGraph } from '../src/graph/builder.js';

function makeTinyExpressApp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-scan-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'sample-app',
      dependencies: { express: '^4.0.0', stripe: '*', pg: '*' },
      scripts: { test: 'echo no tests' },
    }),
  );
  fs.mkdirSync(path.join(dir, 'src', 'routes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'services'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests', 'payment'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'routes', 'checkout.ts'),
    `import { processPayment } from '../services/payment.js';
const app: any = {};
app.post('/checkout', async (req: any, res: any) => {
  const r = await processPayment(req.body);
  res.json(r);
});
`,
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'services', 'payment.ts'),
    `export async function processPayment(input: any) {
  if (!input.customer.defaultPaymentMethod) throw new TypeError('no payment method');
  return { ok: true };
}
`,
  );
  fs.writeFileSync(
    path.join(dir, 'tests', 'payment', 'payment.test.ts'),
    `import { processPayment } from '../../src/services/payment.js';
test('handles missing method', () => { /* todo */ });
`,
  );
  return dir;
}

describe('Scanner + Graph', () => {
  it('discovers routes, services, tests, dependencies', () => {
    const dir = makeTinyExpressApp();
    const cfg = ConfigSchema.parse({ project: { name: 'sample-app' } });
    const res = runScan(dir, cfg, { write: true });
    expect(res.memory.routes.length).toBeGreaterThan(0);
    expect(res.memory.routes.some((r) => r.method === 'POST' && r.path_pattern === '/checkout')).toBe(true);
    expect(res.memory.tests.length).toBeGreaterThan(0);
    expect(res.memory.dependencies.external_apis).toContain('stripe');
    expect(res.memory.dependencies.databases).toContain('pg');
  });

  it('builds an architecture graph linking route -> handler -> service', () => {
    const dir = makeTinyExpressApp();
    const graph = buildGraph(dir);
    const fileNodes = graph.nodes.filter((n) => n.type === 'file').map((n) => n.label);
    expect(fileNodes).toContain('src/routes/checkout.ts');
    expect(fileNodes).toContain('src/services/payment.ts');
    const routeNodes = graph.nodes.filter((n) => n.type === 'route').map((n) => n.label);
    expect(routeNodes).toContain('POST /checkout');
    // Edge: route handled_by file
    expect(
      graph.edges.some(
        (e) =>
          e.type === 'handled_by' &&
          e.from === 'route:POST /checkout' &&
          e.to === 'file:src/routes/checkout.ts',
      ),
    ).toBe(true);
    // Edge: import from checkout.ts to payment.ts
    expect(
      graph.edges.some(
        (e) =>
          e.type === 'imports' &&
          e.from === 'file:src/routes/checkout.ts' &&
          e.to === 'file:src/services/payment.ts',
      ),
    ).toBe(true);
  });
});
