# Examples

## Example 1: Local TypeScript backend

```bash
cd api-service
kafuops init
kafuops scan
kafuops run -- npm run dev
```

When a stack trace appears in stdout/stderr, KafuOps groups it into an incident and may create a local analysis.

## Example 2: Production sidecar

```bash
kafuops agent start --config .kafuops.yml
kafuops worker start --config .kafuops.yml
```

The agent observes logs and traces. The worker creates context bundles, runs the LLM workflow, and opens MRs.

## Example 3: Webhook-only Sentry flow

```yaml
observability:
  webhooks:
    sentry: true
```

Sentry sends an issue webhook. KafuOps uses the stack trace and release commit to select relevant files and create an MR.

## Example 4: Alertmanager 5xx alert

Prometheus detects high 5xx rate on `/checkout`. Alertmanager sends a webhook. KafuOps searches its rolling log buffer for matching route and time window, then builds a context bundle.

## Example 5: No-code fix

KafuOps identifies a missing environment variable.

Instead of opening a code MR, it creates an incident report:

```text
Recommended action: add STRIPE_WEBHOOK_SECRET to production environment.
No code MR created.
```
