# Datadog Integration

KafuOps can receive Datadog monitor alerts and use them as incident triggers.

## Configuration

```yaml
observability:
  webhooks:
    datadog: true
```

## Webhook endpoint

```text
POST /v1/webhooks/datadog
```

## Useful fields

- Monitor name.
- Service.
- Environment.
- Severity.
- Query.
- Triggered value.
- Tags.
- Link to trace/log view.

## Recommended usage

Use Datadog to detect service-level symptoms and KafuOps to connect those symptoms to source code.
