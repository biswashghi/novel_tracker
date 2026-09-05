# Agent notes

## Versioning

This extension ships to four stores (Chrome Web Store, Firefox AMO, Safari
macOS App Store, Safari iOS TestFlight/App Store) from one version number,
plus a separate build number Apple's ecosystem specifically needs. Don't
hand-edit version fields in any of the generated Chrome/Firefox manifests or
the Safari Xcode project — they're all derived automatically from the two
sources below.

**`package.json`'s `version`** (semver `MAJOR.MINOR.PATCH`) is the single
release identity across all four stores:

- `scripts/build.mjs` writes it into `manifest.json` for Chrome and Firefox.
- `scripts/package-safari.sh` writes it into `MARKETING_VERSION`
  (`CFBundleShortVersionString`) for both the macOS and iOS Safari targets.

Bump it with `npm version patch|minor|major`, never by hand. For a protected
release pull request, use `npm version patch|minor|major --no-git-tag-version`,
merge that reviewed change, and create the matching `vX.Y.Z` tag on the merged
`main` commit. Pushing that exact tag triggers `.github/workflows/release.yml`.
See [docs/release.md](docs/release.md) for the full guarded release runbook.

**Apple's build number** (`CURRENT_PROJECT_VERSION`) is `git rev-list
--count HEAD` — the commit count on the current branch, patched in by
`scripts/package-safari.sh` on every `npm run package:safari`. This exists
because Chrome and Firefox each only care about their single version string
being new and strictly increasing (which a `package.json` bump already
guarantees), but App Store Connect requires uniqueness on the *pair*
(`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`) — and TestFlight is
specifically designed to let you upload several builds under one
still-unreleased marketing version while iterating on beta feedback, only
bumping the build number each time. The marketing version only changes for a
new release cycle (a fresh `npm version` bump); reusing it across TestFlight
iterations of the same release is the intended Apple workflow, not something
to work around.

**Why `git rev-list --count HEAD` specifically**: deterministic (the same
commit always produces the same build number, so a TestFlight build can be
traced back to exact source) and monotonically increasing as long as history
on the branch stays linear, which holds for how this repo is worked.

**TestFlight vs. "live"**: a given release's marketing version is identical
across every distribution channel — the TestFlight build a beta tester
installs and the eventual App Store / Chrome Web Store / AMO submission for
that same release carry the same `package.json` version. Only Apple's build
number iterates in between; there's no separate "beta" version scheme to
maintain.

### PR builds

`.github/workflows/pr.yml` builds and validates all four platforms on every
PR (never publishes — no store credentials involved) with a version that's
deliberately never `package.json`'s real value, so a PR build can't be
confused with, or collide with, an actual release:

- `manifest.version` (Chrome/Firefox): `<package.json version>.<CI run
  number>`, e.g. `0.3.4.147` — has to stay in that dot-separated-integers
  form (Chrome/Firefox both reject letters or hyphens there), and the run
  number keeps every rebuild of the same PR distinct too.
- Chrome's separate free-text `version_name` field carries the
  human-readable form instead: `0.3.4-pr42`.
- Safari's `MARKETING_VERSION` gets the same `<version>.<run number>` value
  as Chrome/Firefox, for consistency.

Implemented via `--version-override`/`--version-name` flags on
`scripts/build.mjs`, threaded through `scripts/package-webstore.mjs` and
`scripts/package-firefox.mjs` (both also re-run `build.mjs` internally, so
without forwarding the override there too it would silently get discarded),
and `NOVEL_TRACKER_VERSION_OVERRIDE` for `scripts/package-safari.sh`.
Omitting all of these (the normal release path) falls back to
`package.json`'s real version exactly as before — nothing about a normal
`npm run build`/`package:safari` changed.
