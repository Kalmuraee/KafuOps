import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { KafuOpsConfig } from '../config/schema.js';
import { ContextBundle, ContextFile, EvidencePacket, Incident, LogExcerpt } from '../types/index.js';
import { Redactor, RedactionStats } from '../redaction/index.js';
import { IncidentStore } from '../incident/store.js';
import { loadGraph, indexGraph, neighbors, findTestsFor, GraphIndex } from '../graph/query.js';
import { getPaths } from '../util/paths.js';
import { RingBuffer } from '../runtime/ringbuffer.js';

export interface BuildContextInput {
  incident: Incident;
  /** Optional in-memory ring buffer with recent logs around the incident time. */
  ringBuffer?: RingBuffer;
}

export interface BuildContextResult {
  bundle: ContextBundle;
  bundle_path: string;
  manifest_path: string;
}

export function buildContext(
  rootDir: string,
  config: KafuOpsConfig,
  input: BuildContextInput,
): BuildContextResult {
  const redactor = new Redactor(config);
  const graph = loadGraph(rootDir);
  const index = graph ? indexGraph(graph) : null;

  const deniedGlobs = config.file_policy.deny;
  const filesExcluded: string[] = [];

  const candidates: Array<{ file: string; reason: string; strength: 'high' | 'medium' | 'low' }> = [];

  // 1) Top stack frame
  if (input.incident.top_frame_file) {
    const rel = resolveFile(rootDir, input.incident.top_frame_file);
    if (rel) candidates.push({ file: rel, reason: 'top stack frame', strength: 'high' });
  }
  // 2) All distinct stack frames
  for (const ev of input.incident.events) {
    if (!ev.stacktrace) continue;
    const frames = parseFrameFiles(ev.stacktrace);
    for (const f of frames) {
      const rel = resolveFile(rootDir, f);
      if (rel && !candidates.some((c) => c.file === rel)) {
        candidates.push({ file: rel, reason: 'stack frame', strength: 'high' });
      }
    }
  }
  // 3) Graph neighbors
  if (index) {
    const seeds = candidates.map((c) => `file:${c.file}`).filter((id) => index.nodesById.has(id));
    for (const seed of seeds) {
      for (const n of neighbors(index, seed, 2)) {
        if (n.type !== 'file') continue;
        const file = n.label;
        if (candidates.some((c) => c.file === file)) continue;
        candidates.push({ file, reason: 'graph neighbor', strength: 'medium' });
      }
    }
    // Tests for primary files
    for (const seed of seeds) {
      for (const t of findTestsFor(index, seed)) {
        const file = t.label;
        if (candidates.some((c) => c.file === file)) continue;
        candidates.push({ file, reason: 'test for changed file', strength: 'high' });
      }
    }
  }
  // 4) Route handler file (already covered by graph, but explicit for routes mentioned in event)
  // 5) Cap by max_context_files
  const maxFiles = config.llm.max_context_files;
  const ordered = [...candidates].sort((a, b) => rank(a.strength) - rank(b.strength)).slice(0, maxFiles);

  const files: ContextFile[] = [];
  const allStats: RedactionStats[] = [];
  for (const c of ordered) {
    if (isDenied(c.file, deniedGlobs)) {
      filesExcluded.push(c.file);
      continue;
    }
    const full = path.join(rootDir, c.file);
    let content: string;
    let originalBytes: number;
    try {
      const buf = fs.readFileSync(full, 'utf8');
      originalBytes = Buffer.byteLength(buf, 'utf8');
      content = buf.slice(0, config.llm.max_file_chars);
      if (buf.length > content.length) content += `\n// … truncated, original was ${buf.length} chars`;
    } catch {
      continue;
    }
    if (config.privacy.redact_before_llm) {
      const r = redactor.redactText(content);
      allStats.push(r.stats);
      content = r.text;
    }
    files.push({
      path: c.file,
      reason: c.reason,
      evidence_strength: c.strength,
      content,
      original_bytes: originalBytes,
    });
  }

  // Memory snippets
  const memory: ContextBundle['memory'] = [];
  const memoryDir = getPaths(rootDir).memory;
  const projectMd = path.join(memoryDir, 'project.md');
  if (fs.existsSync(projectMd)) {
    memory.push({
      path: '.kafuops/memory/project.md',
      reason: 'project overview',
      content: clip(fs.readFileSync(projectMd, 'utf8'), 4000),
    });
  }
  const archMd = path.join(memoryDir, 'architecture-graph.md');
  if (fs.existsSync(archMd)) {
    memory.push({
      path: '.kafuops/memory/architecture-graph.md',
      reason: 'architecture summary',
      content: clip(fs.readFileSync(archMd, 'utf8'), 2000),
    });
  }
  // Learning loop: prior incidents and human review feedback, when present.
  const reviewMd = path.join(memoryDir, 'review-feedback.md');
  if (fs.existsSync(reviewMd)) {
    memory.push({
      path: '.kafuops/memory/review-feedback.md',
      reason: 'prior human review feedback',
      content: clip(fs.readFileSync(reviewMd, 'utf8'), 2000),
    });
  }
  const incidentsMd = path.join(memoryDir, 'incidents.md');
  if (fs.existsSync(incidentsMd)) {
    memory.push({
      path: '.kafuops/memory/incidents.md',
      reason: 'prior incident history',
      content: clip(fs.readFileSync(incidentsMd, 'utf8'), 2000),
    });
  }

  // Log excerpts. Priority:
  //   1. An in-memory ring buffer passed by the caller (live wrapper/agent run).
  //   2. The ring-buffer excerpt persisted on the incident at capture time
  //      (survives process exit — this is the common path when analysing an
  //      incident after the fact).
  //   3. Fall back to the incident's own event messages (weakest signal).
  const logs: LogExcerpt[] = [];
  const maxLogChars = config.llm.max_log_excerpt_chars;
  if (input.ringBuffer) {
    const firstSeen = new Date(input.incident.first_seen).getTime();
    const before = config.observability.logs.ring_buffer.include_before_error_seconds * 1000;
    const after = config.observability.logs.ring_buffer.include_after_error_seconds * 1000;
    const entries = input.ringBuffer.excerpt(firstSeen - before, firstSeen + after, maxLogChars);
    for (const e of entries) logs.push({ timestamp: e.timestamp, message: e.message });
  } else {
    const persisted = new IncidentStore(rootDir).loadLogs(input.incident.id);
    if (persisted && persisted.length) {
      let budget = maxLogChars;
      for (const e of persisted) {
        if (budget <= 0) break;
        const message = e.message.length > budget ? e.message.slice(0, budget) + '…' : e.message;
        logs.push({ timestamp: e.timestamp, message });
        budget -= message.length;
      }
    } else {
      // Fall back to events themselves
      for (const ev of input.incident.events.slice(-50)) {
        logs.push({ timestamp: ev.timestamp, message: ev.message });
      }
    }
  }

  // Similar/recurring prior incidents — give the model awareness of repeats and
  // past fixes. Surfaced both structurally (related_incidents) and as a trusted
  // memory snippet the prompt renders.
  const related = new IncidentStore(rootDir).findRelated(input.incident, 5);
  if (related.length) {
    memory.push({
      path: '.kafuops/memory/related-incidents',
      reason: 'similar or recurring prior incidents',
      content: related
        .map((r) => `- ${r.id} [${r.status}] ${r.summary} (fingerprint=${r.fingerprint})`)
        .join('\n'),
    });
  }

  const evidence: EvidencePacket = {
    incident_id: input.incident.id,
    stacktrace: input.incident.events.find((e) => e.stacktrace)?.stacktrace,
    logs,
    deployment: input.incident.deployment,
    related_incidents: related.length ? related.map((r) => r.id) : undefined,
  };

  const stats = Redactor.mergeStats(allStats);
  const bundle: ContextBundle = {
    incident_id: input.incident.id,
    evidence_packet: evidence,
    files,
    memory,
    privacy: {
      redaction_applied: config.privacy.redact_before_llm && redactor.isEnabled(),
      full_logs_sent: false,
      full_repo_sent: false,
      patterns_matched: stats,
      files_excluded: filesExcluded,
    },
  };

  // Persist
  const store = new IncidentStore(rootDir);
  const bundlePath = store.writeArtifact(input.incident.id, 'context-bundle.json', JSON.stringify(bundle, null, 2));
  const manifestPath = store.writeArtifact(
    input.incident.id,
    'grounding-manifest.md',
    renderManifest(bundle, input.incident),
  );
  return { bundle, bundle_path: bundlePath, manifest_path: manifestPath };
}

