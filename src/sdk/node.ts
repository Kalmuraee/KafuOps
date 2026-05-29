import { RuntimeEvent } from '../types/index.js';

/**
 * Minimal embedded SDK for Node services. Lets an app report runtime errors to a
 * KafuOps agent's `/v1/events` endpoint without taking KafuOps into its process
 * as a manager. This is intentionally tiny — for richer ingestion use wrapper
 * mode, the webhook receivers, or OpenTelemetry.
 */
export interface ReporterOptions {
  /** Agent base URL, e.g. http://kafuops-agent:7878 */
  endpoint: string;
  service: string;
  environment?: string;
  /** Injectable fetch for tests / custom transports. */
  fetchImpl?: typeof fetch;
}

/** Shape an error into a RuntimeEvent (minus the server-assigned id). */
export function buildErrorEvent(
  err: unknown,
  opts: { service: string; environment?: string },
): Omit<RuntimeEvent, 'id'> {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    service: opts.service,
    environment: opts.environment ?? process.env.NODE_ENV ?? 'production',
    type: 'uncaught_exception',
    severity: 'error',
    timestamp: new Date().toISOString(),
    message: e.message,
    stacktrace: e.stack,
    attributes: { exception_type: e.name, source: 'node_sdk' },
  };
}

/**
 * Report a single error to the agent. Never throws — observability must not take
 * down the host application.
 */
export async function reportError(err: unknown, opts: ReporterOptions): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const body = buildErrorEvent(err, opts);
  try {
    await f(`${opts.endpoint.replace(/\/$/, '')}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // swallow — never break the app for a failed report
  }
}

/**
 * Install global handlers that report uncaught exceptions and unhandled
 * rejections. Returns an uninstall function. Does not change the process's own
 * crash behavior — it only adds a reporter.
 */
export function installErrorReporter(opts: ReporterOptions): () => void {
  const onUncaught = (err: Error): void => {
    void reportError(err, opts);
  };
  const onRejection = (reason: unknown): void => {
    void reportError(reason, opts);
  };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  return () => {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onRejection);
  };
}
