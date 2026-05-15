# Runtime Modes

KafuOps supports multiple runtime modes so teams can adopt it without changing their backend architecture.

## Recommended default: sidecar agent mode

In production, KafuOps should usually run beside the backend.

```bash
kafuops agent start --config .kafuops.yml
```

The backend continues running normally. KafuOps observes logs, traces, metrics, crashes, and alerts.

Best for:

- Production services.
- Docker deployments.
- Kubernetes deployments.
- Teams that already have OpenTelemetry or log collection.

Advantages:

- Low operational risk.
- Does not become a process manager.
- Works across languages.
- Can fail independently of the backend.

## Local/staging wrapper mode

```bash
kafuops run -- npm run dev
```

KafuOps starts the backend as a child process and watches stdout, stderr, exit code, stack traces, and runtime metadata.

Best for:

- Local development.
- Staging.
- Demo environments.
- Running the agent against reproducible errors.

Advantages:

- Easy setup.
- Captures logs without external collectors.
- Can generate incidents from crashes immediately.

Limitations:

- KafuOps becomes part of process startup.
- Not recommended as the default production deployment.

## Webhook-only mode

```bash
kafuops webhooks start
```

KafuOps receives incidents from tools you already use.

Supported webhook sources should include:

- Sentry.
- Datadog.
- Prometheus Alertmanager.
- Grafana.
- New Relic.
- Custom JSON webhook.

Best for:

- Teams that already have observability platforms.
- Fast adoption without adding log collection.

Limitations:

- Context quality depends on webhook payload.
- May require extra repository scanning to compensate for missing traces or logs.

## Kubernetes mode

KafuOps can run as:

- Sidecar per service.
- DaemonSet per node.
- Central worker deployment.
- OpenTelemetry Collector processor/exporter.

Example structure:

```text
api-service pod
  - api container
  - kafuops-agent sidecar

kafuops namespace
  - kafuops-worker deployment
  - kafuops-api deployment
  - kafuops-storage
```

Best for:

- Cluster-wide observability.
- Multiple backend services.
- Platform teams.

## Embedded SDK mode

Optional SDKs can improve runtime context.

Example:

```ts
import { kafuops } from '@kafuops/node';

kafuops.captureError(error, {
  route: '/checkout',
  tenantSafeId: tenant.id,
  featureFlag: 'new_checkout',
});
```

Best for:

- High-quality error metadata.
- Framework-specific context.
- Safe custom attributes.

Limitations:

- Requires code changes.
- Should not be required for basic adoption.

## Decision table

| Mode | Production | Local | Needs code changes | Best use |
|---|---:|---:|---:|---|
| Sidecar agent | Yes | Optional | No | Default production observability |
| Wrapper | Optional | Yes | No | Local/staging runtime capture |
| Webhook-only | Yes | Optional | No | Existing observability platforms |
| Kubernetes | Yes | No | No | Cluster deployments |
| Embedded SDK | Yes | Yes | Yes | Rich runtime context |

## Recommended rollout

1. Start with `kafuops init` and `kafuops scan`.
2. Use `kafuops run -- <command>` locally.
3. Connect Git provider and OpenAI key.
4. Enable MR creation in dry-run mode.
5. Add sidecar agent to staging.
6. Add production alert webhooks.
7. Enable production incident analysis with human approval.
