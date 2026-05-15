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
      const event: RuntimeEvent = {
        id: `evt_${nanoid(10)}`,
        service: body.service ?? config.project.service_name ?? config.project.name,
        environment: body.environment ?? 'production',
        type: 'manual',
        severity: body.severity ?? 'high',
        timestamp: new Date().toISOString(),
        message: body.summary ?? 'Manual incident',
        stacktrace: body.evidence?.stacktrace,
        attributes: { manual: true },
      };
      const inc = engine.ingest(event);
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

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
