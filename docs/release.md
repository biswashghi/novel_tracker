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

Pushing the tag runs `.github/workflows/release.yml`'s test and authenticated
staging checks, then builds and uploads Chrome, Firefox, and Safari packages.
Each store publishes independently, so a packaging or credential failure for
one store does not block the others. To dry-run packaging without publishing, use
`workflow_dispatch` with `publish_to_stores` left `false`.

## Backend and store rollout compatibility

Store approvals and automatic updates lag behind the server deployment. Treat
the version currently available in each public store as a supported production
client, even after newer source has reached `main`.

For a change that affects both the API and an extension:

1. Deploy an additive, backward-compatible server change first. It must still
   accept requests from every currently published extension version.
2. Publish the extension update and verify the signed store build against
   production.
3. Wait for store approval and sufficient client adoption before removing old
   server behavior in a later release.

If the client has to ship first, it must support both the old and new server
behavior. Do not use a server deployment to force an immediate store-client
upgrade; users do not control store review and update timing.

A failed release tag is immutable history. Fix the cause on `main`, bump to a
new version, and publish a new tag rather than moving or rerunning the old tag.

## One-time CI setup

The `publish-chrome`, `publish-firefox`, and `publish-safari` jobs in
`release.yml` each skip themselves automatically (via the `check-secrets`
job) if that store's secrets aren't configured on the repo. A given store's
publish step is a no-op until its secrets exist.
Add them once under Settings → Secrets and variables → Actions:

| Store | Secrets | One-time setup |
| --- | --- | --- |
| Chrome | `CHROME_WEB_STORE_EXTENSION_ID`, `CHROME_WEB_STORE_CLIENT_ID`, `CHROME_WEB_STORE_CLIENT_SECRET`, `CHROME_WEB_STORE_REFRESH_TOKEN` | [chrome.md](release/chrome.md#one-time-ci-publishing-setup) |
| Firefox | `AMO_API_KEY`, `AMO_API_SECRET` | [firefox.md](release/firefox.md#one-time-ci-publishing-setup) |
| Safari | `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_P8`, `APPSTORE_CERTIFICATES_FILE_BASE64`, `APPSTORE_CERTIFICATES_PASSWORD`, `APPSTORE_INSTALLER_CERTIFICATES_FILE_BASE64`; optional `APPSTORE_INSTALLER_CERTIFICATES_PASSWORD` when the installer export uses a different password | [safari.md](release/safari.md) |

## Platform-specific steps

Manual verification and store-listing steps that can't be automated are
split into the following documents:

- [Chrome / Edge release](release/chrome.md)
- [Firefox release](release/firefox.md)
- [Safari release](release/safari.md)
