# GitHub Integration

KafuOps can create branches and pull requests in GitHub repositories.

## Required permissions

A GitHub token should be scoped to:

- Read repository contents.
- Create branches.
- Create pull requests.
- Comment on pull requests.
- Read pull request review comments.

Avoid broad organization-wide tokens when possible.

## Configuration

```yaml
repo:
  provider: github
  url: git@github.com:org/api-service.git
  default_branch: main
  mr:
    enabled: true
    auto_create: true
    auto_merge: false
```

## Environment variable

```bash
KAFUOPS_GIT_TOKEN=...
```

## PR behavior

KafuOps should:

- Create a branch.
- Push patch and test changes.
- Open a pull request.
- Add labels.
- Add evidence packet to body.
- Update project memory after review.
