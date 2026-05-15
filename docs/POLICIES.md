# Policy Engine

The policy engine controls what KafuOps is allowed to analyze, send to a model, modify, and submit as an MR.

## Policy goals

- Prevent risky changes.
- Protect sensitive files.
- Control model usage.
- Avoid noisy MRs.
- Enforce human approval where needed.

## Default policy

```yaml
policies:
  model_calls:
    require_incident: true
    require_redaction: true
    audit_every_call: true

  merge_requests:
    auto_create: true
    auto_merge: false
    require_tests_or_explanation: true

  confidence:
    open_mr_if_score_at_least: 70
    require_human_approval_if_below: 85

  never_modify:
    - .env
    - .env.*
    - secrets/**
    - private_keys/**
    - '*.pem'
    - '*.key'

  require_approval_to_modify:
    - src/auth/**
    - src/security/**
    - src/payments/**
    - migrations/**
    - infra/**
```

## Model-call policy

```yaml
model_calls:
  allowed_when:
    - incident_created
    - manual_approval
  denied_when:
    - redaction_failed
    - incident_severity_below: medium
    - source_is_untrusted_without_sandbox: true
```

## File modification policy

```yaml
file_modification:
  never_modify:
    - secrets/**
  require_approval:
    - src/auth/**
  allow:
    - src/**
    - tests/**
```

## MR creation policy

```yaml
merge_requests:
  auto_create: true
  auto_merge: false
  require:
    - evidence_packet
    - grounding_manifest
    - confidence_score
    - blast_radius
```

## Incident policy

```yaml
incidents:
  environments:
    include: [production, staging]
    exclude: [development]
  severities:
    include: [high, critical]
  rate_limit:
    max_per_service_per_hour: 5
```

## Explain policy decisions

KafuOps should explain why something was blocked:

```bash
kafuops policies explain --incident inc_123
```

Example output:

```text
MR blocked because patch modifies src/auth/session.ts.
Policy requires human approval for src/auth/**.
Confidence score: 76.
```
