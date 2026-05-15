import { loadConfigOrExit } from '../util.js';
import { startWebhookServer } from '../../webhooks/server.js';
import { log } from '../../util/logger.js';

export async function webhooksStart(opts: { port?: number }): Promise<void> {
  const { config, rootDir } = loadConfigOrExit();
  await startWebhookServer({ rootDir, config, port: opts.port });
  // Stay alive until SIGINT/SIGTERM.
  process.on('SIGINT', () => {
    log.info('Shutting down webhooks…');
    process.exit(0);
  });
}

export async function webhooksTest(source: string): Promise<void> {
  const { config } = loadConfigOrExit();
  const port = config.server.port;
  const host = config.server.host;
  const url = `http://${host}:${port}/v1/webhooks/${source}`;
  const samples: Record<string, unknown> = {
    sentry: {
      event: {
        environment: 'production',
        level: 'error',
        message: 'Sample sentry test',
        tags: { service: config.project.name },
        exception: {
          values: [
            {
              type: 'TypeError',
              value: 'Cannot read properties of undefined',
              stacktrace: {
                frames: [
                  { filename: 'src/payment/retry.ts', lineno: 42, colno: 17, function: 'handler' },
                ],
              },
            },
          ],
        },
      },
    },
    alertmanager: {
      alerts: [
        {
          labels: { service: config.project.name, severity: 'high', alertname: 'HighErrorRate' },
          annotations: { summary: 'Error rate exceeds 10/5m' },
          startsAt: new Date().toISOString(),
        },
      ],
    },
    datadog: {
      service: config.project.name,
      env: 'production',
      alert_type: 'error',
      title: 'High error rate',
      text: 'Error rate above threshold',
    },
    custom: {
      service: config.project.name,
      environment: 'production',
      type: 'error.log',
      severity: 'error',
      message: 'Sample event',
    },
  };
  const payload = samples[source];
  if (!payload) {
    log.error(`Unknown source: ${source}`);
    process.exit(2);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  log.info(`${res.status} ${text}`);
}
