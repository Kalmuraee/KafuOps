# Releasing KafuOps to npm

The package name is `kafuops` (currently unpublished — the in-app update check
404s until the first publish lands).

## One-time setup

Add an npm **automation token** as a repository secret so CI can publish:

1. npm → Account → Access Tokens → **Generate** → *Automation* (or a granular
   token scoped to publish `kafuops`).
2. GitHub → repo → Settings → Secrets and variables → Actions →
   **New repository secret** → name `NPM_TOKEN`, value = the token.

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

> The `NPM_TOKEN` must be an **Automation** token (classic Automation or a
> granular token). A classic *Publish* token still requires an OTP and will fail
> in CI with `EOTP`.

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
