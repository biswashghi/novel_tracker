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

1. Run `npm run package:safari` to produce the Xcode packaging ZIP in `release/`.
2. Unzip `release/novel-tracker-safari-xcode-<version>.zip` and open the
   contained Xcode project.
3. Select your Apple Developer team and verify signing settings.
4. Test on macOS and a physical iPhone/iPad before archiving and submitting.

## App Store Assets

Use the original JPGs in `store-assets/original/` and run the generator to create the final release assets for each platform:

```bash
node scripts/generate-appstore-screenshots.mjs
```

The script writes one final export per platform, using the exact high-resolution sizes required by Apple:

### macOS App Store

- Final export size: 2880×1800 px
- Output files: `macos-screenshot-2880x1800-1.jpg`, `-2.jpg`, `-3.jpg`
- Format: JPEG for screenshots

### iPadOS App Store

- Final export size: 2064×2752 px
- Output files: `ipad-screenshot-2064x2752-1.jpg`, `-2.jpg`, `-3.jpg`
- Format: JPEG for screenshots

### iOS App Store

- Final export size: 1284×2778 px
- Output files: `ios-screenshot-1284x2778-1.jpg`, `-2.jpg`, `-3.jpg`
- Format: JPEG for screenshots

Do not keep the lower-resolution duplicates; only the exact single highest-resolution export for each platform belongs in the final App Store asset set.

Notes:

- Packaging does not overwrite an existing Xcode project or its signing settings.
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
