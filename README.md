# Novel Tracker Extension

Novel Tracker is a local-first Manifest V3 browser extension for saving and
automatically updating web novel and light novel reading progress across chapter
sites.

It keeps a small reading library in the browser, lets readers reopen the exact
chapter where they stopped, and keeps chapter history so accidental backtracking
can be corrected.

## Features

- Save the current chapter URL from the active browser tab.
- Capture novel title, source site, chapter label, cover image URL, and reading status.
- Automatically update tracked novels when matching chapter URLs change.
- Browse, search, sort, edit, delete, and reopen novels from the library page.
- Keep a per-novel chapter history trail.
- Export and import JSON backups.
- Work without an account and keep reading data local to the browser profile.
- Optionally sign in with Google or Apple to synchronize through the Novel Tracker API.
- Resolve offline changes with deterministic HLC/remove-wins merge rules.

## Supported Site Profiles

Novel Tracker includes site-specific parsers for:

- Royal Road
- Patreon
- Wuxiaworld
- NovelBin
- ScribbleHub
- Creative Novels
- Light Novels Translations
- Shin Translations
- Chikari

Other sites fall back to generic page metadata and can still be saved manually.
NovelUpdates is useful for discovery, but it is not treated as a reading source
because it indexes releases rather than hosting chapters.

## Support

Questions, bug reports, and help with setup: see [docs/support.md](docs/support.md).

## Privacy Policy

The full privacy policy and data-handling details are maintained in the documentation: see [docs/privacy-policy.md](docs/privacy-policy.md).

## Architecture

High-level architecture, diagrams, and design rationale are in the docs: see [docs/platform-architecture.md](docs/platform-architecture.md).

## Repository Layout

```text
src/
  manifest.json               Chrome/Firefox base manifest; build.mjs rewrites per target
  popup.html / popup.js       Save the active chapter (a thin client of background.js)
  options.html / options.js   Library page: search, edit, stats, import/export, account
  background.js               Service worker: the only writer of library state
  content-script.js           Reports chapter progress from supported sites
  lib/
    extension-api.js          chrome/browser namespace shim
    parser-core.js            Shared parsing helpers for the site profiles
    page-metadata.js          Extracts title/chapter/home URL from a page
    site-parsers/             One profile per supported site (royalroad, chikari, …)
    storage.js                Library reads and mutations over the sync blob
    reading-stats.js          Streaks and chapter counts for the stats row
    sync-core.js              CRDT: HLC clocks, field-level LWW, tombstones
    sync-client.js            Transport-neutral client for /v1/sync
    sync-service.js           Sync orchestration, queues, sync status meta
    sync-policy.js            Server-side clock clamping rules
    auth.js                   OAuth PKCE sign-in, token refresh, account state
    auth-platform.js          Per-browser identity/redirect adapters
    platform-http.js          fetch, routed through native messaging on Safari
    safari-native-messaging.js
    config.js                 API/issuer endpoints, swapped for local builds
server/
  index.js                    Fastify sync API (see docs/sync-api.md)
  Dockerfile
safari-native/                Swift host app + web extension handler
infra/                        Compose stacks, Keycloak realms, backup units
scripts/
  build.mjs                   Builds dist/, dist-firefox/, dist-safari/
  package-*.mjs|.sh           Store packaging per target
  publish-*.mjs               Automated store uploads (used by CI)
  e2e-stack.mjs               Brings the local API + Keycloak stack up/down
  generate-icons.mjs, generate-store-assets.mjs, generate-appstore-screenshots.mjs
  deploy-vps.sh, backup-vps.sh, configure-keycloak.sh
tests/                        node:test unit suites (npm test)
  e2e/                        Playwright specs against the real extension
docs/                         Architecture, sync API, release, operations
```

## Development and Local Testing

Development, build, packaging, and platform-specific testing instructions (including Safari macOS and iOS) have moved to the documentation: see [docs/development.md](docs/development.md).

The server stack uses the shared Docker contract:

```bash
make local-up
make local-test
make local-down
make staging-test
make production-validate
```