function rank(s: 'high' | 'medium' | 'low'): number {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2;
}

function isDenied(file: string, denyGlobs: string[]): boolean {
  for (const g of denyGlobs) {
    if (minimatch(file, g, { dot: true })) return true;
  }
  return false;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n… (truncated)' : s;
}

function parseFrameFiles(stack: string): string[] {
  const out: string[] = [];
  for (const m of stack.matchAll(/at\s+(?:[\w$.<>\[\] ]+?\s+\()?(.+?):\d+:\d+\)?/g)) {
    if (m[1]) out.push(m[1]);
  }
  for (const m of stack.matchAll(/File\s+"([^"]+)",\s+line\s+\d+/g)) {
    out.push(m[1]);
  }
  return out;
}

/** Try to map an absolute path or partial path to a repo-relative file path. */
function resolveFile(rootDir: string, candidate: string): string | null {
  if (!candidate) return null;
  let p = candidate.replace(/\\/g, '/');
  if (p.startsWith('file://')) p = p.slice('file://'.length);
  // Absolute path inside the repo
  if (path.isAbsolute(p)) {
    const rel = path.relative(rootDir, p);
    if (!rel.startsWith('..') && fs.existsSync(path.join(rootDir, rel))) return rel;
  }
  // Already relative & exists
  if (fs.existsSync(path.join(rootDir, p))) return p;
  // Strip common build prefixes
  for (const prefix of ['dist/', 'build/', 'out/']) {
    if (p.startsWith(prefix)) {
      const stripped = p.slice(prefix.length);
      const ts = stripped.replace(/\.js$/, '.ts');
      if (fs.existsSync(path.join(rootDir, ts))) return ts;
      const js = stripped;
      if (fs.existsSync(path.join(rootDir, js))) return js;
    }
  }
  // Search by basename as a last resort
  const base = path.basename(p);
  if (base.length >= 5) {
    const queue: string[] = [rootDir];
    let scanned = 0;
    while (queue.length && scanned < 5000) {
      const dir = queue.shift()!;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) queue.push(full);
        else if (e.name === base) {
          return path.relative(rootDir, full);
        }
        scanned++;
      }
    }
  }
  return null;
}

