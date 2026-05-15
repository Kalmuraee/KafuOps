# Security Policy

KafuOps may process source code, logs, traces, and production metadata. Security reports are important.

## Reporting vulnerabilities

Please report security issues **privately** via GitHub Security Advisories on
this repository:

> [Report a vulnerability →](https://github.com/Kalmuraee/KafuOps/security/advisories/new)

We aim to acknowledge new reports within 72 hours.

Do not file a public issue, open a pull request that mentions the vulnerability,
or post in discussions before maintainers have had a chance to respond.

## Sensitive areas

Please report issues involving:

- Secret leakage.
- Redaction bypass.
- Prompt-injection vulnerabilities.
- Unauthorized file access.
- Unsafe model output execution.
- Git token misuse.
- Webhook signature bypass.
- Sandbox escape.
- Incorrect policy enforcement.

## Security principles

- No continuous log upload to models.
- No full repo upload by default.
- Redact before model calls.
- Audit every model call.
- Treat runtime data as untrusted.
- Never auto-merge by default.
