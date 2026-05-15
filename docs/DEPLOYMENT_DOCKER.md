# Docker Deployment

This page describes a Docker Compose style deployment.

## Example compose file

```yaml
services:
  api:
    image: your-api:latest
    environment:
      - NODE_ENV=production
    logging:
      driver: json-file

  kafuops-agent:
    image: kafuops/agent:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./kafuops:/kafuops
    environment:
      - KAFUOPS_CONFIG=/kafuops/.kafuops.yml

  kafuops-worker:
    image: kafuops/worker:latest
    volumes:
      - ./repo:/workspace/repo
      - ./kafuops:/kafuops
    environment:
      - KAFUOPS_CONFIG=/kafuops/.kafuops.yml
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - KAFUOPS_GIT_TOKEN=${KAFUOPS_GIT_TOKEN}

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_DB=kafuops
      - POSTGRES_USER=kafuops
      - POSTGRES_PASSWORD=kafuops
```

## Runtime log capture

The agent can observe container logs through Docker APIs or mounted log files.

## Patch sandbox

The worker should apply patches in an isolated workspace, not inside the running production container.

## Recommended production safety

- Mount source repository read-only until patch workspace is created.
- Use short-lived Git tokens.
- Disable auto-merge.
- Store audit logs in persistent storage.
