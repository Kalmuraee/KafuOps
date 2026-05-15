# Security and Privacy

KafuOps handles sensitive data: source code, logs, traces, stack traces, and production metadata. Security must be part of the product design from day one.

## Default privacy posture

KafuOps defaults should be:

```yaml
privacy:
  send_full_logs_to_llm: false
  send_full_repo_to_llm: false
  redact_before_storage: true
  redact_before_llm: true
  audit_model_context: true
  auto_merge: false
```

## What can be sensitive

- Source code.
- Secrets and tokens.
- `.env` files.
- Customer names, emails, addresses, phone numbers.
- Authorization headers.
- Session IDs.
- Database connection strings.
- Payment data.
- Private stack traces from proprietary services.
- Internal hostnames and infrastructure details.

## Data minimization

KafuOps should send the minimum useful context to the model.

Allowed by default:

- Sanitized stack trace.
- Sanitized log excerpts around the incident.
- Relevant source files.
- Relevant tests.
- Project memory summaries.
- Architecture graph snippets.

Denied by default:

- Full log streams.
- Full repository upload.
- `.env` files.
- Secret directories.
- Private keys.
- Raw request bodies.
- Raw customer data.

## Auditability

Every model call should be auditable.

Audit files should include:

- Incident ID.
- Model purpose.
- Files included.
- Files excluded.
- Redaction rules applied.
- Token/size summary.
- Prompt template version.
- Model output schema.

Do not store raw secrets in audit files.

## High-risk file policies

Examples:

```yaml
policies:
  never_modify:
    - .env
    - secrets/**
    - private_keys/**
  require_approval_to_modify:
    - src/auth/**
    - src/payments/**
    - src/security/**
    - migrations/**
    - infra/**
```

## Principle: logs are untrusted

Logs may contain user-generated content. User-generated content may contain prompt-injection attempts.

KafuOps must treat logs, traces, request input, error messages, and commit messages as untrusted data.

## Model output safety

KafuOps should not blindly execute model output.

Required controls:

- Structured output validation.
- Patch-only application.
- No arbitrary shell commands from model.
- Sandbox execution.
- Policy checks before file modification.
- Human review before merge.

## Secrets handling

KafuOps should use environment variables or secret managers for credentials.

Never commit:

```text
OPENAI_API_KEY
Git provider tokens
Webhook secrets
Database credentials
Cloud provider keys
```

## Recommended deployment

For sensitive teams:

- Self-host KafuOps.
- Run repository scanning locally.
- Store memory in the repo.
- Use bring-your-own OpenAI key.
- Enable strict redaction.
- Require approval before model calls for sensitive services.
- Keep audit logs.
