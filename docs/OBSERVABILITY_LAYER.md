# Observability Layer

KafuOps adds a fixing layer on top of backend observability. It is not meant to replace logs, traces, metrics, or alerting tools.

## Inputs

KafuOps should support these signal types:

```text
logs
traces
metrics
runtime exceptions
process crashes
alert webhooks
release/deploy events
feature flag changes
manual incident reports
```

## Local event normalization

Every incoming signal is normalized into a KafuOps event:

```json
{
  "event_id": "evt_123",
  "service": "api-service",
  "environment": "production",
  "timestamp": "2026-05-15T10:24:00Z",
  "type": "error.log",
  "severity": "error",
  "trace_id": "abc123",
  "span_id": "def456",
  "route": "POST /checkout",
  "message": "TypeError: Cannot read properties of undefined",
  "stacktrace": "...",
  "attributes": {
    "runtime": "node",
    "version": "1.42.0"
  }
}
```

## Rolling log buffer

KafuOps keeps a local rolling log buffer per service.

Default behavior:

```yaml
logs:
  ring_buffer:
    enabled: true
    max_age_seconds: 600
    max_bytes_per_service: 10485760
    include_before_error_seconds: 120
    include_after_error_seconds: 30
```

This lets KafuOps reconstruct useful context without uploading continuous logs.

## Incident-only model calls

The model is not called for every log entry.

Flow:

```text
logs/traces arrive
  -> stored locally in ring buffer
  -> lightweight detector watches for trigger patterns
  -> incident created only when trigger matches
  -> context bundle selected
  -> redacted
  -> model called
```

## Signal correlation

KafuOps should correlate events using:

- Service name.
- Environment.
- Trace ID.
- Span ID.
- Route or job name.
- Stack trace fingerprint.
- Deployment version.
- Commit SHA.
- Error message fingerprint.
- Time window.

## Error fingerprinting

Example fingerprint:

```text
service: api-service
route: POST /checkout
top_frame: src/payment/retry.ts:42
exception_type: TypeError
normalized_message: Cannot read properties of undefined
```

This prevents repeated identical errors from triggering repeated LLM calls.

## Noise control

KafuOps should support:

- Deduplication.
- Rate limiting.
- Severity thresholds.
- Environment filters.
- Ignore rules.
- Known-error suppression.
- Maintenance windows.

Example:

```yaml
noise_control:
  dedupe_window_seconds: 900
  max_incidents_per_service_per_hour: 5
  ignore:
    - message_contains: "healthcheck"
    - route: "GET /metrics"
    - environment: "development"
```
