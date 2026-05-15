# Prometheus Alertmanager Integration

KafuOps can receive alerts from Prometheus Alertmanager.

## Configuration

```yaml
observability:
  webhooks:
    alertmanager: true
```

## Webhook endpoint

```text
POST /v1/webhooks/alertmanager
```

## Example alert labels

```yaml
labels:
  service: api-service
  severity: critical
  route: /checkout
  alertname: HighHttp5xxRate
```

## Incident mapping

KafuOps should map alert labels to:

- Service.
- Environment.
- Route/job.
- Severity.
- Time window.

Then it should pull matching logs/traces from the rolling buffer if available.
