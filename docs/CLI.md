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
kafuops worker start --config .kafuops.yml
```

Starts the analysis and patch generation worker.

## Incidents

```bash
kafuops incidents list
kafuops incidents show inc_123
kafuops incidents analyze inc_123
kafuops incidents build-context inc_123
kafuops incidents open-mr inc_123
kafuops incidents mark-resolved inc_123
```

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
