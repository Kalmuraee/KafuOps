# Redaction

Redaction removes sensitive values before storage, analysis, and model calls.

## Redaction points

KafuOps should redact at multiple layers:

```text
ingestion -> storage -> context bundle -> model call -> MR body
```

## Default redaction patterns

```yaml
redaction:
  enabled: true
  patterns:
    - name: email
      regex: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
      replace_with: '[REDACTED_EMAIL]'
    - name: bearer_token
      regex: 'Bearer\s+[A-Za-z0-9._\-]+'
      replace_with: 'Bearer [REDACTED_TOKEN]'
    - name: api_key_param
      regex: '(api[_-]?key|secret|token)=([^\s&]+)'
      replace_with: '\1=[REDACTED_SECRET]'
    - name: jwt_like_token
      regex: 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
      replace_with: '[REDACTED_JWT]'
    - name: credit_card_like
      regex: '\b(?:\d[ -]*?){13,19}\b'
      replace_with: '[REDACTED_CARD]'
```

## Structured redaction

When logs are JSON, redact by field names:

```yaml
redaction:
  json_fields:
    - password
    - token
    - secret
    - authorization
    - cookie
    - session
    - access_token
    - refresh_token
    - credit_card
```

## File redaction

Some files should never enter model context:

```yaml
file_policy:
  deny:
    - .env
    - .env.*
    - secrets/**
    - private_keys/**
    - '*.pem'
    - '*.key'
    - credentials.json
```

## Redaction audit

Each context bundle should record redaction summary:

```json
{
  "redaction_applied": true,
  "patterns_matched": {
    "email": 4,
    "bearer_token": 1,
    "api_key_param": 2
  },
  "files_excluded": [
    ".env",
    "config/secrets.yml"
  ]
}
```

## Redaction failure

If redaction fails, KafuOps should stop the LLM workflow.

```text
Redaction failed -> no model call -> create local incident report only
```
