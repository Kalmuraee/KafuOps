# Releasing KafuOps to npm

The package is published as [`kafuops`](https://www.npmjs.com/package/kafuops).

## One-time setup — Trusted Publishing (OIDC, no token)

Releases publish via npm **Trusted Publishing**: GitHub Actions authenticates to
npm over OIDC, so there is **no `NPM_TOKEN` secret** to manage and it satisfies
the package's "require two-factor authentication" policy (which rejects
automation tokens).

Configure it once on npmjs.com (log in with your passkey):

1. npmjs.com → package **`kafuops`** → **Settings** → **Trusted Publisher**.
2. Provider **GitHub Actions**, Organization/repo **`Kalmuraee/KafuOps`**,
   Workflow filename **`release.yml`** (leave environment blank). Save.

The workflow already requests `id-token: write` and upgrades npm to a version
that supports OIDC (>= 11.5.1).

## Cutting a release (CI — recommended)

```bash
# 1. bump the version (commits + creates the v<x.y.z> tag)
npm version patch     # or: minor / major

# 2. push the commit and the tag
git push && git push --tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds,
tests, verifies the tag matches `package.json`, runs
`npm publish --provenance --access public` (the provenance attestation links the
npm package to the exact GitHub commit + build), and creates a matching
**GitHub Release** with auto-generated notes.

> No token is used. If you ever see `403 ... an automation token was specified`,
> the Trusted Publisher above isn't configured (or the workflow filename doesn't
> match) — fix the npmjs.com setting; don't add a token.

## Container images (Docker)

The same `v*` tag also builds a multi-arch (amd64 + arm64) image via the
**`docker`** job in `release.yml`, tagged `:<version>`, `:<major>.<minor>`, and
`:latest`.

- **GHCR** — `ghcr.io/kalmuraee/kafuops` pushes automatically with the built-in
  `GITHUB_TOKEN`; **no setup needed**. This is what the k8s/Helm manifests use.
- **Docker Hub** — `docker.io/kalmuraee/kafuops` pushes **only if** you add two
  repo secrets (Settings → Secrets and variables → Actions):
  - `DOCKERHUB_USERNAME` — your Docker Hub username
  - `DOCKERHUB_TOKEN` — a Docker Hub **access token** (Account → Security → New
    Access Token, Read/Write)

  If those aren't set, the job logs a warning and pushes to GHCR only — the
  release does **not** fail.

**One-time, after the first GHCR push:** the package starts **private**. Make it
public at
`github.com/users/Kalmuraee/packages/container/kafuops/settings` → *Change
visibility* → Public, so `docker pull` works without auth.

```bash
docker pull ghcr.io/kalmuraee/kafuops:latest      # or kalmuraee/kafuops:latest (Docker Hub)
docker run --rm ghcr.io/kalmuraee/kafuops:latest --help
```

## Publishing manually (no CI)

```bash
npm login            # or: npm config set //registry.npmjs.org/:_authToken <token>
npm whoami           # confirm you're authenticated
npm run build        # also runs via prepublishOnly
npm publish          # publishConfig.access=public, so no --access flag needed
```

Use `npm pack --dry-run` first to inspect exactly what ships (only
`bin/ dist/ README.md LICENSE`).

## After the first publish

`kafuops update` and the background "Update available" notice start working
automatically — they query `https://registry.npmjs.org/kafuops/latest`. No code
change needed.
