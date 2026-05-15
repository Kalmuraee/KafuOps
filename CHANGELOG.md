# Changelog

## 0.1.0 — MVP implementation

First runnable cut of the system described in the original blueprint.

Implemented:

- Node.js/TypeScript package with a `kafuops` CLI: `init`, `doctor`, `scan`,
  `run -- <cmd>`, `agent start`, `worker start`, `incidents list/show/build-context/analyze/open-mr/mark-resolved`,
  `simulate`, `memory show/update/validate/diff`, `policies validate/explain`,
  `audit list/show/export`, `webhooks start/test`.
- `.kafuops.yml` configuration with zod-validated schema covering project,
  repo, runtime, observability, triggers, llm, privacy, redaction, file_policy,
  sandbox, policies, noise_control, server.
- Repository scanner that detects framework, routes (Express/Fastify/Nest/FastAPI/Flask),
  services, tests, dependencies, and migrations. Writes
  `.kafuops/memory/{memory.json, project.md}`.
- Architecture graph builder with file, route, package, and test nodes; imports,
  handled_by, depends_on, tests edges. Writes
  `.kafuops/memory/architecture-graph.{json,md}`.
- Redaction engine with built-in patterns (emails, JWTs, bearer tokens, API keys,
  AWS keys, IPv4, credit-card-like, private-key blocks) plus user patterns and
  JSON field-name scrubbing. Applied at ingest and before any LLM call.
- Wrapper-mode runtime that spawns a child process, captures stdout/stderr,
  maintains a bounded ring buffer, and parses Node + Python stack traces into
  normalized incident events.
- Incident engine with fingerprint deduplication, trigger policies
  (uncaught_exception, process_crash, repeated_stacktrace, http_5xx_rate,
  alert_webhook), noise filtering, and rate limiting per service.
- Context builder that selects files from stack frames + architecture graph
  neighbors + nearest tests, applies redaction, excludes deny-listed paths
  (`.env`, secrets, private keys), and writes a grounding manifest documenting
  every byte sent to the model.
- LLM orchestrator with OpenAI structured-output stages (root cause, patch plan,
  code patch, MR explanation). Falls back to deterministic dry-run heuristics
  when `OPENAI_API_KEY` is absent. Every call recorded in
  `.kafuops/audit/model-calls/`.
- Policy engine enforcing `never_modify` / `require_approval_to_modify` globs
  plus confidence-threshold gates.
- Confidence scoring with positive/negative signals + blast-radius analysis
  driven by the architecture graph.
- Patch sandbox that creates a copy of the repo (or runs in-place), checks out
  a fix branch, applies the unified diff with `git apply`, and runs the
  configured install + test commands.
- MR/PR creator with full evidence-rich body. GitHub via Octokit, GitLab via
  REST. Dry-run mode when no token is set.
- Express-based webhook server with normalized intake from Sentry, Datadog,
  Alertmanager, and a generic custom JSON endpoint. HMAC signature verification.
- Dockerfile + docker-compose example for sidecar deployment.
- Vitest suite covering redaction, stack-trace parsing, incident dedup/triggers,
  policy decisions, scanner+graph discovery, context selection, confidence and
  blast-radius scoring, and config round-trip.

## 0.0.0

Initial documentation blueprint.

Included:

- Product brief.
- Architecture docs.
- Setup wizard.
- Runtime modes.
- Incident-triggered LLM workflow.
- Project memory design.
- Security and privacy docs.
- Landing page drafts.
