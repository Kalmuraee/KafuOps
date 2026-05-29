import path from 'node:path';
import { FileEntry, filterFiles, readSafe } from './tree.js';

export interface RouteInfo {
  method: string;
  path_pattern: string;
  handler: string; // file:symbol if discoverable, otherwise just file
  file: string;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

// app.get('/path', handler) | router.post("/path", ...) | fastify.route({ method, url })
const EXPRESS_LIKE = new RegExp(
  String.raw`\b(?:app|router|server|fastify)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*['"\`]([^'"\`]+)['"\`]`,
  'gi',
);

// Nest: @Get('/path'), @Post('foo'), @Get() (no path arg → defaults to '/')
const NEST_DECORATOR = /@(Get|Post|Put|Patch|Delete|Options|Head|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;

// FastAPI / Flask. Flask blueprints can be named anything (auth, main, api, ...)
// so we accept @<identifier>.route(...) and @<identifier>.<method>(...).
const PY_FASTAPI = /@\w[\w.]*\.(get|post|put|patch|delete|options|head)\(\s*['"]([^'"]+)['"]/g;
const PY_FLASK = /@\w[\w.]*\.route\(\s*['"]([^'"]+)['"](?:.*?methods\s*=\s*\[([^\]]*)\])?/g;

// Go: gin/echo/chi method calls (r.GET / r.Get / e.POST …). Case-insensitive.
const GO_METHOD = /\b\w+\.(get|post|put|patch|delete|head|options)\(\s*"([^"]+)"/gi;
// Go net/http (and Go 1.22 mux) HandleFunc; pattern may embed a method: "GET /path".
const GO_HANDLEFUNC = /\b\w+\.HandleFunc\(\s*"(?:([A-Z]+)\s+)?([^"]+)"/g;

// Java Spring: @GetMapping("/x"), @PostMapping(value="/x"), @RequestMapping("/x").
const JAVA_MAPPING = /@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
const JAVA_REQUESTMAPPING = /@RequestMapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;

// Rust: actix/rocket attribute macros (#[get("/x")]) and axum .route("/x", get(h)).
const RUST_ATTR = /#\[(get|post|put|patch|delete|head|options)\(\s*"([^"]+)"/gi;
const RUST_AXUM = /\.route\(\s*"([^"]+)"\s*,\s*(get|post|put|patch|delete)\(/gi;

export function discoverRoutes(rootDir: string, entries: FileEntry[]): RouteInfo[] {
  const out: RouteInfo[] = [];
  const tsJs = filterFiles(entries, ['.ts', '.tsx', '.js', '.mjs', '.cjs']);
  for (const f of tsJs) {
    const src = readSafe(path.join(rootDir, f.path));
    if (!src) continue;
    // Express-like
    for (const m of src.matchAll(EXPRESS_LIKE)) {
      out.push({
        method: m[1].toUpperCase(),
        path_pattern: m[2],
        handler: f.path,
        file: f.path,
      });
    }
    // Nest decorators
    for (const m of src.matchAll(NEST_DECORATOR)) {
      out.push({
        method: m[1].toUpperCase(),
        path_pattern: m[2] && m[2].length ? m[2] : '/',
        handler: f.path,
        file: f.path,
      });
    }
  }
  const py = filterFiles(entries, ['.py']);
  for (const f of py) {
    // Skip test files — pytest "@app.get(...)" patterns inside tests are not routes.
    if (isPythonTestPath(f.path)) continue;
    const src = readSafe(path.join(rootDir, f.path));
    if (!src) continue;
    for (const m of src.matchAll(PY_FASTAPI)) {
      out.push({
        method: m[1].toUpperCase(),
        path_pattern: m[2],
        handler: f.path,
        file: f.path,
      });
    }
    for (const m of src.matchAll(PY_FLASK)) {
      const methods = m[2] ? m[2].split(',').map((s) => s.trim().replace(/['"]/g, '').toUpperCase()) : ['GET'];
      for (const method of methods) {
        if (!HTTP_METHODS.includes(method.toLowerCase()) && method !== '') continue;
        out.push({
          method: method || 'GET',
          path_pattern: m[1],
          handler: f.path,
          file: f.path,
        });
      }
    }
  }
  // Go
  for (const f of filterFiles(entries, ['.go'])) {
    if (f.path.toLowerCase().endsWith('_test.go')) continue;
    const src = readSafe(path.join(rootDir, f.path));
    if (!src) continue;
    for (const m of src.matchAll(GO_METHOD)) {
      out.push({ method: m[1].toUpperCase(), path_pattern: m[2], handler: f.path, file: f.path });
    }
    for (const m of src.matchAll(GO_HANDLEFUNC)) {
      out.push({ method: (m[1] ?? 'ANY').toUpperCase(), path_pattern: m[2], handler: f.path, file: f.path });
    }
  }

  // Java (Spring)
  for (const f of filterFiles(entries, ['.java'])) {
    const src = readSafe(path.join(rootDir, f.path));
    if (!src) continue;
    for (const m of src.matchAll(JAVA_MAPPING)) {
      out.push({ method: m[1].toUpperCase(), path_pattern: m[2], handler: f.path, file: f.path });
    }
    for (const m of src.matchAll(JAVA_REQUESTMAPPING)) {
      out.push({ method: 'ANY', path_pattern: m[1], handler: f.path, file: f.path });
    }
  }

  // Rust (actix/rocket/axum)
  for (const f of filterFiles(entries, ['.rs'])) {
    const src = readSafe(path.join(rootDir, f.path));
    if (!src) continue;
    for (const m of src.matchAll(RUST_ATTR)) {
      out.push({ method: m[1].toUpperCase(), path_pattern: m[2], handler: f.path, file: f.path });
    }
    for (const m of src.matchAll(RUST_AXUM)) {
      out.push({ method: m[2].toUpperCase(), path_pattern: m[1], handler: f.path, file: f.path });
    }
  }

  // Dedup
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.method} ${r.path_pattern} ${r.file}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function isPythonTestPath(file: string): boolean {
  const lower = file.replace(/\\/g, '/').toLowerCase();
  if (lower.startsWith('tests/') || lower.includes('/tests/') || lower.startsWith('test/') || lower.includes('/test/')) {
    return true;
  }
  const base = lower.split('/').pop() ?? '';
  return base.startsWith('test_') || base.endsWith('_test.py');
}