Only the API is published as a Docker image. Chrome, Firefox, and Safari
packages are tested in Actions and delivered directly to their stores.

## Load Locally In Chrome Or Edge

1. Run `npm run build`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer Mode.
4. Choose `Load unpacked`.
5. Select the generated `dist/` folder.
6. After code or manifest changes, click `Reload` on the unpacked extension.

## Versioning

`package.json`'s `version` is the single release identity across all four
stores (Chrome, Firefox, Safari macOS, Safari iOS) — bump it with `npm
version patch|minor|major`, never by hand. Apple additionally needs a
separate, always-increasing build number, which is derived automatically
and never touched by hand either. See [AGENTS.md](AGENTS.md) and
[docs/release.md](docs/release.md) for the full convention and release
process.

## Release Readiness

Routine releases use the guarded process in [docs/release.md](docs/release.md):
reviewed pull request, aggregate `PR Gate`, immutable candidate artifacts,
persistent staging, manual production approval, and an explicit release kill
switch. The repository version is not a release authorization.

Before approving a public store release, confirm:

- `npm test` passes.
- `npm run build` succeeds.
- `npm run package:webstore` creates a ZIP without validation errors.
- `dist/manifest.json` version matches `package.json`.
- Icons exist at 16, 32, 48, and 128 pixels.
- Popup can save the active chapter.
- Auto-update advances a tracked novel after navigating to the next matching chapter.
- Library page can search, sort, edit, delete, open chapters, and show history.
- Export JSON downloads a backup.
- Import JSON merges a backup and skips blank entries.
- Sign in succeeds and the account row shows the signed-in email.
- A novel saved while signed in appears after a sign-out/sign-in round trip.
- Signing in on a second profile converges both libraries on the same state.
- **Delete account** removes the remote identity and synchronized data while
  leaving the local library intact.
- Sign out returns the account row to its signed-out state.
- Privacy disclosure in this README matches actual behavior.

## Initial Chrome Web Store Setup

1. Register a Chrome Web Store developer account if needed.
2. Run `npm run package:webstore` for the first manual listing setup.
3. Open the Chrome Developer Dashboard.
4. Add a new item and upload the ZIP from `release/`.
5. Fill in the Store listing:
   - Name: `Novel Tracker`
   - Summary: `Track web novel reading progress and reopen the chapter where you stopped.`
   - Category: `Productivity`
   - Language: English
   - Visibility: Public
   - Support/contact URL: GitHub repository or personal site contact page
   - Privacy policy URL: this README on GitHub
6. Complete the Privacy practices tab:
   - Disclose local handling of website URLs/page metadata used for reading progress.
   - Certify Limited Use.
   - Disclose optional account authentication and encrypted cloud synchronization.
   - State that local-only use remains available without signing in.
   - Do not claim analytics, ads, or sale/sharing of customer data.
7. Upload screenshots of the popup and library page.
8. Submit the initial listing for review and configure the guarded publisher in
   [docs/release/chrome.md](docs/release/chrome.md). Routine releases then use
   the verified workflow artifact rather than a local rebuild.

## Cross-platform and optional sync

- Chrome/Edge, Firefox desktop/Android, and Safari builds share the same storage,
  parser, mutation, and merge modules.
- Local-only operation is the default. No library data is transmitted until the
  reader chooses a sign-in provider.
- Firefox declares synchronization data categories as optional and requests
  consent at the sign-in gesture.
- Safari is packaged as a Safari Web Extension for macOS/iOS/iPadOS. Sign in
  with Google or Apple from the containing app before using cloud sync on
  iOS/iPadOS. The app and extension share the session through the system
  Keychain.
- See [platform architecture](docs/platform-architecture.md) for the shared-domain boundary, [release instructions](docs/release.md) for browser-specific build and testing steps, and [operations](docs/operations.md) for deployment, backup, and restore procedures.

## Limitations

- Metadata extraction varies by site and may require manual correction.
- Some sites block extension or automation-based page inspection.
- Safari OAuth behavior still requires verification in the generated Xcode
  project on a physical iPhone/iPad before App Store submission.
- Signed-store and physical-device checks remain manual release-candidate gates.
