# Chrome / Edge release

Prepare and publish the Chrome/Edge release.

Common preparation (run locally before packaging):

```bash
npm ci
npm test
npm run build
npm run package:webstore
```

Steps:

1. Increment the version in `package.json`.
2. Run the packaging step to create the upload ZIP:

```bash
npm run package:webstore
```

3. Load `dist/` unpacked for a final manual verification (optional).
4. Record the callback returned by `chrome.identity.getRedirectURL("oauth2")`
   and register its exact value on the Keycloak `novel-tracker-extension`
   client before the production store release.
5. Upload the ZIP from `release/` to the Chrome Web Store Developer Dashboard.

## Store Assets

Located in `store-assets/` directory. Required asset sizes:

**Screenshots** (up to 5)
- Dimensions: 1280×800, 1440×900, 2560×1600, or 2880×1800 px
- Format: JPEG or 24-bit PNG (no alpha channel)
- Minimum: 1 required

**Small Promo Tile**
- Dimensions: 440×280 px
- Format: JPEG or 24-bit PNG (no alpha channel)

**Marquee Promo Tile**
- Dimensions: 1400×560 px
- Format: JPEG or 24-bit PNG (no alpha channel)

Verification checklist:

- Test local-only save/edit/delete/import/export flows.
- Verify Google sign-in and sync flows after publishing to confirm redirect URI and keys are correct.
- Ensure icons and manifest fields meet store requirements.
- Verify all store assets meet size and format requirements.
