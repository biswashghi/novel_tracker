# Testing locally (e2e)

The e2e suite loads the real packaged extension (not a mocked `chrome`
global) with Playwright, and for the sign-in/sync specs, exercises it against
the same Postgres + Keycloak + API stack used in production
(`infra/docker-compose.yml`) pointed at throwaway local credentials instead.

## Quick start

```bash
# 1. Bring up Postgres + Keycloak (seeded with a local-only test realm/user
#    from infra/keycloak-realm.e2e.json) + the API, and wait for the realm
#    import to finish.
npm run e2e:stack:up

# 2. Build the extension against the local stack: writes dist/lib/config.js
#    pointing at http://localhost:8792 / :8793 instead of production
#    (scripts/build.mjs --env=local).
npm run build:e2e

# 3. Run the suite.
npm run test:e2e

# 4. Tear the stack down when you're done.
npm run e2e:stack:down
```

The seeded test account is `e2e-tester@example.com` / password
`novel-tracker-e2e-password` (`infra/keycloak-realm.e2e.json`) — a throwaway
account in a throwaway realm that isn't connected to Google or to the
production Keycloak realm.

If you only want the local-only specs (no sign-in/sync), `npm run build`
(the normal production-pointed build) is enough — skip steps 1 and 2 and use
`npm run build && npm run test:e2e -- library-flow auto-progress`.

## Test layout

- `tests/e2e/extension-smoke.spec.js` — fast component test; mocks the
  `chrome` global to exercise popup/content-script logic directly. Doesn't
  load the packaged extension or require the local stack.
- `tests/e2e/library-flow.spec.js`, `tests/e2e/auto-progress.spec.js` — load
  the real packaged `dist/` extension via `tests/e2e/fixtures/extension.js`
  (a Playwright persistent Chromium context with `--load-extension`). Local
  data only; don't require the stack.
- `tests/e2e/sync-flow.spec.js`, `tests/e2e/merge-conflict.spec.js`,
  `tests/e2e/account-deletion.spec.js` — also load the real extension **and**
  require the local stack from step 1; they drive Keycloak's own login form
  for the seeded test user (`chrome.identity.launchWebAuthFlow` opens it as a
  real browser tab, which Playwright can interact with).
- `tests/server-sync-api.test.mjs` — a plain `npm test` suite (no Playwright)
  that exercises `server/index.js` over HTTP: acknowledgements, per-item
  rejections, batch limits, and the shape of the canonical state blob. It
  **skips itself** when the stack isn't running, so `npm test` stays green
  without Docker; bring the stack up (step 1) to actually run it.

  It authenticates headlessly with the OAuth password grant, which is why
  `infra/keycloak-realm.e2e.json` sets `directAccessGrantsEnabled: true`.
  That is the **local throwaway realm only** — `infra/keycloak-realm.json`
  (production) keeps the grant disabled, and the extension itself never uses
  it, only authorization-code PKCE.

## Why the real extension still stubs one thing

Playwright has no API to simulate a real click on the browser's toolbar icon
(the actual MV3 action-popup surface), so opening `popup.html` as a normal
tab is the only way to drive it — but that makes the popup tab itself the
browser's "active tab," which would break the extension's own
`chrome.tabs.query({active:true})` lookup for "what page was the reader
looking at." `tests/e2e/fixtures/extension.js`'s `stubActiveTab()` installs a
narrow override for that one query, pointed at the real chapter tab. Every
other API — `chrome.storage`, `chrome.scripting.executeScript` (which runs
the real site parsers against the real routed page), and `chrome.runtime`
messaging to the real background service worker — is untouched.

## Requirements

- Docker with Compose v2 (`docker compose ...`) for the sign-in/sync specs.
- Chromium for Playwright: `npx playwright install chromium`, once, if it
  hasn't been downloaded before.
- Firefox and Safari: Playwright cannot load unpacked WebExtensions in
  either browser, so there's no automated equivalent of this suite for them.
  Firefox has `web-ext lint` (Firefox-specific validation) wired into CI
  instead; Safari relies on the manual checklist in
  [development.md](development.md) plus an Xcode compile check in CI.
