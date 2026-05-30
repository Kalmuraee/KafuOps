# Changelog

## 0.3.0 — quality

### DX, TUI & "make it ready"

- **Easy setup**: `.kafuops/.env` is auto-loaded at startup (no manual `export`),
  `kafuops quickstart` does setup→key→memory in one command, and `init` adds
  KafuOps state to the repo `.gitignore`.
- **Nicer terminal**: boxed panels + spinners across the wizard, `status`/`watch`,
  and `scan` (degrade cleanly in CI / `KAFUOPS_LOG_FORMAT=json`).
- **STATUS.md is now all ✅**: aligned the lagging docs (DEPLOYMENT_KUBERNETES,
  EXAMPLES, FAQ) with reality, added an adversarial prompt-injection **fuzz suite**,
  and replaced the "gaps" section with an honest "deliberately deferred" list.
  Marked Phase 4 (deploy-diff + recurrence) complete.

### Deploy awareness & recurrence

- **`kafuops deploy <version>`** records a deploy marker; the previously no-op
  **`deployment_regression`** trigger now fires when an error follows a recent
  deploy, correlating the failure to that release.
- **Recurrence detection**: a new incident whose fingerprint matches a previously
  merged/resolved one is flagged `recurrence_of` (the prior fix regressed or was
  incomplete) — surfaced as a ⚠ note + `recurrence` label on the MR.

### Performance & security

- **Patch path-traversal guard**: a model-generated diff whose paths escape the
  repo (`..` / absolute) is refused before `git apply` (`validatePatchPaths`).
- **LLM retry/backoff**: transient provider failures (429/5xx/timeouts) are
  retried with exponential backoff (`llm.max_retries`); deterministic errors
  aren't.
- **Docker network isolation**: `sandbox.network: none` runs the container with
  `--network none` (no exfiltration during tests).
- **Anthropic prompt caching**: the stable system prompt is marked cacheable
  (`llm.prompt_cache`, default on) to cut cost/latency on repeated calls.

### Operator experience

- **`kafuops status`** and **`kafuops watch`**: a dashboard of incident counts,
  open vs terminal, and the recent list — one-shot or live-refreshing.
- **Structured logging**: `KAFUOPS_LOG_FORMAT=json` emits single-line JSON logs
  (ANSI-stripped) for agents / Kubernetes log pipelines.

### Context intelligence

- **Failing-region focus**: each suspect file now carries a numbered window of
  code around the failing stack-frame line (marked `>`), rendered prominently to
  the model — it fixes the exact spot instead of re-reading the whole file.
- **Deploy-diff awareness**: the context now includes recent git history of the
  suspect files (a file changed just before the incident is a prime regression
  suspect).
- Redaction now runs over the full file before truncation (so focus snippets are
  sanitized too); the top stack-frame file is ranked first.

### Fix quality & autonomy

- **Agentic self-correcting fix loop**: the pipeline now applies a patch, runs
  the sandbox tests, and — if it doesn't apply or tests fail — feeds the failure
  back to the model to revise and retries (bounded by `llm.max_fix_attempts`,
  default 2). `PipelineResult.attempts` is reported.
- **`kafuops eval`** + `src/eval/harness.ts`: a seeded fix-quality suite (wrong
  operator, off-by-one, missing null guard) that measures real **fix-success
  rate**, average attempts, and confidence calibration against the configured
  provider — the missing way to know whether fixes actually work.
- Fixed a latent ESM bug (`require` in `sandbox/runner.ts`) that broke real
  copy-mode sandboxing outside the test runner.

## 0.2.0 — close the loop

### Onboarding (follow-up)

- **Auto-discovery wizard**: `kafuops init` detects the stack, start command, git
  remote, packaging (→ suggested runtime mode), log files, and available AI
  tooling, prints a "Discovered:" summary, and pre-fills every prompt.
- **AI provider menu**: detected **Codex / Claude CLIs** offered first (no key
  needed — KafuOps shells out to them), then OpenAI/Anthropic APIs, then none.
- **Local-CLI providers** `llm.provider: codex | claude-cli` (new orchestrator
  backend); `doctor` verifies the CLI is installed.
- **Live model selection**: fetches the latest models your key can access and
  lets you pick analysis/patch models (curated fallback offline).
- New docs: `AI_PROVIDERS.md`; `kafuops init --yes` is fully non-interactive.

### Hardening (follow-up)

- **CI**: GitHub Actions build + test on Node 20/22 for every push/PR.
- **End-to-end fix proof**: a mocked-provider test applies a generated diff to a
  buggy fixture and asserts the failing test goes green (`tests/e2e-fix.test.ts`),
  via a new orchestrator-injection seam in the pipeline.
- **Worker concurrency safety**: atomic incident claiming (lock file with
  stale-steal) so multiple workers can't double-process.
- **Tailer durability**: per-file byte offsets persisted across restarts (no
  re-read, no gap, clean rotation reset).
- **OTLP**: non-JSON (protobuf) bodies rejected with a clear 415.
- **Similar-incident matching**: prior incidents sharing a fingerprint/frame are
  retrieved into context (`related_incidents` + memory snippet).
- **Embedded Node SDK** (`installErrorReporter`/`reportError`), exported from the
  package root (also fixes the previously-dangling `main`). See `docs/NODE_SDK.md`.
- **Prompt-injection contract tests**; per-page docs synced (CLI, OTel, SDK).

A first-class Kubernetes operator/CRD is deliberately deferred (the Helm chart +
manifests already cover deployment).

## 0.2.0 — close the loop (initial)

Turns the MVP into the product the README describes: the agent now *observes* a
live system and *autonomously* drives incidents to MRs, and the safety promises
are enforced by code.

Added / fixed:

- **Runtime → context wiring.** The wrapper ring buffer is persisted per incident
  and consumed by the context builder (was: only the last 50 raw events). New
  **sidecar file tailing** (`agent start` tails `runtime.log_sources`).
- **Autonomous worker.** `worker start` is a real background loop
  (`--interval`/`--once`) that drives pending incidents through
  analyse → patch → validate → MR. `auto_create`/`auto_merge` are now real knobs.
- **Learning loop.** Per-incident history (`incidents.md`) and human review
  feedback (`review-feedback.md`, via `incidents mark-merged`/`mark-rejected`)
  are written and fed back into context.
- **LLM safety.** `trigger_mode` (`off`/`manual_only`/`incident_only`) fully
  enforced; `require_redaction` is a hard gate on live calls; `audit_model_context`
  and `structured_outputs` honored.
- **Webhook safety + OTel.** `/v1/incidents` now redacts intake; Alertmanager
  endpoint requires a bearer token (fail-closed); new OpenTelemetry OTLP receiver
  (`POST /v1/otel/traces`).
- **Multi-language scanning.** Route discovery for Go (gin/echo/chi/net-http),
  Java (Spring), and Rust (actix/rocket/axum); Python service discovery; Go/Java/
  Rust import edges; a real architecture-graph Markdown.
- **Docker sandbox.** `sandbox.type: docker` runs install/test in a container
  (falls back to local); `targeted_test_command` is wired.
- **Kubernetes deployment.** `deploy/kubernetes/` manifests + `deploy/helm/kafuops/`
  chart (agent + worker). `KAFUOPS_CONFIG` env var now honored.
- **`policies explain --incident`**; GitLab HTTPS URL parsing bug fixed; MR/sandbox
  test coverage added.

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
