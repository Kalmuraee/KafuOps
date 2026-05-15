# KafuOps Landing Page

## Hero

### Turn backend incidents into evidence-backed merge requests

KafuOps is an open-source production-debugging agent. It observes your backend, understands your repository, learns your architecture, and creates reviewable fixes when production errors happen.

**No continuous log streaming to AI. No blind code changes. No auto-merge by default.**

CTA buttons:

```text
Get started
View on GitHub
Read the docs
```

## Hero subcopy

Your observability stack tells you something broke. KafuOps helps you understand why, selects the right code context, generates a regression test, proposes a fix, and opens a GitHub PR or GitLab MR with evidence.

## How it works

```text
Observe error
  -> build incident
  -> select relevant context
  -> call LLM safely
  -> generate test and patch
  -> run validation
  -> open MR
  -> update project memory
```

## Key features

### Incident-triggered AI

KafuOps does not send all logs to the model. It waits for meaningful incidents, then sends only sanitized evidence and relevant files.

### Living project memory

KafuOps creates `.kafuops/memory/`, a living map of your backend architecture, services, routes, queues, data models, tests, and production incident history.

### Evidence-backed MRs

Every generated MR includes root cause, production evidence, files inspected, tests run, confidence score, blast radius, and grounding manifest.

### Works with your stack

Use OpenTelemetry, Sentry, Datadog, Prometheus Alertmanager, stdout logs, GitHub, GitLab, Docker, and Kubernetes.

### Built for review

KafuOps opens MRs for humans to review. Auto-merge is off by default.

## Product screenshot placeholder

```text
[Dashboard]
Incident: Checkout 500 error
Root cause: Missing default payment method guard
Confidence: 84
MR: !482 opened
Tests: passed
Blast radius: low
```

## Why KafuOps

Most tools either observe production or write code. KafuOps connects both sides with memory, evidence, and reviewable automation.

## CTA

```text
Start with kafuops init
```
