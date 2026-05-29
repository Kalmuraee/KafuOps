# Embedded Node SDK

A tiny, optional way to report runtime errors from a Node service directly to a
KafuOps agent — without taking KafuOps into your process as a manager. For richer
ingestion prefer wrapper mode, the webhook receivers, or OpenTelemetry.

It is shipped inside the `kafuops` package (not a separate `@kafuops/node`).

## Install + use

```ts
import { installErrorReporter } from 'kafuops';

// Reports uncaught exceptions and unhandled rejections to the agent.
const uninstall = installErrorReporter({
  endpoint: 'http://kafuops-agent:7878', // the agent's HTTP intake
  service: 'checkout-api',
  environment: process.env.NODE_ENV,
});

// later, if needed:
uninstall();
```

Report a handled error explicitly:

```ts
import { reportError } from 'kafuops';

try {
  await chargeCard(order);
} catch (err) {
  await reportError(err, { endpoint: 'http://kafuops-agent:7878', service: 'checkout-api' });
  throw err;
}
```

## Guarantees

- **Never throws.** A failed report (network down, agent absent) is swallowed —
  observability must not crash the host app.
- **Does not change crash behavior.** `installErrorReporter` only *adds* handlers;
  it does not suppress your existing `uncaughtException` handling.
- Posts a normalized event to `POST <endpoint>/v1/events`; the agent applies the
  same redaction, trigger, and dedup rules as any other intake.

## API

| Export | Purpose |
|---|---|
| `installErrorReporter(opts)` | Hook `uncaughtException`/`unhandledRejection`; returns an uninstall fn |
| `reportError(err, opts)` | Report a single error (handled or not) |
| `buildErrorEvent(err, { service, environment })` | Pure helper that shapes an error into the event payload |

`opts`: `{ endpoint, service, environment?, fetchImpl? }` (`fetchImpl` is for tests/custom transports).
