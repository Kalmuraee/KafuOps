# Implementation Status

This document maps every spec document in `docs/` and the product surface
described in `PRODUCT_BRIEF.md` to its current implementation state.

The repository contains two layers:

- **`docs/` and `website/`** — the product specification. These describe what
  KafuOps is meant to be. Some are aspirational.
- **`src/`, `tests/`, `bin/`, `Dockerfile`, `deploy/`** — the actual
  implementation.

Use this table to understand what you can actually run today versus what is
still on the design board.

## Legend

- ✅ **Implemented** — works in `src/` and is covered by tests or smoke trials.
- 🟡 **Partial** — code path exists but has known limitations called out here.
- 🔲 **Not yet** — described in docs only; no code.

## PRODUCT_BRIEF MVP success criteria

| Criterion | State | Notes |
|---|---|---|
| Connect to one Git provider (GitHub or GitLab) | ✅ | `src/mr/github.ts`, `src/mr/gitlab.ts` open real PRs/MRs (and optionally auto-merge) once `KAFUOPS_GIT_TOKEN` + `repo.url` are set; without them the pipeline runs end-to-end in dry-run. (Providing credentials is config, not missing code.) |
| Connect to one runtime source | ✅ | Wrapper mode (`kafuops run -- <cmd>`), the webhook server, an **OpenTelemetry OTLP receiver** (`POST /v1/otel/traces`), and **sidecar file tailing** (`agent start` tails `runtime.log_sources` of type `file`) are all implemented. |
| Build a project memory file tree and architecture summary | ✅ | `src/scanner/*`, `src/graph/*`. Route discovery covers Node/TS, Python, **Go, Java (Spring), and Rust**; the architecture graph parses imports for all of these. Memory at `.kafuops/memory/`. |
| Detect an error event and create an incident | ✅ | `src/incident/engine.ts` — fingerprint dedup, trigger policies, noise filters, rate limiting, plus a `force` path for manual/`simulate` incidents. |
| Select relevant files from stack traces and architecture graph | ✅ | `src/context/builder.ts` — top stack frame + graph neighbors + nearest tests; redacts and writes a grounding manifest. Now also consumes **real runtime logs** (ring-buffer excerpt persisted per incident) and prior-incident/review-feedback memory. |
| Call an LLM with a sanitized context bundle | ✅ | `src/llm/orchestrator.ts` — OpenAI + Anthropic. `trigger_mode` (`off`/`manual_only`/`incident_only`) is fully enforced via an `invocation` flag; `require_redaction` is a hard gate on live calls; `audit_model_context` and `structured_outputs` are honored. Every call audited. Without a key → deterministic dry-run. |
| Generate a small patch and regression test | ✅ | Self-correcting loop (patch → test → revise → retry, `llm.max_fix_attempts`). Proven end-to-end both by a mocked-provider test (`tests/e2e-fix.test.ts`) and a **real run** on `examples/demo-discount` (Claude CLI fixed a real bug, tests green, confidence 80). Absolute fix-rate per model is measurable via `kafuops eval`. |
| Run tests in a sandbox | ✅ | Local sandbox (rsync copy → git snapshot → `git apply` → install + test) **and Docker** (`sandbox.type: docker`, falls back to local if no daemon). `targeted_test_command` runs a focused test for the changed test file before the full suite. |
| Open an MR/PR with evidence and confidence score | ✅ | `src/mr/creator.ts` body; GitHub via Octokit, GitLab via REST. `auto_create`/`auto_merge` are real knobs (`src/mr/decide.ts`); approval-required changes never auto-open. Dry-run without tokens. |

## docs/ map

