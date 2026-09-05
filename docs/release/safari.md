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

`.github/workflows/release.yml`'s `publish-safari` job (macos-latest, after the
protected `publish-readiness` gate) runs `scripts/publish-safari.mjs`, which
shells out to Fastlane (`safari-app/fastlane/Fastfile`) using the
`APP_STORE_CONNECT_*` secrets — one lane per platform. The job imports the
Apple Distribution identity from `APPSTORE_CERTIFICATES_FILE_BASE64` and
`APPSTORE_CERTIFICATES_PASSWORD`, plus the separate Mac Installer Distribution
identity from `APPSTORE_INSTALLER_CERTIFICATES_FILE_BASE64` and
`APPSTORE_INSTALLER_CERTIFICATES_PASSWORD`. The installer password secret is
optional when both `.p12` exports use `APPSTORE_CERTIFICATES_PASSWORD`; a
dedicated value overrides that fallback. The installer identity signs the
`.pkg` Xcode exports for the Mac App Store and is not interchangeable with the
Apple Distribution identity that signs the app itself. Some Keychain exports
contain only the installer private key, without a certificate bag. For CI,
the macOS lane downloads existing `MAC_INSTALLER_DISTRIBUTION` certificates
from Apple's API and selects only a current certificate for this team whose
public key matches the P12's private key. It pairs them in a password-protected,
temporary P12 and imports the complete identity; the original private key is
never logged or uploaded anywhere else. This does not create or revoke
certificates. It fails with an explicit message if no matching certificate
exists; a misleading P12 filename cannot substitute for a matching identity.
Fastlane then creates
or repairs dedicated CI-managed iOS and macOS App Store profiles for the
containing app and extension, bound to the Apple Distribution certificate. It
configures only the Release targets for explicit signing; Debug/local
development remains automatic. This avoids Apple's Xcode-managed profiles,
which cannot be selected by a manually signed CI archive:

The workflow passes the disposable keychain path to Fastlane explicitly.
Without that, Fastlane searches the runner's empty login keychain, fails to
recognize the imported certificate, and incorrectly tries to create another
distribution certificate.

Safari packaging requires a full Git checkout (`fetch-depth: 0` in both CI
workflows), because the Apple build number is `git rev-list --count HEAD`.
The packaging script rejects shallow clones before generating any artifacts,
preventing an accidental build-number reset to `1`.

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

To run a lane locally: `cd safari-app && bundle exec fastlane mac release` (or
`bundle exec fastlane ios release`) with `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
and `APP_STORE_CONNECT_P8` exported in your shell — needs `fastlane`
installed through `bundle install` using the repository's locked
`Gemfile.lock`. The same signing setup from steps 2–3 above has to already
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
