import express from 'express';
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { nanoid } from 'nanoid';
import { KafuOpsConfig } from '../config/schema.js';
import { IncidentEngine } from '../incident/engine.js';
import { RuntimeEvent } from '../types/index.js';
import { Redactor } from '../redaction/index.js';
import { log } from '../util/logger.js';

export interface StartWebhookOptions {
  rootDir: string;
  config: KafuOpsConfig;
  /** Override port from config. */
  port?: number;
}

export function buildWebhookApp(rootDir: string, config: KafuOpsConfig): express.Express {
  const app = express();
  const engine = new IncidentEngine(rootDir, config);
  const redactor = new Redactor(config);
  const secret = process.env[config.server.webhook_secret_env] ?? '';
  if (!secret) {
    log.warn(
      `${config.server.webhook_secret_env} is not set — sentry/datadog webhook signatures cannot be verified. These endpoints will reject requests until the env var is configured.`,
    );
  }

  // Capture the raw request body so HMAC verification uses bytes that match what the
  // signing party signed. `JSON.stringify(req.body)` does NOT round-trip — fields may
  // reorder, whitespace differs, and Unicode escaping changes.
  app.use(
    express.json({
      limit: '5mb',
      verify: (req: IncomingMessage & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  app.post('/v1/events', (req, res) => {
    try {
      const event = normalizeRawEvent(req.body, redactor);
      const inc = engine.ingest(event);
      res.json({ ok: true, incident_id: inc?.id ?? null });
    } catch (err) {
      log.error(`/v1/events failed: ${(err as Error).message}`);
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/v1/incidents', (req, res) => {
    try {
      const body = req.body ?? {};
      // Redact before the event is stored — manual reports can carry secrets too.
      const event: RuntimeEvent = {
        id: `evt_${nanoid(10)}`,
        service: body.service ?? config.project.service_name ?? config.project.name,
        environment: body.environment ?? 'production',
        type: 'manual',
        severity: body.severity ?? 'high',
        timestamp: new Date().toISOString(),
        message: redactor.redactText(String(body.summary ?? 'Manual incident')).text,
        stacktrace: body.evidence?.stacktrace
          ? redactor.redactText(String(body.evidence.stacktrace)).text
          : undefined,
        attributes: { manual: true, ...(redactor.redactJson(body.attributes ?? {}).value as Record<string, unknown>) },
      };
      const inc = engine.ingest(event, { force: true });
      res.json({ ok: true, incident: inc });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/v1/webhooks/sentry', (req, res) => {
    if (!verifySignature(req, secret, 'sentry-signature', 'sha256')) {
      return res.status(401).json({ ok: false, error: 'invalid signature' });
    }
    try {
      const event = sentryToEvent(req.body, config, redactor);
      const inc = engine.ingest(event);
      res.json({ ok: true, incident_id: inc?.id ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/v1/webhooks/datadog', (req, res) => {
    if (!verifySignature(req, secret, 'x-datadog-signature', 'sha256')) {
      return res.status(401).json({ ok: false, error: 'invalid signature' });
    }
    try {
      const event = datadogToEvent(req.body, config, redactor);
      const inc = engine.ingest(event);
      res.json({ ok: true, incident_id: inc?.id ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/v1/webhooks/alertmanager', (req, res) => {
    // Alertmanager supports bearer auth via http_config.authorization. We require
    // it and fail closed (parity with the HMAC-gated Sentry/Datadog endpoints):
    // an unauthenticated incident-injection endpoint is a real risk.
    if (!verifyBearer(req, secret)) {
      return res.status(401).json({ ok: false, error: 'invalid or missing bearer token' });
    }
    try {
      const body = req.body ?? {};
      const alerts: any[] = Array.isArray(body.alerts) ? body.alerts : [body];
      const created: string[] = [];
      for (const a of alerts) {
        const event = alertmanagerToEvent(a, config, redactor);
        const inc = engine.ingest(event);
        if (inc) created.push(inc.id);
      }
      res.json({ ok: true, incidents: created });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/v1/otel/traces', (req, res) => {
    // OpenTelemetry OTLP/HTTP JSON trace receiver. Disabled by default; opt in via
    // observability.opentelemetry.enabled. Auth is optional (a collector is
    // typically a trusted in-cluster sender) — but enforced when a secret is set.
    if (!config.observability.opentelemetry.enabled) {
      return res.status(404).json({ ok: false, error: 'opentelemetry receiver disabled' });
    }
    // We parse the OTLP/HTTP JSON encoding only. A protobuf body would arrive
    // unparsed (express.json ignores it) and silently yield zero spans, so fail
    // loudly with a clear hint instead.
    const ctype = (req.header('content-type') ?? '').toLowerCase();
    if (!ctype.includes('application/json')) {
      return res.status(415).json({
        ok: false,
        error: 'OTLP receiver accepts JSON only — configure your collector exporter to use JSON encoding (not protobuf).',
      });
    }
    if (secret && !verifyBearer(req, secret)) {
      return res.status(401).json({ ok: false, error: 'invalid or missing bearer token' });
    }
    try {
      const events = otelToEvents(req.body, config, redactor);
      const created: string[] = [];
      for (const ev of events) {
        const inc = engine.ingest(ev);
        if (inc) created.push(inc.id);
      }
      res.json({ ok: true, incidents: created, spans_ingested: events.length });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/v1/webhooks/custom', (req, res) => {
    try {
      const event = normalizeRawEvent(req.body, redactor);
      const inc = engine.ingest(event);
      res.json({ ok: true, incident_id: inc?.id ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  return app;
}

export function startWebhookServer(opts: StartWebhookOptions): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  return new Promise((resolve) => {
    const app = buildWebhookApp(opts.rootDir, opts.config);
    const port = opts.port ?? opts.config.server.port;
    const host = opts.config.server.host;
    const server = app.listen(port, host, () => {
      log.ok(`Webhook server listening on http://${host}:${port}`);
      resolve({
        port: (server.address() as { port: number }).port,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

function normalizeRawEvent(body: any, redactor: Redactor): RuntimeEvent {
  if (!body || typeof body !== 'object') throw new Error('event body must be an object');
  return {
    id: body.id ?? `evt_${nanoid(10)}`,
    service: String(body.service ?? 'unknown'),
    environment: String(body.environment ?? 'production'),
    type: body.type ?? 'error.log',
    severity: body.severity ?? 'error',
    timestamp: body.timestamp ?? new Date().toISOString(),
    message: redactor.redactText(String(body.message ?? '')).text,
    stacktrace: body.stacktrace ? redactor.redactText(String(body.stacktrace)).text : undefined,
    trace_id: body.trace_id,
    span_id: body.span_id,
    route: body.attributes?.route ?? body.route,
    attributes: (redactor.redactJson(body.attributes ?? {}).value as Record<string, unknown>),
  };
}

function sentryToEvent(body: any, config: KafuOpsConfig, redactor: Redactor): RuntimeEvent {
  const ev = body?.event ?? body ?? {};
  const exception = ev.exception?.values?.[0];
  const frames = exception?.stacktrace?.frames ?? [];
  const topFrame = frames[frames.length - 1];
  const stacktrace = frames
    .map((f: any) => `at ${f.function ?? ''} (${f.filename ?? ''}:${f.lineno ?? 0}:${f.colno ?? 0})`)
    .join('\n');
  return {
    id: `evt_${nanoid(10)}`,
    service: ev.tags?.service ?? body?.project_name ?? config.project.service_name ?? config.project.name,
    environment: ev.environment ?? 'production',
    type: 'alert.webhook',
    severity: ev.level === 'fatal' ? 'critical' : ev.level === 'error' ? 'error' : 'warn',
    timestamp: ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : new Date().toISOString(),
    message: redactor.redactText(exception?.value ?? ev.message ?? 'sentry alert').text,
    stacktrace: stacktrace ? redactor.redactText(stacktrace).text : undefined,
    attributes: {
      sentry_issue_url: body?.url,
      top_frame_file: topFrame?.filename,
      top_frame_line: topFrame?.lineno,
      exception_type: exception?.type,
    },
  };
}

function datadogToEvent(body: any, config: KafuOpsConfig, redactor: Redactor): RuntimeEvent {
  return {
    id: `evt_${nanoid(10)}`,
    service: body?.service ?? config.project.service_name ?? config.project.name,
    environment: body?.env ?? 'production',
    type: 'alert.webhook',
    severity: (body?.alert_type as RuntimeEvent['severity']) ?? 'error',
    timestamp: new Date().toISOString(),
    message: redactor.redactText(String(body?.title ?? body?.text ?? 'datadog alert')).text,
    attributes: { datadog: redactor.redactJson(body ?? {}).value },
  };
}

function alertmanagerToEvent(alert: any, config: KafuOpsConfig, redactor: Redactor): RuntimeEvent {
  const labels = alert?.labels ?? {};
  const annotations = alert?.annotations ?? {};
  const severity = (labels.severity as RuntimeEvent['severity']) ?? 'high';
  return {
    id: `evt_${nanoid(10)}`,
    service: labels.service ?? labels.job ?? config.project.service_name ?? config.project.name,
    environment: labels.env ?? 'production',
    type: 'alert.webhook',
    severity,
    timestamp: alert.startsAt ?? new Date().toISOString(),
    message: redactor.redactText(String(annotations.summary ?? labels.alertname ?? 'alertmanager alert')).text,
    attributes: { alertmanager: redactor.redactJson({ labels, annotations }).value },
  };
}

/**
 * Verify an HMAC signature header against the raw request body.
 *
 * Fails closed when:
 *   - secret is empty (so unconfigured deployments cannot accept unsigned events)
 *   - the signature header is missing or malformed
 *   - the raw body wasn't captured (e.g. body parser didn't see it)
 *
 * The signature may be hex (Sentry's `sentry-signature`) or base64 (some providers).
 * We compute both encodings and timing-safe compare against whichever the caller sent.
 */
export function verifySignature(
  req: express.Request & { rawBody?: Buffer },
  secret: string,
  header: string,
  algo: 'sha256',
): boolean {
  if (!secret) return false;
  const raw = req.rawBody;
  if (!raw || !Buffer.isBuffer(raw)) return false;
  const provided = (req.header(header) ?? '').trim().replace(/^sha256=/, '');
  if (!provided) return false;
  const hmacHex = crypto.createHmac(algo, secret).update(raw).digest('hex');
  const hmacB64 = crypto.createHmac(algo, secret).update(raw).digest('base64');
  return safeEqual(provided, hmacHex) || safeEqual(provided, hmacB64);
}

/**
 * Verify an `Authorization: Bearer <secret>` header (timing-safe). Fails closed
 * when the secret is empty so unconfigured deployments cannot accept unsigned
 * events. Used by the Alertmanager and (optionally) OpenTelemetry endpoints,
 * which authenticate with bearer tokens rather than HMAC signatures.
 */
export function verifyBearer(req: express.Request, secret: string): boolean {
  if (!secret) return false;
  const provided = (req.header('authorization') ?? '').trim().replace(/^Bearer\s+/i, '');
  if (!provided) return false;
  return safeEqual(provided, secret);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Read an OTLP attribute value (stringValue/intValue/boolValue/doubleValue). */
function otlpAttrValue(v: any): string | undefined {
  if (v == null || typeof v !== 'object') return undefined;
  if (typeof v.stringValue === 'string') return v.stringValue;
  if (v.intValue != null) return String(v.intValue);
  if (v.boolValue != null) return String(v.boolValue);
  if (v.doubleValue != null) return String(v.doubleValue);
  return undefined;
}

/** Flatten an OTLP `attributes` array into a key→string map. */
function otlpAttrs(attrs: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(attrs)) return out;
  for (const a of attrs) {
    if (a && typeof a.key === 'string') {
      const val = otlpAttrValue(a.value);
      if (val !== undefined) out[a.key] = val;
    }
  }
  return out;
}

/**
 * Normalize an OTLP/HTTP JSON trace export into RuntimeEvents. We emit one event
 * per span that is either status.code === 2 (ERROR) or carries an `exception`
 * span event, extracting exception type/message/stacktrace.
 */
export function otelToEvents(body: any, config: KafuOpsConfig, redactor: Redactor): RuntimeEvent[] {
  const out: RuntimeEvent[] = [];
  const resourceSpans: any[] = Array.isArray(body?.resourceSpans) ? body.resourceSpans : [];
  for (const rs of resourceSpans) {
    const resAttrs = otlpAttrs(rs?.resource?.attributes);
    const service =
      resAttrs['service.name'] ?? config.project.service_name ?? config.project.name;
    const environment = resAttrs['deployment.environment'] ?? 'production';
    const scopeSpans: any[] = Array.isArray(rs?.scopeSpans)
      ? rs.scopeSpans
      : Array.isArray(rs?.instrumentationLibrarySpans)
      ? rs.instrumentationLibrarySpans
      : [];
    for (const ss of scopeSpans) {
      const spans: any[] = Array.isArray(ss?.spans) ? ss.spans : [];
      for (const span of spans) {
        const statusCode = span?.status?.code;
        const events: any[] = Array.isArray(span?.events) ? span.events : [];
        const exceptionEvent = events.find((e) => e?.name === 'exception');
        if (statusCode !== 2 && !exceptionEvent) continue;
        const spanAttrs = otlpAttrs(span?.attributes);
        const excAttrs = otlpAttrs(exceptionEvent?.attributes);
        const exceptionType = excAttrs['exception.type'];
        const exceptionMsg = excAttrs['exception.message'];
        const stack = excAttrs['exception.stacktrace'];
        const route = spanAttrs['http.route'] ?? spanAttrs['http.target'] ?? span?.name;
        const message =
          exceptionMsg ?? span?.status?.message ?? `Span errored: ${span?.name ?? 'unknown'}`;
        out.push({
          id: `evt_${nanoid(10)}`,
          service,
          environment,
          type: 'uncaught_exception',
          severity: 'error',
          timestamp: new Date().toISOString(),
          message: redactor.redactText(String(message)).text,
          stacktrace: stack ? redactor.redactText(String(stack)).text : undefined,
          trace_id: span?.traceId,
          span_id: span?.spanId,
          route,
          attributes: {
            source: 'opentelemetry',
            exception_type: exceptionType,
            top_frame_file: stack ? topFrameFile(stack) : undefined,
            ...(redactor.redactJson(spanAttrs).value as Record<string, unknown>),
          },
        });
      }
    }
  }
  return out;
}

/** Best-effort top stack-frame file from a raw stack string (Node or Python). */
function topFrameFile(stack: string): string | undefined {
  const node = /at\s+(?:[^()]*\()?([^()\s:]+):\d+:\d+\)?/.exec(stack);
  if (node) return node[1];
  const py = /File\s+"([^"]+)",\s+line\s+\d+/.exec(stack);
  if (py) return py[1];
  return undefined;
}
