# Examples

## Worked example: fix a real bug end-to-end (`examples/demo-discount`)

A runnable demo lives in [`examples/demo-discount/`](../examples/demo-discount/):
a tiny checkout service with a planted unit bug. KafuOps diagnoses it, writes the
patch, self-corrects if the first attempt fails, validates it in a sandbox, and
opens a reviewable MR — driven by the local Claude CLI (no API key).

```bash
npm run build
scripts/demo.sh
```

Real output:

```
### Before — the test fails (red):
AssertionError: 20% off $100 should be $80   (-1900 !== 80)

### KafuOps runs (provider: claude CLI):
! attempt 1: patch did not apply → revise → retry
✓ attempt 2: patch applied, tests passed        # self-correcting loop
  confidence=80 (high)   risk=low

### After — the test passes (green):
all tests passed
```

The generated fix:

```diff
- return price - price * percent;
+ return price - price * (percent / 100);
```

See it animated on the [project site](https://kalmuraee.github.io/KafuOps/).

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
