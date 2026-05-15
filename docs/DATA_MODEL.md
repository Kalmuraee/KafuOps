# Data Model

This page defines the main KafuOps objects.

## Event

A single observed runtime signal.

```json
{
  "id": "evt_123",
  "service": "api-service",
  "environment": "production",
  "type": "error.log",
  "severity": "error",
  "timestamp": "2026-05-15T10:24:00Z",
  "message": "...",
  "stacktrace": "...",
  "trace_id": "...",
  "attributes": {}
}
```

## Incident

A grouped and actionable production problem.

```json
{
  "id": "inc_123",
  "service": "api-service",
  "environment": "production",
  "severity": "high",
  "fingerprint": "payment_retry_missing_default_method",
  "status": "analyzed",
  "first_seen": "2026-05-15T10:24:00Z",
  "last_seen": "2026-05-15T10:30:00Z",
  "event_count": 18
}
```

## Evidence packet

Sanitized runtime evidence used for debugging.

```json
{
  "incident_id": "inc_123",
  "stacktrace": "...",
  "logs": [],
  "trace_spans": [],
  "deployment": {
    "version": "1.42.0",
    "commit_sha": "abc123"
  }
}
```

## Context bundle

Evidence plus selected repository context.

```json
{
  "incident_id": "inc_123",
  "evidence_packet": {},
  "files": [
    {
      "path": "src/payment/retry.ts",
      "reason": "top stack frame"
    }
  ],
  "memory": [
    {
      "path": ".kafuops/memory/routes.md",
      "reason": "route mapping"
    }
  ]
}
```

## Patch attempt

```json
{
  "id": "patch_123",
  "incident_id": "inc_123",
  "branch": "kafuops/fix/inc-123-checkout-null-payment-method",
  "files_changed": [],
  "tests_run": [],
  "confidence": 0.84,
  "status": "mr_opened"
}
```
