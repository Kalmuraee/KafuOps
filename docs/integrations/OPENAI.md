# OpenAI Integration

KafuOps can use the OpenAI API for incident analysis, root-cause reasoning, patch planning, test generation, and MR explanation.

## Core rule

KafuOps should call OpenAI only after an incident trigger and after redaction.

```yaml
llm:
  provider: openai
  trigger_mode: incident_only
```

## Environment variable

```bash
OPENAI_API_KEY=...
```

## Model roles

```yaml
llm:
  models:
    analysis: gpt-5.5-pro
    patch: gpt-5.5-pro
```

You can make these configurable.

## Structured outputs

KafuOps should request structured outputs for decisions such as:

- Incident classification.
- Root-cause hypothesis.
- Files to inspect.
- Files to modify.
- Risk level.
- Confidence score.
- Whether to open an MR.

Example schema shape:

```json
{
  "root_cause": "string",
  "confidence": 0.82,
  "files_to_modify": ["src/payment/retry.ts"],
  "risk_level": "low",
  "should_open_mr": true
}
```

## Context sent to the model

Allowed by default:

- Sanitized incident summary.
- Sanitized stack trace.
- Sanitized log excerpts.
- Relevant source files.
- Relevant tests.
- Project memory summaries.
- Architecture graph path.

Denied by default:

- Full logs.
- Full repository.
- Secrets.
- Private keys.
- `.env` files.
- Raw customer data.

## Audit

Every OpenAI call should be recorded in a grounding manifest.
