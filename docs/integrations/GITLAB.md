# GitLab Integration

KafuOps should support GitLab merge requests from the beginning.

This is an important product wedge because many backend and platform teams use GitLab for self-hosted or enterprise workflows.

## Required permissions

A GitLab token should be able to:

- Read repository contents.
- Create branches.
- Push commits.
- Create merge requests.
- Comment on merge requests.
- Read review comments.

## Configuration

```yaml
repo:
  provider: gitlab
  url: git@gitlab.com:org/api-service.git
  default_branch: main
  mr:
    enabled: true
    auto_create: true
    auto_merge: false
    branch_prefix: kafuops/fix
```

## Environment variable

```bash
KAFUOPS_GIT_TOKEN=...
```

## MR behavior

KafuOps should:

- Create a branch from the default branch.
- Commit the fix and tests.
- Push branch.
- Open a merge request.
- Add labels.
- Include evidence packet.
- Include confidence score and blast-radius analysis.
- Read reviewer feedback and update memory.

## Self-hosted GitLab

Support:

```yaml
repo:
  provider: gitlab
  base_url: https://gitlab.company.com
```
