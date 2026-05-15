# FAQ

## Does KafuOps send all logs to the LLM?

No. KafuOps keeps a local rolling buffer and only sends a small sanitized incident packet after an incident trigger.

## Does KafuOps send the full repository?

No, not by default. It selects relevant files using stack traces, architecture graph, project memory, and test mappings.

## Does KafuOps auto-merge fixes?

No. Auto-merge should be disabled by default. KafuOps opens reviewable MRs/PRs.

## Should KafuOps run the backend inside itself?

For production, no. The recommended default is sidecar/agent mode. For local development and staging, `kafuops run -- <command>` is useful.

## What happens if the issue is not a code bug?

KafuOps should create an incident report instead of a code MR. Examples include missing environment variables, third-party outages, data issues, and infrastructure problems.

## Can KafuOps work with GitLab?

Yes. GitLab support should be a first-class feature.

## Can KafuOps be self-hosted?

Yes. The design supports self-hosted agents, workers, storage, and audit logs.

## Can I review what was sent to the model?

Yes. KafuOps should create a grounding manifest and audit record for every model call.

## What if the model proposes a dangerous change?

Policies block denied files and high-risk modifications. The patch is applied in a sandbox and opened for human review only if policy allows.

## What if logs contain prompt injection?

KafuOps treats logs as untrusted data, not instructions. Prompt-injection safety is part of the design.
