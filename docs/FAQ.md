# FAQ

## Does KafuOps send all logs to the LLM?

No. KafuOps keeps a local rolling buffer and only sends a small sanitized incident packet after an incident trigger.

## Does KafuOps send the full repository?

No, not by default. It selects relevant files using stack traces, architecture graph, project memory, and test mappings.

## Does KafuOps auto-merge fixes?

No. Auto-merge is OFF by default (repo.mr.auto_merge=false); KafuOps opens reviewable MRs/PRs. Turning it on only ever merges after the policy + confidence gates pass.

## Should KafuOps run the backend inside itself?

For production, no. The recommended default is sidecar/agent mode. For local development and staging, `kafuops run -- <command>` is useful.

## What happens if the issue is not a code bug?

When root-cause analysis sets should_attempt_fix=false (e.g. a missing env var or third-party outage), KafuOps records the analysis and skips the code MR. Examples include missing environment variables, third-party outages, data issues, and infrastructure problems.

## Can KafuOps work with GitLab?

Yes — GitHub (Octokit) and GitLab (REST) are both first-class, selectable via repo.provider.

## Can KafuOps be self-hosted?

Yes. The design supports self-hosted agents, workers, storage, and audit logs.

## Can I review what was sent to the model?

Yes. KafuOps writes a grounding manifest and an audit record (.kafuops/audit/) for every model call — exactly what files/bytes were sent, which redaction patterns matched, and what was excluded.

## What if the model proposes a dangerous change?

Policies block denied files and high-risk modifications. The patch is applied in a sandbox and opened for human review only if policy allows.

## What if logs contain prompt injection?

KafuOps wraps logs/traces/file content as untrusted data and instructs the model not to follow embedded instructions. The wrapping invariant is verified by an adversarial fuzz-test suite (tests/prompt-injection-fuzz.test.ts).
