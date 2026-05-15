# Troubleshooting

## `kafuops doctor` fails Git access

Check:

- `KAFUOPS_GIT_TOKEN` is set.
- Token has repository read/write access.
- Repository URL is correct.
- SSH keys or HTTPS token are configured.

## No incidents are created

Check:

- Runtime mode is running.
- Log source is configured.
- Trigger thresholds are not too strict.
- Environment is included in policy.
- Error severity is high enough.

Run:

```bash
kafuops simulate error --type stacktrace --service api
```

## Too many incidents are created

Adjust:

```yaml
noise_control:
  dedupe_window_seconds: 900
  max_incidents_per_service_per_hour: 5
```

Add ignore rules:

```yaml
noise_control:
  ignore:
    - route: GET /health
    - route: GET /metrics
```

## Model is not called

Check:

- Incident was created.
- Redaction succeeded.
- LLM provider is configured.
- Policy allows model calls.
- `llm.trigger_mode` is `incident_only` or manual analysis was requested.

## MR is not created

Possible reasons:

- Confidence below threshold.
- Patch failed to apply.
- Tests failed.
- Policy blocked file modification.
- Git token lacks permissions.
- Incident classification was not `code_bug`.

Run:

```bash
kafuops policies explain --incident inc_123
```

## Tests fail in sandbox

Check:

- Install command is correct.
- Test command is correct.
- Docker image has required runtime.
- Dependencies are available.
- Private package registry credentials are mounted safely.

## Redaction blocks analysis

This is expected if sensitive content cannot be safely removed.

Review:

```bash
kafuops audit show <incident-id>
```

Then update redaction rules if needed.
