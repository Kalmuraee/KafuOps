# KafuOps Product Brief

## One-line description

KafuOps is an open-source production-debugging agent that turns backend incidents into evidence-backed merge requests.

## Problem

Backend teams already have logs, traces, alerts, and issue trackers. The hard part is not seeing that something broke. The hard part is connecting production evidence to the right source files, understanding the architecture, reproducing the bug, and creating a safe fix.

Existing coding agents usually start from a human-written issue. Existing observability systems usually stop at root-cause hints. KafuOps sits between them.

## Target users

- Backend engineers responsible for production services.
- SREs who want faster incident triage.
- Platform teams building internal developer tooling.
- Small teams without dedicated on-call debugging infrastructure.
- Self-hosted or GitLab-heavy organizations that want control over source code and logs.

## Core promise

When production breaks, KafuOps creates a focused engineering response:

1. What happened?
2. Which service, route, file, dependency, or deploy caused it?
3. What evidence supports that conclusion?
4. What code should change?
5. What test proves the fix?
6. What is the blast radius?
7. What MR should a human review?

## Differentiation

KafuOps is not just an AI coding agent. It is an observability-aware debugging layer.

Unique features:

- Living project memory generated from repo structure and real incidents.
- Incident-triggered LLM calls instead of continuous log upload.
- Grounding manifest showing exactly what files and log snippets were sent to the model.
- Regression-test-first fix workflow.
- Blast-radius analysis for every generated MR.
- GitHub and GitLab support from the start.
- Self-hosted-friendly architecture.
- Runtime modes for local, Docker, Kubernetes, and webhook-only setups.
- Review feedback loop that updates project memory.

## Non-goals

KafuOps should not:

- Auto-merge production fixes by default.
- Replace existing observability tools.
- Upload complete logs or full repositories to an LLM by default.
- Act as a general-purpose chatbot over the codebase.
- Modify high-risk files without explicit policy approval.

## MVP success criteria

The first useful version should:

- Connect to one Git provider, preferably GitLab or GitHub.
- Connect to one runtime source, such as stdout/stderr logs or OpenTelemetry.
- Build a project memory file tree and architecture summary.
- Detect an error event and create an incident.
- Select relevant files from stack traces and architecture graph.
- Call the OpenAI API with a sanitized context bundle.
- Generate a small patch and regression test.
- Run tests in a sandbox.
- Open an MR/PR with evidence and confidence score.

## Suggested initial niche

Start with **Node.js / TypeScript backends** because stack traces, route handlers, test frameworks, and dependency graphs are straightforward to analyze. Add Python and Java later.
