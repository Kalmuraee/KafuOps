# Contributing to KafuOps

Thank you for contributing.

## Good first contribution areas

- Documentation improvements.
- Framework scanners.
- Redaction patterns.
- Integration examples.
- CLI commands.
- Test fixtures.
- Policy examples.

## Development workflow

```bash
git clone <repo>
cd kafuops
npm install
npm test
```

## Contribution principles

- Prefer safe defaults.
- Do not add behavior that sends more data to models without explicit config.
- Keep generated MRs reviewable.
- Add tests for incident detection, redaction, and policy decisions.
- Treat logs and user data as untrusted.

## Pull request checklist

- [ ] Tests added or updated.
- [ ] Documentation updated.
- [ ] Redaction/privacy impact considered.
- [ ] Policy behavior considered.
- [ ] No secrets or private data included.
