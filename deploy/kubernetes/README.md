# KafuOps on Kubernetes

Pragmatic manifests for running KafuOps beside your backend. This is **not** a
custom operator/CRD — it is the agent + worker deployment pattern that matches
the sidecar/control-plane model in `docs/ARCHITECTURE.md`.

## Components

| Manifest | What it runs |
|---|---|
| `namespace.yaml` | `kafuops` namespace |
| `secret.example.yaml` | LLM key, git token, webhook secret (copy → `secret.yaml`) |
| `configmap.yaml` | your `.kafuops.yml` |
| `agent-deployment.yaml` | `kafuops agent start` — webhook + OTLP intake + Service |
| `worker-deployment.yaml` | `kafuops worker start` — drives incidents → MRs (+ PVC, git-clone initContainer) |

## Apply

```bash
kubectl apply -f namespace.yaml
cp secret.example.yaml secret.yaml      # fill in real values
kubectl apply -f secret.yaml
# edit configmap.yaml (repo.url, triggers, policies) and the clone URL in worker-deployment.yaml
kubectl apply -f configmap.yaml
kubectl apply -f agent-deployment.yaml
kubectl apply -f worker-deployment.yaml
```

## Wiring intake

Point your alerting/telemetry at the agent Service (`kafuops-agent:7878`):

- Sentry / Datadog: `POST /v1/webhooks/{sentry,datadog}` (HMAC, `KAFUOPS_WEBHOOK_SECRET`)
- Alertmanager: `POST /v1/webhooks/alertmanager` (bearer `KAFUOPS_WEBHOOK_SECRET`)
- OpenTelemetry collector: `POST /v1/otel/traces` (set `observability.opentelemetry.enabled: true`)

## Notes / limitations

- The agent keeps incident-dedup state in-process; run a single replica.
- The worker clones the repo on start; for very large repos prefer a sidecar that
  syncs the working tree instead of a fresh clone.
- `auto_merge` is off by default — KafuOps opens reviewable MRs, it does not merge.
- This is the MVP deployment shape; a first-class operator is on the roadmap.
