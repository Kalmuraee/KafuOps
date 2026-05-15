# Features

## Observability-aware incident detection

KafuOps watches logs, traces, alerts, stack traces, and process crashes. It groups noisy events into actionable incidents.

## Local rolling log buffer

KafuOps keeps recent logs locally and only selects relevant excerpts when an incident occurs.

## Error-triggered LLM calls

No incident means no model call. KafuOps only calls the model after trigger policy, redaction, and context selection.

## Repository understanding

KafuOps scans your backend repository to understand files, routes, services, database usage, queues, external APIs, and tests.

## Project memory

KafuOps creates a living `.kafuops/memory/` folder that improves after every incident and review.

## Regression test generation

When possible, KafuOps creates a failing test before generating the fix.

## MR/PR creation

KafuOps creates GitHub PRs and GitLab MRs with evidence, validation, confidence score, and blast-radius analysis.

## Policy engine

Control what KafuOps can send, modify, and submit.

## Privacy and audit

Every model call includes a grounding manifest. Redaction is applied before model calls.

## Self-hosted friendly

Run KafuOps in your own environment with your own Git provider, storage, model key, and policies.
