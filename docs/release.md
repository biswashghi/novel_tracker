# Release runbook

## Versioning

One version number, `package.json`'s `version` (semver), is the release
identity across all four stores — Chrome and Firefox each get it as their
`manifest.json` version, and both Safari targets (macOS, iOS) get it as
`MARKETING_VERSION`. All of that is derived automatically by `build.mjs`
and `package-safari.sh`; never hand-edit a version field in a generated
manifest or Xcode project directly.

Apple additionally needs a *build number* (`CURRENT_PROJECT_VERSION`),
which `package-safari.sh` sets to `git rev-list --count HEAD` — independent
of the marketing version, and always increasing. Chrome and Firefox don't
have an equivalent concept: each only requires its single version string to
be new and strictly increasing, which a `package.json` bump already
guarantees on its own. Apple's App Store Connect instead requires
uniqueness on the *pair* (marketing version, build number) — and TestFlight
specifically expects you to upload multiple builds under one
still-unreleased marketing version while iterating on beta feedback, only
the build number changing between those uploads. That same marketing
version then carries through unchanged to the eventual App Store
submission — there's no separate beta-version scheme, just the ordinary
`package.json` version plus a build number that happens to change more
often. See [AGENTS.md](../AGENTS.md) for the fuller rationale.

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
| Safari | `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_P8`, `APPSTORE_CERTIFICATES_FILE_BASE64`, `APPSTORE_CERTIFICATES_PASSWORD` | [safari.md](release/safari.md) |

## Platform-specific steps

Manual verification and store-listing steps that can't be automated are
split into the following documents:

- [Chrome / Edge release](release/chrome.md)
- [Firefox release](release/firefox.md)
- [Safari release](release/safari.md)
