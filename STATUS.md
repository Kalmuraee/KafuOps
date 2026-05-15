# Implementation Status

This document maps every spec document in `docs/` and the product surface
described in `PRODUCT_BRIEF.md` to its current implementation state.

The repository contains two layers:

- **`docs/` and `website/`** — the product specification. These describe what
  KafuOps is meant to be. Some are aspirational.
- **`src/`, `tests/`, `bin/`, `Dockerfile`** — the actual implementation. This
  is the 0.1.0 MVP.

Use this table to understand what you can actually run today versus what is
still on the design board.

## Legend

- ✅ **Implemented** — works in `src/` and is covered by tests or smoke trials.
- 🟡 **Partial** — code path exists but has known limitations called out here.
- 🔲 **Not yet** — described in docs only; no code.

## PRODUCT_BRIEF MVP success criteria

| Criterion | State | Notes |
|---|---|---|
| Connect to one Git provider (GitHub or GitLab) | 🟡 | `src/mr/github.ts`, `src/mr/gitlab.ts` open real PRs/MRs once `KAFUOPS_GIT_TOKEN` is set and `repo.url` is configured. Without those, the pipeline runs end-to-end in dry-run. |
| Connect to one runtime source | 🟡 | `kafuops run -- <cmd>` wrapper mode and the webhook server are implemented. The sidecar `agent start` does **not** yet tail files from `runtime.log_sources`; it currently only listens for webhook ingestion. |
| Build a project memory file tree and architecture summary | ✅ | `src/scanner/*`, `src/graph/*`. Validated against four real OSS apps (Express, NestJS, FastAPI, Flask). Memory file is `.kafuops/memory/project.md`. |
| Detect an error event and create an incident | ✅ | `src/incident/engine.ts` — fingerprint dedup, trigger policies (uncaught_exception, repeated_stacktrace, http_5xx_rate, alert_webhook), noise filters, rate limiting. |
| Select relevant files from stack traces and architecture graph | ✅ | `src/context/builder.ts` — uses top stack frame + graph neighbors + nearest tests, redacts and writes a grounding manifest. |
| Call the OpenAI API with a sanitized context bundle | 🟡 | `src/llm/orchestrator.ts` makes real OpenAI calls when `OPENAI_API_KEY` is present, otherwise drops into deterministic offline heuristics. Every call is audited to `.kafuops/audit/model-calls/`. |
| Generate a small patch and regression test | 🟡 | Patch generation works through the OpenAI orchestrator. The deterministic dry-run produces an empty diff (this is intentional — we don't want a fake patch in audit logs). |
| Run tests in a sandbox | 🟡 | Local sandbox is real: rsync-copy → `git init` snapshot → `git apply` → install + test commands. Docker sandbox config is recognized but not yet used; `sandbox.type: docker` falls back to local execution. |
| Open an MR/PR with evidence and confidence score | ✅ | `src/mr/creator.ts` produces the body. GitHub via Octokit, GitLab via REST. Dry-run mode auto-applies without tokens. |

## docs/ map

| Doc | State | Notes |
|---|---|---|
| `ARCHITECTURE.md` | ✅ | Components match `src/`. Sidecar deployment described is the goal; current sidecar is webhook-only. |
| `ARCHITECTURE_GRAPH.md` | ✅ | `src/graph/builder.ts` builds the JSON + Markdown graph artifacts. |
| `BLAST_RADIUS.md` | ✅ | `src/blast-radius/index.ts` produces the structured output described. |
| `CLI.md` | ✅ | All commands exist. `policies explain --incident` is not yet supported (only `--file`). |
| `CONFIDENCE_SCORE.md` | ✅ | `src/confidence/score.ts` returns the documented breakdown. |
| `CONFIGURATION.md` | ✅ | Zod schema in `src/config/schema.ts` validates `.kafuops.yml`. |
| `DATA_MODEL.md` | ✅ | Types in `src/types/index.ts`. |
| `DEPLOYMENT_DOCKER.md` | 🟡 | `Dockerfile` + `docker-compose.example.yml` exist. K8s sidecar of arbitrary apps is not yet supported. |
| `DEPLOYMENT_KUBERNETES.md` | 🔲 | Operator and DaemonSet patterns described but not implemented. |
| `ERROR_TRIGGERED_LLM.md` | ✅ | Implemented as the four-stage orchestrator. |
| `EXAMPLE_INCIDENT_PACKET.md` | ✅ | Matches `context-bundle.json` produced by the context builder. |
| `EXAMPLES.md` | 🟡 | `examples/sample-app/` exists; further worked examples are aspirational. |
| `FAQ.md` | 🟡 | Reads partly like marketing copy; not all claims map 1:1 to code yet. Treat as roadmap context. |
| `GETTING_STARTED.md` | ✅ | The flow described works end-to-end with `--in-place --dry-run`. |
| `GLOSSARY.md` | ✅ | Reference doc, no code dependency. |
| `INCIDENT_WORKFLOW.md` | ✅ | Lifecycle matches `IncidentStore` statuses + CLI commands. |
| `INDEX.md` | ✅ | Doc index. |
| `INTEGRATIONS.md` | 🟡 | OpenAI + GitHub + GitLab + Sentry + Datadog + Alertmanager are implemented at the webhook intake layer. Datadog uses a configurable header (`x-datadog-signature`); real Datadog signing schemes vary by feature and may require adjustment. |
| `MR_GENERATION.md` | ✅ | Body template + labels match `src/mr/creator.ts`. |
| `OBSERVABILITY_LAYER.md` | 🟡 | Ring buffer, normalization, dedup are implemented. OpenTelemetry receiver is **not** implemented despite the config schema. |
| `POLICIES.md` | ✅ | `src/policies/engine.ts`. Post-apply policy check (against actual changed files, not just the plan) is enforced. |
| `PROJECT_MEMORY.md` | 🟡 | File-tree / routes / services / tests / dependencies are generated. Per-incident memory files and review-feedback updates are **not yet** written. |
| `PROMPT_INJECTION_SAFETY.md` | ✅ | Orchestrator wraps log/trace content as untrusted data and instructs the model not to follow embedded instructions. Not exhaustively tested. |
| `REDACTION.md` | ✅ | Built-in pattern set + JSON-field scrubbing + ReDoS guard on user-supplied patterns. |
| `ROADMAP.md` | 🟡 | The whole point of this file. Read it alongside this STATUS.md. |
| `RUNTIME_MODES.md` | 🟡 | Wrapper mode works. Webhook-only works. Sidecar agent is partial. Kubernetes mode and embedded SDK are not yet implemented. |
| `SECURITY_PRIVACY.md` | 🟡 | Redaction, audit logging, never_modify policy, raw-body HMAC for webhooks are real. Threat-model coverage is not formalized. |
| `SELF_HOSTING.md` | 🟡 | Docker compose works. Helm charts / cluster recipes are not provided. |
| `SETUP_WIZARD.md` | ✅ | `kafuops init` covers the steps described, with `-y` for accepting defaults. |
| `TROUBLESHOOTING.md` | ✅ | Reference doc. |

## Larger gaps still open

Not blocking 0.1.0 but worth knowing about:

- `worker start` is a placeholder — no background analysis loop pulling incidents off a queue.
- Memory is not updated after a reviewer merges/rejects an MR.
- `llm.trigger_mode: 'off'` is not enforced (dry-run is keyed off `OPENAI_API_KEY` presence).
- OpenTelemetry receiver, K8s operator, embedded SDKs (`@kafuops/node`) — not yet started.
- Multi-language support beyond the current scanner heuristics — Go, Rust, Java are detected but route discovery is Node/TS/Python only.

If you find a gap that isn't listed here, that's a real bug — please open an
issue.
