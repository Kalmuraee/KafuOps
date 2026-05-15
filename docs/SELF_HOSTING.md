# Self-Hosting

KafuOps should be self-hosted friendly.

## Recommended components

```text
kafuops-agent      observes runtime signals
kafuops-worker     analyzes incidents and creates patches
kafuops-api        receives webhooks and serves dashboard/API
kafuops-storage    stores incidents, audits, and memory metadata
```

## Minimal local deployment

```bash
kafuops agent start --config .kafuops.yml
kafuops worker start --config .kafuops.yml
```

## Docker Compose deployment

See [Docker deployment](DEPLOYMENT_DOCKER.md).

## Kubernetes deployment

See [Kubernetes deployment](DEPLOYMENT_KUBERNETES.md).

## Storage

MVP storage options:

- Local filesystem.
- SQLite.
- PostgreSQL.

Recommended:

```yaml
storage:
  type: postgres
  url: ${KAFUOPS_STORAGE_URL}
```

## Network controls

For sensitive environments:

- Restrict outbound model-provider access.
- Restrict Git provider token permissions.
- Run patch sandbox in isolated network mode.
- Keep audit logs inside the company network.

## Secrets

Use environment variables or a secret manager:

```bash
OPENAI_API_KEY=...
KAFUOPS_GIT_TOKEN=...
KAFUOPS_WEBHOOK_SECRET=...
```
