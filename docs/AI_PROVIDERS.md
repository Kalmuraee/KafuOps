# AI Providers

KafuOps can drive its analysis/patch pipeline through several backends. Pick one
in the wizard or set `llm.provider` in `.kafuops.yml`.

| `llm.provider` | Needs | Notes |
|---|---|---|
| `openai` | `OPENAI_API_KEY` | Direct API. Models fetched live from `/v1/models`. |
| `anthropic` | `ANTHROPIC_API_KEY` | Direct API. Models fetched live from `/v1/models`. |
| `codex` | `codex` CLI on PATH | **No API key** — KafuOps runs `codex exec`. |
| `claude-cli` | `claude` CLI on PATH | **No API key** — KafuOps runs `claude -p`. |
| `azure-openai` | `OPENAI_API_KEY` | Uses the OpenAI SDK shape. |
| `none` | — | Deterministic offline heuristics (dry-run). |

Whatever the backend, the same gates apply uniformly: `trigger_mode`
(`off`/`manual_only`/`incident_only`), the `require_redaction` privacy gate, and
per-call audit logging.

## Local CLIs (Codex / Claude)

If you already use the OpenAI Codex CLI or the Claude CLI, KafuOps can delegate to
them with zero key management:

```yaml
llm:
  provider: claude-cli   # or: codex
  models:
    analysis: ''         # blank = the CLI's own default model
    patch: ''
```

KafuOps invokes the CLI non-interactively (the whole prompt is passed as a single
argument; `--model` is added only if you set one) and parses a single JSON object
from its output. `kafuops doctor` verifies the CLI is installed.

> Treat the CLI providers as **experimental**: output shape depends on the CLI
> version. If you see "did not return valid JSON" errors, prefer the API
> providers or pin a model.

## Live model selection

For `openai`/`anthropic`, `kafuops init` queries the provider's models endpoint
with your key and offers the current catalog (falling back to a curated list when
offline). You can re-run `kafuops init` any time to refresh the selection.
