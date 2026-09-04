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
4. Confirm the production callback
   `https://meciopmpdehijfmbgbagndgknlmbmjoa.chromiumapp.org/oauth2` is on the
   Keycloak `novel-tracker-extension` client. Production deployment repairs
   this callback automatically, but the signed store build should still be
   tested after publishing.
5. Upload the ZIP from `release/` to the Chrome Web Store Developer Dashboard.

Verification checklist:

- Test local-only save/edit/delete/import/export flows.
- Verify Google sign-in and sync flows after publishing to confirm redirect URI and keys are correct.
- Ensure icons and manifest fields meet store requirements.

## One-time CI publishing setup

`.github/workflows/release.yml`'s `publish-chrome` job runs
`scripts/publish-chrome.mjs` against the Chrome Web Store publish API
instead of the manual dashboard upload above. It needs four secrets
(Settings → Secrets and variables → Actions on the repo):
`CHROME_WEB_STORE_EXTENSION_ID`, `CHROME_WEB_STORE_CLIENT_ID`,
`CHROME_WEB_STORE_CLIENT_SECRET`, `CHROME_WEB_STORE_REFRESH_TOKEN`.

The publish API can only *update* an existing listing, not create one — the
extension must already have gone through one manual upload (the steps
above) before any of this works. That gives you the extension ID.

For the other three, set up a dedicated OAuth client — do **not** reuse
Keycloak's "Sign in with Google" OAuth client for this. Different
application type (Desktop app vs. Web application), different scope
(`chromewebstore` vs. `openid email profile`), and mixing publish
credentials with user-auth credentials is bad blast-radius hygiene. It's
fine to put the new client in the same Google Cloud project as Keycloak's,
just as a separate Credential.

1. **Google Cloud Console** (console.cloud.google.com) → pick/create a
   project → **APIs & Services → Library** → enable "Chrome Web Store API".
2. **APIs & Services → OAuth consent screen**: External user type, add your
   own Google account under **Test users**, leave publishing status as
   **Testing** initially to skip Google's verification review.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   type **Desktop app**. This gives you `CHROME_WEB_STORE_CLIENT_ID` and
   `CHROME_WEB_STORE_CLIENT_SECRET`.
4. Get an authorization code — visit this in a browser signed into the
   account that manages the extension (`prompt=consent` + `access_type=offline`
   are required or no refresh token comes back):
   ```
   https://accounts.google.com/o/oauth2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent
   ```
   After granting access the browser redirects to `http://localhost/?code=...`
   and fails to load (expected — nothing's listening there). Copy the `code`
   from the address bar; it expires within minutes.
5. Exchange it for a refresh token:
   ```bash
   curl -X POST https://oauth2.googleapis.com/token \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=THE_CODE_FROM_STEP_4" \
     -d "grant_type=authorization_code" \
     -d "redirect_uri=http://localhost"
   ```
   The response's `refresh_token` field is `CHROME_WEB_STORE_REFRESH_TOKEN`
   — Google only returns it on this first exchange, not on later refreshes,
   so save it immediately.
6. **Refresh tokens expire after 7 days while the consent screen stays in
   "Testing" status.** If you want CI publishing to keep working without
   redoing this dance before every release, publish the consent screen to
   **production** (OAuth consent screen → Publish App). The `chromewebstore`
   scope isn't on Google's sensitive/restricted list and this app has a
   single user, so that shouldn't trigger Google's manual verification
   review — it just removes the 7-day expiry. Trade-off: Testing status
   restricts who can even attempt the OAuth flow against this client to your
   listed test users; production status drops that restriction (though a
   stranger completing the flow only gets a token for their own identity,
   not publish rights on your listing, unless you'd also added them as a
   Developer Dashboard collaborator).
7. Verify before wiring into CI — run the real publish script locally:
   ```bash
   CHROME_WEB_STORE_EXTENSION_ID=... \
   CHROME_WEB_STORE_CLIENT_ID=... \
   CHROME_WEB_STORE_CLIENT_SECRET=... \
   CHROME_WEB_STORE_REFRESH_TOKEN=... \
   node scripts/publish-chrome.mjs release/novel-tracker-extension-<version>.zip
   ```
   A `status: OK` response means the credentials are good; add them as repo
   secrets.

If you ever test these values directly in a terminal or paste them
somewhere transient, reset the client secret (Credentials → your OAuth
client → Reset secret) and redo steps 4–5 for a fresh refresh token before
relying on them long-term — cheap insurance against a leaked credential.
