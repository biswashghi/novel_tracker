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

A release is a version bump merged to `main`. Bump it in the pull request
that carries the change (or in its own pull request when batching):

```bash
npm version patch --no-git-tag-version   # or: minor | major
```

The same pull request adds the version's release plan in
`docs/release/notes/<version>/`; the `PR Gate` fails without it:

| File | Used for |
|---|---|
| `app-store-ios.txt` | "What's New" for iPhone and iPad |
| `app-store-mac.txt` | "What's New" for the Mac |
| `firefox.txt` | Release notes on the Firefox Add-ons version |
| `chrome.txt` (optional) | Text to paste into the Chrome listing; the release summary shows it |
| `release.json` (optional) | `{ "apple": "testflight" }` to stop at TestFlight; `{ "screenshots": true \| false }` to always or never replace store screenshots |

Keep each file under 4,000 characters (the App Store's limit), written for
readers rather than for the code. `scripts/release-plan.mjs` checks them.

Commit `package.json` and `package-lock.json` with the rest of the change and
merge through the usual `PR Gate`. Nothing else is run by hand: `.github/
workflows/release.yml` runs on every push to `main`, does nothing while the
version already has a `v<version>` tag, and otherwise:

1. builds and validates the Chrome, Firefox, and Safari packages;
2. binds all three ZIPs to the version and commit in `release-manifest.json`;
3. waits for approval of the `production` GitHub environment (Actions → the
   run → *Review deployments*) — one approval covers every store;
4. publishes:
   - **Chrome Web Store**: the package goes to review (usually minutes). The
     API can't edit the listing, so the run's summary shows `chrome.txt` to
     paste in, and a `chrome-listing` artifact holds 1280×800 screenshots
     when they changed;
   - **Firefox AMO**: the package with `firefox.txt` as its release notes,
     and the listing's screenshots replaced when they changed;
   - **App Store (iOS and macOS)**: each is submitted for App Review with its
     "What's New" and screenshots (when they changed), and released
     automatically once Apple approves it. The build is on TestFlight too.
     With `{ "apple": "testflight" }` both platforms stop at TestFlight
     instead, with the notes as "What to Test";
5. creates the `v<version>` tag and a GitHub Release holding the manifest and
   the three ZIPs.

The tag is created **last**. If a publish step fails, no tag exists, so the fix
is an ordinary pull request to `main` — the same version runs again on merge.
Only if a store already accepted the version (and would now refuse it as a
duplicate) does the fix need another bump.

Every store submission is the same commit and the same `package.json`
version. There is no separate beta channel: a bump made only to get an iOS
build to TestFlight (`"apple": "testflight"`) still submits Chrome and
Firefox builds.

Screenshots come from `store-assets/app-store/{ios,ipad,macos}/` (see the
`app-store-screenshots` project skill); Firefox and Chrome use the Mac set
at 1280×800. A listing's screenshots are replaced only when its set changed
since the previous `v*` tag, since App Store Connect and AMO keep them
from one version to the next.

App Review is the one step no automation skips. A rejection is answered in
App Store Connect; until it is, that platform can't take the next version,
and its publish step fails on the next release (the other stores are
unaffected).

The API server is deployed independently; see
[operations.md](operations.md#deploy).

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

Released tags are never moved or deleted.

Every API-calling build must also be visible in the API usage ledger. Before
shipping, verify the candidate sends its API version, manifest/app version, and
platform headers and that staging records the tuple in `api_client_usage`.
Changing an existing API contract in place is prohibited; follow the version
lifecycle and evidence gates in [sync-api.md](sync-api.md#api-lifecycle-rules).

## One-time CI setup

The `production` GitHub environment needs a required reviewer and a deployment
policy allowing `main`. Store credentials are repository secrets; each
publisher script exits before contacting its store if any are missing.

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
