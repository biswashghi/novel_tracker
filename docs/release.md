# Release runbook

## Cutting a release

Every build/package script reads its version from `package.json`, and
`.github/workflows/release.yml` triggers on `v*`/`*.*.*` tags, so bumping the
version and pushing the tag is the one step that drives everything else:

```bash
npm version patch   # or: minor | major
git push --follow-tags
```

That's the single source of truth for the version — don't hand-edit
`package.json`'s version separately from tagging a release.

Pushing the tag runs `.github/workflows/release.yml`'s `test` job (unit
tests only — the Docker-backed e2e suite in `tests/e2e/` is local-only, see
[testing-locally.md](testing-locally.md)), then builds and uploads
Chrome/Firefox/Safari packages, then publishes to all three stores
automatically. To dry-run packaging without publishing, use
`workflow_dispatch` with `publish_to_stores` left `false`.

## One-time CI setup

The `publish` and `publish-safari` jobs in `release.yml` each skip
themselves automatically (via the `check-secrets` job) if their store's
secrets aren't configured on the repo — so the workflow is always safe to
run, but a given store's publish step is a no-op until its secrets exist.
Add them once under Settings → Secrets and variables → Actions:

| Store | Secrets | One-time setup |
| --- | --- | --- |
| Chrome | `CHROME_WEB_STORE_EXTENSION_ID`, `CHROME_WEB_STORE_CLIENT_ID`, `CHROME_WEB_STORE_CLIENT_SECRET`, `CHROME_WEB_STORE_REFRESH_TOKEN` | [chrome.md](release/chrome.md#one-time-ci-publishing-setup) |
| Firefox | `AMO_API_KEY`, `AMO_API_SECRET` | [firefox.md](release/firefox.md#one-time-ci-publishing-setup) |
| Safari | `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_P8` | [safari.md](release/safari.md) |

## Platform-specific steps

Manual verification and store-listing steps that can't be automated are
split into the following documents:

- [Chrome / Edge release](release/chrome.md)
- [Firefox release](release/firefox.md)
- [Safari release](release/safari.md)

