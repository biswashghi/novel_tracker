# Cross-browser release runbook

## Common gate

```bash
npm ci
npm test
npm run build
npm run build:firefox
npm run build:safari
npm run package:webstore
npm run package:firefox
```

Test local-only save/edit/delete/import/export, Google sign-in, first sync,
offline edits, sign-out, re-sign-in, different-account confirmation, and cloud
account deletion before publishing any target.

## Chrome / Edge

Load `dist/` unpacked. Record the callback returned by
`chrome.identity.getRedirectURL("oauth2")` and register its exact value on the
Keycloak `novel-tracker-extension` client before the production store release.
Upload the ZIP from `release/` after incrementing `package.json` version.

## Firefox desktop and Android

Load `dist-firefox/` temporarily in Firefox. Run `npm run package:firefox`, then
submit `release/novel-tracker-extension-firefox-<version>.zip` to AMO using the
stable ID `novel-tracker@bghimire.com`. Firefox desktop 140 and Android 142 are
the minimum versions because they provide built-in optional data-transmission
consent. Register the exact `identity.getRedirectURL("oauth2")` callback in
Keycloak and test the signed AMO build on Android.

## Safari macOS / iOS / iPadOS

Run `npm run package:safari`, select the Apple Developer team in the generated
Xcode project, and test macOS plus a physical iPhone/iPad. Verify that Safari's
WebExtension identity API completes the Keycloak callback. If it does not, the
containing app needs an `ASWebAuthenticationSession` bridge before release.

Google is the only identity provider in this release. Because cloud sync is
optional and local-only use remains complete, document that behavior in App
Review notes. Apple may still require an equivalent privacy-preserving login
under guideline 4.8; Sign in with Apple is deferred by product decision.
