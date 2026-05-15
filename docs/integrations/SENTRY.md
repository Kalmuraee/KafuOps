# Sentry Integration

KafuOps can receive issue and error webhooks from Sentry.

## Use case

Sentry detects an application error. KafuOps receives the webhook, maps the stack trace to the repository, builds context, and creates an MR if policy allows.

## Configuration

```yaml
observability:
  webhooks:
    sentry: true
```

## Webhook endpoint

```text
POST /v1/webhooks/sentry
```

## Expected fields

KafuOps should extract:

- Project/service.
- Environment.
- Error message.
- Exception type.
- Stack trace.
- Release version.
- Event count.
- First seen / last seen.
- Tags.

## Context mapping

Sentry release version or commit SHA can help KafuOps identify the deployed code version.
