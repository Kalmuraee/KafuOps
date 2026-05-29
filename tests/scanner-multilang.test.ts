import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkRepo } from '../src/scanner/tree.js';
import { discoverRoutes } from '../src/scanner/routes.js';
import { discoverServices } from '../src/scanner/services.js';
import { buildGraph, writeGraph } from '../src/graph/builder.js';

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-ml-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function routesOf(dir: string) {
  return discoverRoutes(dir, walkRepo(dir));
}

describe('Go route discovery', () => {
  it('finds gin/echo method routes and net/http HandleFunc routes', () => {
    const dir = tmp({
      'main.go': `package main
import "github.com/gin-gonic/gin"
func main() {
  r := gin.Default()
  r.GET("/users", listUsers)
  r.POST("/users", createUser)
  mux.HandleFunc("/health", healthz)
  mux.HandleFunc("GET /metrics", metrics)
}
`,
    });
    const routes = routesOf(dir);
    expect(routes.some((r) => r.method === 'GET' && r.path_pattern === '/users')).toBe(true);
    expect(routes.some((r) => r.method === 'POST' && r.path_pattern === '/users')).toBe(true);
    expect(routes.some((r) => r.path_pattern === '/health')).toBe(true);
    expect(routes.some((r) => r.method === 'GET' && r.path_pattern === '/metrics')).toBe(true);
  });
});

describe('Java Spring route discovery', () => {
  it('finds @GetMapping/@PostMapping/@RequestMapping', () => {
    const dir = tmp({
      'src/main/java/Controller.java': `package x;
@RestController
public class C {
  @GetMapping("/api/items")
  public String items() { return ""; }
  @PostMapping(value = "/api/items")
  public void create() {}
  @RequestMapping("/legacy")
  public void legacy() {}
}
`,
    });
    const routes = routesOf(dir);
    expect(routes.some((r) => r.method === 'GET' && r.path_pattern === '/api/items')).toBe(true);
    expect(routes.some((r) => r.method === 'POST' && r.path_pattern === '/api/items')).toBe(true);
    expect(routes.some((r) => r.path_pattern === '/legacy')).toBe(true);
  });
});

describe('Rust route discovery', () => {
  it('finds actix/rocket attribute macros and axum .route()', () => {
    const dir = tmp({
      'src/main.rs': `
#[get("/ping")]
async fn ping() -> &'static str { "pong" }

fn app() -> Router {
  Router::new().route("/health", get(health_handler))
}
`,
    });
    const routes = routesOf(dir);
    expect(routes.some((r) => r.method === 'GET' && r.path_pattern === '/ping')).toBe(true);
    expect(routes.some((r) => r.method === 'GET' && r.path_pattern === '/health')).toBe(true);
  });
});

describe('Python service discovery', () => {
  it('discovers Python service/repository classes', () => {
    const dir = tmp({
      'app/services/payment_service.py': `class PaymentService:\n    def charge(self): ...\n`,
      'app/repositories/user_repo.py': `class UserRepository:\n    pass\n`,
    });
    const services = discoverServices(dir, walkRepo(dir));
    expect(services.some((s) => s.file.endsWith('payment_service.py'))).toBe(true);
    expect(services.some((s) => s.file.endsWith('user_repo.py'))).toBe(true);
  });
});

describe('Graph: Go imports are not orphaned', () => {
  it('creates a package node + depends_on edge for Go imports', () => {
    const dir = tmp({
      'main.go': `package main
import (
  "fmt"
  "github.com/gin-gonic/gin"
)
func main() { fmt.Println("x") }
`,
    });
    const graph = buildGraph(dir);
    const pkgs = graph.nodes.filter((n) => n.type === 'package').map((n) => n.label);
    expect(pkgs).toContain('github.com/gin-gonic/gin');
    expect(
      graph.edges.some((e) => e.type === 'depends_on' && e.from === 'file:main.go'),
    ).toBe(true);
  });
});

describe('Graph markdown enrichment', () => {
  it('includes a dependencies/edges section, not just routes', () => {
    const dir = tmp({
      'main.go': `package main\nimport "github.com/gin-gonic/gin"\nfunc main(){ r:=gin.Default(); r.GET("/x", h) }\n`,
    });
    const [, mdPath] = writeGraph(dir, buildGraph(dir));
    const md = fs.readFileSync(mdPath, 'utf8');
    expect(md).toMatch(/## (External packages|Dependencies)/);
    expect(md).toContain('github.com/gin-gonic/gin');
  });
});
