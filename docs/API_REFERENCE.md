# API Reference

This is a proposed API for KafuOps.

## Health

```http
GET /healthz
```

Response:

```json
{
  "status": "ok"
}
```

## Create event

```http
POST /v1/events
```

Request:

```json
{
  "service": "api-service",
  "environment": "production",
  "type": "error.log",
  "severity": "error",
  "timestamp": "2026-05-15T10:24:00Z",
  "message": "TypeError: Cannot read properties of undefined",
  "stacktrace": "...",
  "trace_id": "abc123",
  "attributes": {
    "route": "POST /checkout"
  }
}
```

## Create incident manually

```http
POST /v1/incidents
```

Request:

```json
{
  "service": "api-service",
  "environment": "production",
  "summary": "Checkout route returns 500",
  "severity": "high",
  "evidence": {
    "stacktrace": "..."
  }
}
```

## Get incident

```http
GET /v1/incidents/{incident_id}
```

## Analyze incident

```http
POST /v1/incidents/{incident_id}/analyze
```

Response:

```json
{
  "incident_id": "inc_123",
  "classification": "code_bug",
  "root_cause": "Missing null check",
  "confidence": 0.82,
  "should_attempt_fix": true
}
```

## Build context

```http
POST /v1/incidents/{incident_id}/context
```

## Create MR

```http
POST /v1/incidents/{incident_id}/merge-request
```

Response:

```json
{
  "provider": "gitlab",
  "merge_request_url": "https://gitlab.example.com/org/api/-/merge_requests/482",
  "branch": "kafuops/fix/inc-123-checkout-null-payment-method"
}
```

## Webhooks

```http
POST /v1/webhooks/sentry
POST /v1/webhooks/datadog
POST /v1/webhooks/alertmanager
POST /v1/webhooks/custom
```
