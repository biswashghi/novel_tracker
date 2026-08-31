# Safari release

Prepare and publish the Safari macOS / iOS / iPadOS release.

Common preparation (run locally before packaging):

```bash
npm ci
npm test
npm run build
npm run build:safari
npm run package:safari
```

Steps:

1. Run `npm run package:safari` to produce the Xcode packaging ZIP in `release/`
   (this also refreshes `build/safari-xcode/Novel Tracker/`, the persistent
   project directory Xcode/Fastlane use directly).
2. Open `build/safari-xcode/Novel Tracker/Novel Tracker.xcodeproj`.
3. Select the Apple Developer team and verify signing settings.
4. Test on macOS and a physical iPhone/iPad before archiving and submitting.

### Automated archive + upload (CI)

`.github/workflows/release.yml`'s `publish-safari` job (macos-latest, needs
`build-safari` + `check-secrets`) runs `scripts/publish-safari.mjs`, which
shells out to Fastlane (`safari-app/fastlane/Fastfile`) using the
`APP_STORE_CONNECT_*` secrets — one lane per platform. The job imports the
Apple Distribution identity from `APPSTORE_CERTIFICATES_FILE_BASE64` and
`APPSTORE_CERTIFICATES_PASSWORD`, then downloads the matching iOS and macOS
App Store provisioning profiles for the containing app and extension before
Fastlane archives them. The profile names returned by the download action are
passed to Fastlane, which configures only the Release targets for explicit
Apple Distribution signing; Debug/local development remains automatic:

- **macOS** (`fastlane mac release`) archives, exports, and uploads to App
  Store Connect as a new unreleased draft version. Does **not** submit for
  review — that stays a manual step. Verified locally: archive/export/sign
  all succeed; the actual upload only goes through once App Store Connect's
  current macOS version isn't sitting on unresolved review feedback (push it
  back to "Waiting for Review" there first if it is — the API can't do that
  part for you).
- **iOS** (`fastlane ios release`) archives and uploads to TestFlight
  (internal testers only by default), matching how this app has been
  distributed on iOS so far. Verified working end-to-end for real.

Both run by default; set `NOVEL_TRACKER_SAFARI_PLATFORMS=mac` or `=ios` (env
var for `publish-safari.mjs` locally, or the workflow's `safari_platforms`
`workflow_dispatch` input in CI) to publish just one — useful when the other
platform's App Store Connect listing is in a blocking state.

To run a lane locally: `cd safari-app && fastlane mac release` (or `fastlane
ios release`) with `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
and `APP_STORE_CONNECT_P8` exported in your shell — needs `fastlane`
installed (`gem install fastlane`; if your system Ruby is too old, install a
newer one via Homebrew (`brew install ruby`) and prepend
`/opt/homebrew/opt/ruby/bin` and `/opt/homebrew/lib/ruby/gems/<version>/bin`
to `PATH` first). The same signing setup from steps 2–3 above has to already
be in place in the persistent Xcode project for this to work
non-interactively — `npm run package:safari` handles that automatically (see
the scheme-sharing and app-version notes below).

Notes:

- Packaging does not overwrite an existing Xcode project or its signing settings.
- `xcrun safari-web-extension-converter` doesn't persist any `.xcscheme`
  files — only an implicit, non-shared scheme Xcode synthesizes on the fly,
  which `xcodebuild -list`/interactive Xcode can see but Fastlane's
  `build_app` can't ("Couldn't find specified scheme ... make sure the
  scheme is shared"). `npm run package:safari` generates real, shared scheme
  files for the macOS and iOS app targets to fix this.
- `xcrun safari-web-extension-converter` also hardcodes `MARKETING_VERSION`
  to `1.0` on every regeneration. `npm run package:safari` overwrites it with
  `package.json`'s version — otherwise every App Store Connect upload
  collides with whatever version was previously uploaded.
- Every App Store Connect build needs an export-compliance (encryption
  usage) declaration before testers/reviewers can access it — confirmed the
  hard way: an uploaded build sat on "Missing Compliance" until answered
  manually in the web UI, which doesn't work for an automated pipeline. The
  app only uses standard HTTPS (`fetch`), no proprietary cryptography, so
  it qualifies for the standard export exemption. `npm run package:safari`
  sets `ITSAppUsesNonExemptEncryption = false` in both the iOS and macOS
  app Info.plist files to declare that upfront and skip the manual prompt
  on every future upload.
- The Safari build removes the unsupported WebExtension identity permission,
  bundles its background worker as a classic script, and configures a shared
  Keychain group for the app and extension.
- On iOS/iPadOS, launch the Novel Tracker app and complete Google sign-in in
  Apple's authentication sheet; the Safari extension then imports that session.
- In Xcode, select the same development team for the containing app and both
  extension targets so the generated Keychain access-group entitlement is
  signed consistently.
- Verify sign-in, extension enablement, token refresh, and sign-out on a
  physical iPhone or iPad before archiving.