| Doc | State | Notes |
|---|---|---|
| `ARCHITECTURE.md` | ✅ | Components match `src/`. Sidecar now observes both webhooks and tailed log files. |
| `ARCHITECTURE_GRAPH.md` | ✅ | `src/graph/builder.ts` builds JSON + a richer Markdown (routes→handler, external packages, tested files). |
| `BLAST_RADIUS.md` | ✅ | `src/blast-radius/index.ts`. |
| `CLI.md` | ✅ | All commands exist. `policies explain` now supports `--incident <id>` as well as `--file`. |
| `CONFIDENCE_SCORE.md` | ✅ | `src/confidence/score.ts`. |
| `CONFIGURATION.md` | ✅ | Zod schema in `src/config/schema.ts`; reserved/advisory fields are annotated in-schema. |
| `DATA_MODEL.md` | ✅ | Types in `src/types/index.ts`. |
| `DEPLOYMENT_DOCKER.md` | ✅ | `Dockerfile` + `docker-compose.example.yml`. `KAFUOPS_CONFIG` is now honored by the loader. |
| `DEPLOYMENT_KUBERNETES.md` | ✅ | `deploy/kubernetes/` manifests + `deploy/helm/kafuops/` chart (agent + worker), example configs validated against the schema. Doc updated to match. (A first-class operator/CRD remains a roadmap add-on, not required to run in a cluster.) |
| `ERROR_TRIGGERED_LLM.md` | ✅ | Four-stage orchestrator. |
| `EXAMPLE_INCIDENT_PACKET.md` | ✅ | Matches `context-bundle.json`. |
| `EXAMPLES.md` | ✅ | `examples/sample-app/` + a full worked example `examples/demo-discount/` (run `scripts/demo.sh`) documented in the doc. |
| `FAQ.md` | ✅ | Rewritten to present-tense facts that match the implementation. |
| `GETTING_STARTED.md` | ✅ | Works end-to-end with `--in-place --dry-run`. |
| `GLOSSARY.md` | ✅ | Reference doc. |
| `INCIDENT_WORKFLOW.md` | ✅ | Lifecycle matches `IncidentStore` statuses + CLI (incl. `mark-merged`/`mark-rejected`). |
| `INDEX.md` | ✅ | Doc index. |
| `INTEGRATIONS.md` | ✅ | Sentry/Datadog (HMAC), Alertmanager (bearer), generic JSON, and OpenTelemetry OTLP are all implemented at the intake layer. |
| `MR_GENERATION.md` | ✅ | Body template + labels match `src/mr/creator.ts`. |
| `OBSERVABILITY_LAYER.md` | ✅ | Ring buffer, normalization, dedup, **plus the OTLP receiver**. Ring-buffer excerpts are persisted per incident and fed to the model. |
| `POLICIES.md` | ✅ | `src/policies/engine.ts`; pre- and post-apply checks; `policies explain --incident`. |
| `PROJECT_MEMORY.md` | ✅ | File-tree/routes/services/tests/deps generated by `scan`; per-incident memory (`incidents.md`) and review-feedback (`review-feedback.md`) are now written and fed back into context. |
| `PROMPT_INJECTION_SAFETY.md` | ✅ | Untrusted-data wrapping, contract tests, and an **adversarial fuzz suite** (`tests/prompt-injection-fuzz.test.ts`) asserting every injection payload stays framed as data, never promoted to an instruction. |
| `REDACTION.md` | ✅ | Built-in patterns + JSON-field scrubbing + ReDoS guard. Applied at every intake (incl. the manual `/v1/incidents` endpoint) and before every model call. |
| `ROADMAP.md` | ✅ | Reference doc, kept current (phases 0–4 done; 5–6 partial/scoped). |
| `RUNTIME_MODES.md` | ✅ | Wrapper, webhook, and sidecar (webhook + file tailing) all work. Kubernetes via `deploy/`. A minimal embedded Node SDK (`installErrorReporter`) is now included — see `docs/NODE_SDK.md`. |
| `SECURITY_PRIVACY.md` | ✅ | Redaction, audit logging, never_modify policy, HMAC + bearer webhook auth, require_redaction gate, **patch path-traversal guard**, optional **docker network isolation** (`sandbox.network: none`), **LLM retry/backoff**. |
| `SELF_HOSTING.md` | ✅ | Docker compose + Helm chart + raw K8s manifests. |
| `SETUP_WIZARD.md` | ✅ | `kafuops init` auto-discovers the stack/start-command/repo/packaging/log-files/AI tooling and confirms it, offers a provider menu (incl. detected Codex/Claude CLIs), and live-fetches models to choose. See `AI_PROVIDERS.md`. |
| `TROUBLESHOOTING.md` | ✅ | Reference doc; `policies explain --incident` now exists. |

## Everything above is ✅. Phase 4 of the roadmap is also complete:

- **Deploy-diff awareness**: `kafuops deploy <version>` markers + the
  `deployment_regression` trigger correlate errors to releases; the context also
  includes recent git history of suspect files.
- **Recurrence detection**: a new incident matching a previously merged/resolved
  fingerprint is flagged `recurrence_of` (⚠ note + `recurrence` MR label).
- **Similar-incident matching**: related incidents are retrieved into context.

## Deliberately deferred (not gaps — explicit scope decisions)

- **First-class Kubernetes operator / CRD.** The Helm chart + manifests in
  `deploy/` fully cover cluster deployment; a controller-runtime operator is a
  separate, larger project that adds reconcile-loop management on top.
- **Embeddings / vector-search similarity.** Similar-incident matching uses
  fingerprint + stack-frame heuristics, not embeddings (no vector DB dependency).
- **Multi-replica agent.** The agent's in-memory rate/repeat windows are
  per-process, so it runs as a single replica (the manifests pin `replicas: 1`).
  Incident *creation* dedup is filesystem-backed (cross-process safe) and the
  *worker* is concurrency-safe via incident claiming.
- **Embedded SDK scope.** Ships as a minimal in-package module (`kafuops` /
  `docs/NODE_SDK.md`), not a separate `@kafuops/node` package.
- **Phase 5–6 breadth** (more languages' *fix* quality, SSO/RBAC, air-gapped,
  BYO vector DB) is future work, tracked in `docs/ROADMAP.md`.

The *absolute* fix-success rate for a given model isn't a fixed number — run
`kafuops eval` with your provider to benchmark it on the seeded suite.

If you find a gap that isn't listed here, that's a real bug — please open an
issue.
