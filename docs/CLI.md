# CLI Reference

The KafuOps CLI manages setup, scanning, runtime monitoring, incidents, and MR creation.

## Initialize

```bash
kafuops init
```

Starts the setup wizard.

## Doctor

```bash
kafuops doctor
```

Checks config, Git access, model access, sandbox settings, and policies.

## Scan

```bash
kafuops scan
```

Builds project memory and architecture graph.

Options:

```bash
kafuops scan --full
kafuops scan --memory-only
kafuops scan --graph-only
kafuops scan --write
```

## Run backend in wrapper mode

```bash
kafuops run -- npm run dev
```

Captures stdout/stderr and runtime errors from a child process.

Options:

```bash
kafuops run --service api -- npm start
kafuops run --env staging -- python -m uvicorn app.main:app
```

## Start agent

```bash
kafuops agent start --config .kafuops.yml
```

Starts sidecar/agent mode.

## Start worker

```bash
kafuops worker start             # poll every 30s
kafuops worker start --interval 60
kafuops worker start --once      # process pending incidents once, then exit
```

The worker drives every pending incident (`created`/`context_built`/`analyzed`)
through analyse → patch → validate → MR automatically, respecting policy,
confidence, and `llm.trigger_mode` (it runs with `invocation=auto`, so
`manual_only` keeps it in dry-run).

## Incidents

```bash
kafuops incidents list
kafuops incidents show inc_123
kafuops incidents analyze inc_123
kafuops incidents build-context inc_123
kafuops incidents open-mr inc_123
kafuops incidents mark-resolved inc_123
kafuops incidents mark-merged inc_123 --note "approved by on-call"
kafuops incidents mark-rejected inc_123 --note "masked the real bug"
```

`mark-merged` / `mark-rejected` record the reviewer's decision in
`.kafuops/memory/review-feedback.md`, which is fed back into future analyses.

## Update

```bash
kafuops update            # check the npm registry and install the latest
kafuops update --print    # just show the install command, don't run it
kafuops update --pm pnpm  # use pnpm/yarn/bun instead of npm
```

KafuOps also checks for a new version in the background (at most once a day) and,
if one exists, prints a small "Update available" notice after a command. The
check is non-blocking, cached per-user in `~/.kafuops/update-check.json`, and
silently skipped on failure. Disable it with `KAFUOPS_NO_UPDATE_CHECK=1` (it's
also off in CI and non-interactive shells).

## Deploy markers

```bash
kafuops deploy v1.4.2 --commit "$(git rev-parse HEAD)"
```

Records a deploy. Error-level events arriving within the `deployment_regression`
window are then correlated to that release (call it from CI after a deploy).

## Status / watch

```bash
kafuops status              # dashboard: incident counts, recent list, mode/provider
kafuops watch               # live-refreshing dashboard (Ctrl-C to stop)
kafuops watch --interval 10
```

Set `KAFUOPS_LOG_FORMAT=json` for structured single-line JSON logs (useful for
agents / Kubernetes log pipelines).

## Eval (fix quality)

```bash
kafuops eval
```

Runs a seeded suite of buggy fixtures through the full pipeline against your
configured provider and reports the **fix-success rate**, average patch attempts
(the self-correcting loop), and confidence calibration. Run it with a real
provider/key to measure quality; in dry-run it reports ~0% (no real model calls).

## Simulate errors

```bash
kafuops simulate error --type stacktrace --service api
kafuops simulate alert --severity critical
```

## Memory

```bash
kafuops memory show
kafuops memory update
kafuops memory validate
kafuops memory diff
```

## Policies

```bash
kafuops policies validate
kafuops policies explain --file src/auth/session.ts
kafuops policies explain --incident inc_123   # decisions for the files the incident's patch changed
```

## Audit

```bash
kafuops audit list
kafuops audit show <model-call-id>
kafuops audit export --incident inc_123
```

## Webhooks

```bash
kafuops webhooks start
kafuops webhooks test sentry
kafuops webhooks test alertmanager
```
