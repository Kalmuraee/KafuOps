# Configuration

KafuOps is configured with `.kafuops.yml` at the repository root.

## Full example

```yaml
version: 1

project:
  name: api-service
  language: typescript
  framework: express
  service_name: api-service
  default_branch: main

repo:
  provider: gitlab
  url: git@gitlab.com:org/api-service.git
  default_branch: main
  mr:
    enabled: true
    auto_create: true
    auto_merge: false
    branch_prefix: kafuops/fix

runtime:
  mode: sidecar
  service_command: null
  log_sources:
    - type: stdout
    - type: file
      path: /var/log/api-service/*.log

observability:
  opentelemetry:
    enabled: true
    endpoint: http://localhost:4318
  logs:
    enabled: true
    ring_buffer:
      enabled: true
      max_age_seconds: 600
      max_bytes_per_service: 10485760
      include_before_error_seconds: 120
      include_after_error_seconds: 30
  webhooks:
    sentry: false
    datadog: false
    alertmanager: true

triggers:
  create_incident_when:
    - type: uncaught_exception
    - type: process_crash
    - type: repeated_stacktrace
      count: 3
      window_seconds: 120
    - type: http_5xx_rate
      threshold: 10
      window_seconds: 300
    - type: alert_webhook
      severities: [critical, high]

llm:
  provider: openai
  trigger_mode: incident_only
  models:
    analysis: gpt-5.5-pro
    patch: gpt-5.5-pro
  structured_outputs: true
  max_context_files: 30
  max_log_excerpt_chars: 12000

privacy:
  redact_before_storage: true
  redact_before_llm: true
  audit_model_context: true
  send_full_logs_to_llm: false
  send_full_repo_to_llm: false
  require_allowlist_for_sensitive_paths: true

redaction:
  enabled: true
  patterns:
    - name: email
      regex: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
      replace_with: '[REDACTED_EMAIL]'
    - name: bearer_token
      regex: 'Bearer\s+[A-Za-z0-9._\-]+'
      replace_with: 'Bearer [REDACTED_TOKEN]'

sandbox:
  type: docker
  image: node:22
  install_command: npm ci
  test_command: npm test
  targeted_test_command: npm test -- {test_file}

policies:
  confidence:
    open_mr_if_score_at_least: 70
    require_human_approval_if_below: 85
  never_modify:
    - .env
    - secrets/**
    - private_keys/**
    - infra/prod/**
  require_approval_to_modify:
    - src/auth/**
    - src/payments/**
    - migrations/**
```

## Environment variables

```bash
KAFUOPS_CONFIG=.kafuops.yml
KAFUOPS_GIT_TOKEN=...
OPENAI_API_KEY=...
KAFUOPS_WEBHOOK_SECRET=...
KAFUOPS_STORAGE_URL=...
```

## Config validation

Run:

```bash
kafuops doctor
```

The doctor command checks:

- Required config keys.
- Git provider access.
- Model provider access.
- Test command availability.
- Redaction rules.
- Policy conflicts.
- Repository scan readiness.
