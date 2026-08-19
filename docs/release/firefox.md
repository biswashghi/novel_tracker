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

## One-time CI publishing setup

`.github/workflows/release.yml`'s `publish` job runs
`scripts/publish-firefox.mjs` (via `web-ext sign`) instead of the manual AMO
submission above. It needs two secrets (Settings → Secrets and variables →
Actions on the repo): `AMO_API_KEY` and `AMO_API_SECRET`. Unlike Chrome,
there's no OAuth dance — these are static credentials:

1. Sign in at [addons.mozilla.org](https://addons.mozilla.org/) with the
   account that owns the `novel-tracker@bghimire.com` listing.
2. **Manage API Keys**
   (addons.mozilla.org/developers/addon/api/key/) → generate a new
   credential pair.
3. The **JWT issuer** is `AMO_API_KEY`; the **JWT secret** is
   `AMO_API_SECRET`.

These don't expire on a fixed schedule the way Chrome's Testing-mode
refresh tokens do — only regenerate them if they've leaked or you're
rotating credentials on a schedule.
