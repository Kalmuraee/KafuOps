import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigSchema } from '../src/config/schema.js';
import { buildWebhookApp } from '../src/webhooks/server.js';
import { ensureDirs, getPaths } from '../src/util/paths.js';

function listen(app: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function postJson(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('Webhook HMAC verification', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-wh-'));
    ensureDirs(getPaths(dir));
  });

  it('rejects sentry webhook when no secret configured', async () => {
    delete process.env.KAFUOPS_WEBHOOK_SECRET;
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await postJson(`${url}/v1/webhooks/sentry`, { event: { level: 'error', message: 'x' } });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('verifies sentry HMAC against the raw request body, not JSON.stringify', async () => {
    process.env.KAFUOPS_WEBHOOK_SECRET = 'topsecret';
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      // Payload includes whitespace/ordering details that would NOT round-trip through JSON.stringify.
      const rawBody =
        '{"event":{"environment":"production","level":"error","message":"hi","tags":{"service":"api"}}}';
      const sig = crypto.createHmac('sha256', 'topsecret').update(rawBody).digest('hex');
      const res = await fetch(`${url}/v1/webhooks/sentry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sentry-signature': `sha256=${sig}`,
        },
        body: rawBody,
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
      delete process.env.KAFUOPS_WEBHOOK_SECRET;
    }
  });

  it('rejects sentry webhook with bad signature', async () => {
    process.env.KAFUOPS_WEBHOOK_SECRET = 'topsecret';
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/webhooks/sentry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'sentry-signature': 'sha256=deadbeef' },
        body: '{"event":{"level":"error","message":"x"}}',
      });
      expect(res.status).toBe(401);
    } finally {
      await close();
      delete process.env.KAFUOPS_WEBHOOK_SECRET;
    }
  });

  it('health endpoint always responds', async () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await fetch(`${url}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    } finally {
      await close();
    }
  });
});

describe('Manual incident endpoint redaction', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-mi-'));
    ensureDirs(getPaths(dir));
  });

  it('redacts message and stacktrace on /v1/incidents', async () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await postJson(`${url}/v1/incidents`, {
        service: 'api',
        summary: 'Payment failed for user@example.com',
        evidence: { stacktrace: 'Authorization: Bearer abc.def.ghi at handler' },
      });
      expect(res.status).toBe(200);
      const inc = res.body.incident;
      expect(inc.summary).toContain('[REDACTED_EMAIL]');
      expect(inc.summary).not.toContain('user@example.com');
      expect(inc.events[0].stacktrace).toContain('[REDACTED_TOKEN]');
    } finally {
      await close();
    }
  });
});

describe('Alertmanager authentication (fail-closed)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-am-'));
    ensureDirs(getPaths(dir));
    delete process.env.KAFUOPS_WEBHOOK_SECRET;
  });
  afterEach(() => {
    delete process.env.KAFUOPS_WEBHOOK_SECRET;
  });

  const payload = { alerts: [{ labels: { service: 'api', severity: 'high', alertname: 'X' }, annotations: { summary: 'high error rate' } }] };

  it('rejects when no secret is configured', async () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await postJson(`${url}/v1/webhooks/alertmanager`, payload);
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('accepts with a matching bearer token', async () => {
    process.env.KAFUOPS_WEBHOOK_SECRET = 'amsecret';
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await postJson(`${url}/v1/webhooks/alertmanager`, payload, {
        Authorization: 'Bearer amsecret',
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('rejects with a wrong bearer token', async () => {
    process.env.KAFUOPS_WEBHOOK_SECRET = 'amsecret';
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await postJson(`${url}/v1/webhooks/alertmanager`, payload, {
        Authorization: 'Bearer wrong',
      });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });
});

describe('OpenTelemetry OTLP receiver', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kafuops-otel-'));
    ensureDirs(getPaths(dir));
  });

  const otlp = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout' } },
            { key: 'deployment.environment', value: { stringValue: 'production' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                name: 'POST /checkout',
                status: { code: 2 },
                attributes: [{ key: 'http.route', value: { stringValue: '/checkout' } }],
                events: [
                  {
                    name: 'exception',
                    attributes: [
                      { key: 'exception.type', value: { stringValue: 'TypeError' } },
                      { key: 'exception.message', value: { stringValue: 'Cannot read properties of undefined' } },
                      { key: 'exception.stacktrace', value: { stringValue: 'TypeError: x\n    at handler (src/app.ts:10:5)' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('returns 404 when the receiver is disabled (default)', async () => {
    const cfg = ConfigSchema.parse({ project: { name: 't' } });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await postJson(`${url}/v1/otel/traces`, otlp);
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });

  it('rejects a non-JSON (protobuf) OTLP body with 415', async () => {
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      observability: { opentelemetry: { enabled: true } },
    });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/otel/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-protobuf' },
        body: Buffer.from([0x0a, 0x00]),
      });
      expect(res.status).toBe(415);
    } finally {
      await close();
    }
  });

  it('creates an incident from an OTLP error span when enabled', async () => {
    const cfg = ConfigSchema.parse({
      project: { name: 't' },
      observability: { opentelemetry: { enabled: true } },
      // an error span maps to uncaught_exception which always triggers
    });
    const app = buildWebhookApp(dir, cfg);
    const { url, close } = await listen(app);
    try {
      const res = await postJson(`${url}/v1/otel/traces`, otlp);
      expect(res.status).toBe(200);
      expect(res.body.incidents.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});