function renderManifest(bundle: ContextBundle, incident: Incident): string {
  const lines: string[] = [];
  lines.push('# Grounding Manifest', '');
  lines.push(`Incident: ${incident.id}`);
  lines.push(`Service: ${incident.service}`);
  lines.push(`Environment: ${incident.environment}`);
  lines.push(`Severity: ${incident.severity}`);
  lines.push(`Fingerprint: ${incident.fingerprint}`);
  lines.push(`First seen: ${incident.first_seen}`);
  lines.push(`Event count: ${incident.event_count}`, '');
  lines.push('## Files sent', '');
  for (const f of bundle.files) {
    lines.push(`- \`${f.path}\` — ${f.reason} (strength=${f.evidence_strength}, bytes=${f.original_bytes})`);
  }
  lines.push('', '## Memory sent', '');
  for (const m of bundle.memory) lines.push(`- \`${m.path}\` — ${m.reason}`);
  lines.push('', '## Logs excerpt', '');
  lines.push(`- ${bundle.evidence_packet.logs.length} entries (no full log dump)`);
  lines.push('', '## Privacy', '');
  lines.push(`- Redaction applied: ${bundle.privacy.redaction_applied}`);
  lines.push(`- Full logs sent: ${bundle.privacy.full_logs_sent}`);
  lines.push(`- Full repo sent: ${bundle.privacy.full_repo_sent}`);
  if (Object.keys(bundle.privacy.patterns_matched).length) {
    lines.push(`- Patterns matched:`);
    for (const [k, v] of Object.entries(bundle.privacy.patterns_matched)) {
      lines.push(`  - ${k}: ${v}`);
    }
  }
  if (bundle.privacy.files_excluded.length) {
    lines.push(`- Files excluded by policy:`);
    for (const f of bundle.privacy.files_excluded) lines.push(`  - \`${f}\``);
  }
  return lines.join('\n');
}
