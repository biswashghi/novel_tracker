# Firefox release

Prepare and publish the Firefox desktop and Android release.

Common preparation (run locally before packaging):

```bash
npm ci
npm test
npm run build
npm run build:firefox
npm run package:firefox
```

Steps:

1. Run `npm run build:firefox` to produce `dist-firefox/`.
2. Optionally load `dist-firefox/` temporarily in Firefox for manual testing.
3. Run the packaging step to create the AMO upload package:

```bash
npm run package:firefox
```

4. Submit `release/novel-tracker-extension-firefox-<version>.zip` to AMO using
   the stable ID `novel-tracker@bghimire.com`.

Notes:

- Firefox desktop 140 and Android 142 are the minimum supported versions because
  they provide built-in optional data-transmission consent.
- Register the exact callback returned by `identity.getRedirectURL("oauth2")`
  in Keycloak and test the signed AMO build on Android.
