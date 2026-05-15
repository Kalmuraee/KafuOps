import { describe, it, expect, beforeEach } from 'vitest';
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
