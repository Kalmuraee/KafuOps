# Setup Wizard

The setup wizard is the primary onboarding flow for KafuOps.

Run:

```bash
kafuops init
```

The wizard should be friendly, explicit, and safe by default. It should never assume that source code, logs, or secrets can be sent to a model.

## Implemented behavior (0.2.0)

`kafuops init` now **auto-discovers** your service and confirms what it found before asking anything else:

1. **Discovery** — detects language/framework, a likely start command (from `package.json` scripts or framework conventions for Python/Go/Rust/Java), the git remote + provider, packaging (Dockerfile / docker-compose / Helm-K8s → a suggested runtime mode), candidate `*.log` files, and which **AI tooling** is available on the machine (the `codex` and `claude` CLIs, plus `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`). All of this is printed as a "Discovered:" summary; the prompts are pre-filled with it so you just confirm or tweak.
2. **AI provider menu** — built from what's installed, least-friction first:
   - **Codex CLI** / **Claude CLI** if detected (local, *no API key needed* — KafuOps shells out to the installed binary).
   - **OpenAI API** / **Anthropic API** (annotated when a key is already in your environment).
   - **None** (deterministic offline heuristics).
3. **Live model selection** — for API providers, the wizard fetches the **latest models your key can access** and lets you pick the analysis and patch models (sensible defaults pre-selected; a curated list is used offline). For CLI providers it asks for an optional model (blank = the CLI's own default).
4. Keys are written to `.kafuops/.env` (mode `0600`, gitignored) — never to `.kafuops.yml`.

`kafuops init --yes` skips all prompts and writes a safe config straight from discovery (provider `none`, no network).

The sections below describe the broader configuration surface the wizard maps onto.

## Wizard goals

The wizard configures:

- Repository provider.
- Runtime mode.
- Observability inputs.
- LLM provider.
- Privacy and redaction rules.
- Test commands.
- MR/PR behavior.
- Memory generation.
- Safety policies.

## Step 1: Project identity

Questions:

```text
Project name: api-service
Primary language: TypeScript
Backend framework: Express / Fastify / NestJS / Other
Service name in production logs: api-service
Default branch: main
```

Generated config:

```yaml
project:
  name: api-service
  language: typescript
  framework: express
  service_name: api-service
  default_branch: main
```

## Step 2: Repository connection

Questions:

```text
Git provider: GitHub / GitLab / Other
Repository URL: git@gitlab.com:org/api-service.git
Create merge requests automatically? yes/no
Require approval before model call? yes/no
```

Generated config:

```yaml
repo:
  provider: gitlab
  url: git@gitlab.com:org/api-service.git
  default_branch: main
  mr:
    enabled: true
    auto_create: true
    auto_merge: false
    branch_prefix: kafuops/fix
```

## Step 3: Runtime mode

Recommended options:

```text
1. Sidecar agent mode     Recommended for production
2. kafuops run wrapper    Recommended for local/staging
3. Webhook-only mode      Good if you already use Sentry/Datadog/Alertmanager
4. Kubernetes mode        Good for clusters
```

Generated config:

```yaml
runtime:
  mode: sidecar
  service_command: null
  log_sources:
    - type: stdout
    - type: file
      path: /var/log/api-service/*.log
```

## Step 4: Observability inputs

Questions:

```text
Use OpenTelemetry traces? yes/no
Use runtime logs? yes/no
Use Sentry webhooks? yes/no
Use Datadog alerts? yes/no
Use Prometheus Alertmanager? yes/no
```

Generated config:

```yaml
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
  webhooks:
    sentry: false
    datadog: false
    alertmanager: true
```

## Step 5: Incident trigger rules

KafuOps should not analyze every warning. It should create an incident only when configured triggers match.

Example:

```yaml
triggers:
  create_incident_when:
    - type: uncaught_exception
    - type: http_5xx_rate
      threshold: 5
      window_seconds: 300
    - type: repeated_stacktrace
      count: 3
      window_seconds: 120
    - type: alert_webhook
      severities: [critical, high]
```

## Step 6: LLM provider

Questions:

```text
Provider: OpenAI / Azure OpenAI / local / other
Model for analysis:
Model for code editing:
Use structured JSON outputs? yes
```

Generated config:

```yaml
llm:
  provider: openai
  trigger_mode: incident_only
  models:
    analysis: gpt-5.5-pro
    patch: gpt-5.5-pro
  structured_outputs: true
  max_context_files: 30
  max_log_excerpt_chars: 12000
```

## Step 7: Privacy defaults

The wizard should show this message:

```text
KafuOps will not send continuous logs to the model.
It will only send sanitized incident packets after an incident trigger.
You can inspect every model context bundle in .kafuops/audit/.
```

Generated config:

```yaml
privacy:
  redact_before_storage: true
  redact_before_llm: true
  audit_model_context: true
  send_full_logs_to_llm: false
  send_full_repo_to_llm: false
  require_allowlist_for_sensitive_paths: true
```

## Step 8: Redaction rules

Default patterns:

```yaml
redaction:
  enabled: true
  patterns:
    - name: email
      regex: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
      replace_with: '[REDACTED_EMAIL]'
    - name: bearer_token
      regex: 'Bearer\s+[A-Za-z0-9._\-]+'
      replace_with: 'Bearer [REDACTED_TOKEN]'
    - name: api_key
      regex: '(api[_-]?key|secret|token)=([^\s&]+)'
      replace_with: '\1=[REDACTED_SECRET]'
```

## Step 9: Tests and sandbox

Questions:

```text
Test command: npm test
Targeted test command: npm test -- {file}
Install command: npm ci
Sandbox type: local / docker
```

Generated config:

```yaml
sandbox:
  type: docker
  image: node:22
  install_command: npm ci
  test_command: npm test
  targeted_test_command: npm test -- {test_file}
```

## Step 10: MR/PR template

Generated config:

```yaml
merge_request:
  title_template: '[KafuOps] Fix {incident_summary}'
  include:
    evidence_packet: true
    root_cause: true
    files_inspected: true
    tests_run: true
    confidence_score: true
    blast_radius: true
    grounding_manifest: true
```

## Final generated file

After setup, users should see:

```text
Created .kafuops.yml
Created .kafuops/memory/
Created .kafuops/policies/default.yml
Created .kafuops/audit/

Next:
  kafuops doctor
  kafuops scan
  kafuops run -- <your backend command>
```
