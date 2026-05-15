# Integrations

KafuOps is designed to work with existing tools.

## Categories

```text
Git providers
Observability platforms
Alerting systems
Runtime telemetry
LLM providers
CI/test systems
Issue trackers
```

## Git providers

- GitHub.
- GitLab.
- Future: Bitbucket, Gitea, Forgejo.

## Observability sources

- OpenTelemetry.
- Sentry.
- Datadog.
- Prometheus Alertmanager.
- Grafana webhooks.
- CloudWatch alarms.
- New Relic alerts.
- Custom webhooks.

## LLM providers

- OpenAI.
- Azure OpenAI.
- Local model provider.
- Other compatible APIs.

## CI systems

KafuOps can either run tests inside its sandbox or trigger external CI.

Potential integrations:

- GitHub Actions.
- GitLab CI.
- Jenkins.
- Buildkite.
- CircleCI.

## Integration strategy

KafuOps should not require teams to replace their existing stack.

Positioning:

```text
Keep your observability tools. KafuOps adds the incident-to-MR layer.
```
