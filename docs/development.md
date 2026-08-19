## Development and Local Testing

This page contains local development and testing instructions for the extension,
including platform-specific steps for Safari on macOS and iOS.

### Run tests

Run the unit tests:

```bash
npm test
```

Run the e2e suite (loads the real packaged extension in Chromium): see
[testing-locally.md](testing-locally.md) for the full local-stack runbook.

### Build

Build the unpacked extension for all supported platforms:

```bash
npm run build
npm run build:firefox
npm run build:safari
```

- The Chrome/Edge unpacked build is written to `dist/`.
- The Firefox build is written to `dist-firefox/`.
- The Safari build is written to `dist-safari/`.

### Package

Package a Chrome Web Store ZIP:

```bash
npm run package:webstore
```

The upload package is written to `release/novel-tracker-extension-<version>.zip`.

### Load Locally in Chrome or Edge

1. Run `npm run build`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer Mode.
4. Choose `Load unpacked` and select the generated `dist/` folder.
5. After code or manifest changes, click `Reload` on the unpacked extension.

### Testing in Safari (macOS)

1. Run `npm run build:safari` to generate the Safari build artifacts in `dist-safari/`.
2. Open the Xcode project at `build/safari-xcode/Novel Tracker/Novel Tracker.xcodeproj`
   (generated fresh by `npm run package:safari`/`scripts/package-safari.sh`, which
   reuses this same directory across runs so your Developer Team and signing
   settings aren't lost).
3. In Xcode select the containing app scheme (the macOS app that bundles the
   Safari Web Extension) and run on your Mac.
4. In Safari, enable the extension in `Safari > Settings > Extensions` (or
   `Preferences > Extensions` on older macOS versions) and verify the extension
   appears and can save the active chapter.

Notes:
- You may need to allow unsigned or development-signed extensions in Safari's
  Develop menu if prompted.

### Testing on iOS (iPhone/iPad)

1. Connect a physical iPhone or iPad to your Mac.
2. Open `build/safari-xcode/Novel Tracker/Novel Tracker.xcodeproj` in Xcode.
3. Select a device target (your connected iPhone/iPad) and run the containing
   app. This installs the app and the embedded Safari Web Extension on the
   device.
4. On the device, enable the extension in `Settings > Safari > Extensions` or
   in the containing app's extension settings.
5. Test sign-in flows and OAuth behavior on a physical device; certain OAuth
   behaviors (Keycloak/Google flows) require end-to-end verification on-device.

Notes:
- iOS Safari extension testing typically requires a physical device and Xcode
  provisioning (development team, signing, and an enabled capability).

### Additional notes

- See `docs/platform-architecture.md` for architecture details and
  `docs/release.md` for platform-specific release steps.
