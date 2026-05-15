# Example Incident Packet

This is an example of the sanitized packet KafuOps may send to the model after an incident trigger.

```json
{
  "incident": {
    "id": "inc_123",
    "service": "api-service",
    "environment": "production",
    "severity": "high",
    "summary": "Checkout route returns 500 when payment method is missing",
    "first_seen": "2026-05-15T10:24:00Z",
    "event_count": 18
  },
  "runtime_evidence": {
    "route": "POST /checkout",
    "exception_type": "TypeError",
    "message": "Cannot read properties of undefined",
    "stacktrace": [
      "src/payment/retry.ts:42:17",
      "src/routes/checkout.ts:88:11"
    ],
    "logs_excerpt": [
      {
        "timestamp": "2026-05-15T10:23:58Z",
        "message": "Starting checkout for customer [REDACTED_ID]"
      },
      {
        "timestamp": "2026-05-15T10:24:00Z",
        "message": "TypeError: Cannot read properties of undefined"
      }
    ]
  },
  "repo_context": {
    "commit_sha": "abc123",
    "files": [
      {
        "path": "src/payment/retry.ts",
        "reason": "top stack frame"
      },
      {
        "path": "tests/payment/retry.test.ts",
        "reason": "nearest test file"
      }
    ]
  },
  "privacy": {
    "redaction_applied": true,
    "full_logs_sent": false,
    "full_repo_sent": false
  }
}
```

## Important

The packet is not a full log dump. It is a small, incident-specific, redacted evidence bundle.
