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

Public releases are never cut from an unreviewed local commit. Prepare the
version on a release branch:

```bash
npm version patch --no-git-tag-version   # or: minor | major
npm run verify:full
```

Commit `package.json` and `package-lock.json`, open a pull request, and wait for
the required `PR Gate`. After that pull request is merged, update local `main`,
confirm the intended version, and tag that exact merged commit:

```bash
git switch main
git pull --ff-only
version="$(node -p "require('./package.json').version")"
git tag "v${version}"
git push origin "v${version}"
```

The workflow rejects a tag unless it exactly matches `package.json` and points
to a commit reachable from `main`. Never move a failed tag; fix forward, bump
again through a pull request, and create a new tag.

The tag run performs source/coverage/security gates, builds all platforms once,
tests the exact Chrome ZIP, runs authenticated clean-stack integration, compiles
both Safari targets, and assembles `release-candidate` with a manifest tying all
three ZIP checksums to the version and Git commit. Publishers download and
re-verify that same candidate; they never rebuild it.

Public publishing additionally requires all of the following:

- repository variable `RELEASES_ENABLED=true`;
- every release gate green;
- the complete credential set for all stores;
- approval in the protected `production` environment.

Keep `RELEASES_ENABLED` absent or false while the release system is being
commissioned. A manual `workflow_dispatch` builds and validates a candidate but
cannot publish it, which is the safe dry run.

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

Every API-calling build must also be visible in the API usage ledger. Before
shipping, verify the candidate sends its API version, manifest/app version, and
platform headers and that staging records the tuple in `api_client_usage`.
Changing an existing API contract in place is prohibited; follow the version
lifecycle and evidence gates in [sync-api.md](sync-api.md#api-lifecycle-rules).

## One-time CI setup

Configure the GitHub `production` environment with required reviewers, prevent
self-review when another maintainer is available, and restrict deployment to
`main` and protected release tags. Store credentials belong in that
environment, not as broadly available repository secrets. The protected
readiness job fails before any publishing if even one required store value is
incomplete. Add these values under Settings → Environments → production:

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
