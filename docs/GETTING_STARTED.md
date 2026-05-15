# Getting Started

This guide shows how to install KafuOps, connect it to a backend repository, and run it in local incident-detection mode.

## Requirements

- A backend repository using Git.
- A GitHub or GitLab account/token with permission to create branches and MRs/PRs.
- An OpenAI API key or compatible model provider key.
- A test command that can run locally or inside a container.
- Optional: OpenTelemetry, Sentry, Datadog, Prometheus Alertmanager, or another alert source.

## Install

```bash
npm install -g kafuops
```

Alternative future package formats:

```bash
brew install kafuops
curl -fsSL https://kafuops.dev/install.sh | sh
```

## Initialize a repository

From the backend repository root:

```bash
kafuops init
```

The setup wizard creates:

```text
.kafuops.yml
.kafuops/
  memory/
  policies/
  incidents/
  audit/
```

## Scan the codebase

```bash
kafuops scan
```

This builds the first project memory:

```text
.kafuops/memory/project.md
.kafuops/memory/architecture.md
.kafuops/memory/routes.md
.kafuops/memory/services.md
.kafuops/memory/data.md
.kafuops/memory/tests.md
```

## Run locally with your backend

```bash
kafuops run -- npm run dev
```

KafuOps will:

- Start your backend command.
- Capture stdout/stderr locally.
- Watch for stack traces, process crashes, and configured error patterns.
- Maintain a rolling log buffer.
- Trigger analysis only when an error becomes an incident.

## Production-like mode

Production should usually use sidecar mode:

```bash
kafuops agent start --config .kafuops.yml
kafuops worker start --config .kafuops.yml
```

The agent receives runtime telemetry. The worker handles repository scanning, model calls, sandboxed patching, test execution, and MR creation.

## First incident test

You can simulate an incident:

```bash
kafuops simulate error --type stacktrace --service api
```

Then inspect:

```bash
kafuops incidents list
kafuops incidents show <incident-id>
kafuops incidents analyze <incident-id>
```

## Next steps

- Configure your [setup wizard](SETUP_WIZARD.md).
- Choose a [runtime mode](RUNTIME_MODES.md).
- Review [security and privacy](SECURITY_PRIVACY.md).
- Configure [policies](POLICIES.md) before enabling automatic MR creation.
