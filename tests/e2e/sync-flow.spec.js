// Requires the local stack: `npm run e2e:stack:up && npm run build:e2e` first
// (see docs/testing-locally.md). Unlike library-flow.spec.js and
// auto-progress.spec.js, this spec depends on Docker/Keycloak and was written
// but not executed in this environment (no Docker available here) — verify
// the Keycloak login form selectors below against your Keycloak version's
// theme (these match the unmodified default theme) the first time you run it.
import { test, expect, extensionUrl, mockSitePage, stubActiveTab, assertLocalStackConfig } from './fixtures/extension.js';

test.beforeAll(assertLocalStackConfig);

const E2E_USERNAME = 'e2e-tester';
const E2E_PASSWORD = 'novel-tracker-e2e-password';

const CHAPTER_URL = 'https://www.royalroad.com/fiction/12345/test-fiction/7';
const CHAPTER_HTML = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Chapter 7: The New Gateway</title>
      <meta property="og:title" content="Test Fiction" />
      <link rel="canonical" href="https://www.royalroad.com/fiction/12345/test-fiction" />
    </head>
    <body>
      <h1 class="fic-title">Test Fiction</h1>
      <h1 class="chapter-title">Chapter 7: The New Gateway</h1>
      <div class="chapter-content"><p>Story content.</p></div>
    </body>
  </html>
`;

/** Drives the real Keycloak login form opened by `chrome.identity.launchWebAuthFlow`. */
async function signIn(context, optionsPage) {
  const [authPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 20_000 }),
    optionsPage.locator('.sign-in-button').first().click()
  ]);
  await authPage.waitForLoadState('domcontentloaded');
  await authPage.locator('#username').fill(E2E_USERNAME);
  await authPage.locator('#password').fill(E2E_PASSWORD);
  await authPage.locator('#kc-login').click();
  // Keycloak redirects the auth-flow page to the chromiumapp.org callback,
  // which chrome.identity captures itself and closes the page.
  await authPage.waitForEvent('close', { timeout: 20_000 }).catch(() => {});
}

test('signing in against the local stack syncs a tracked novel to the API', async ({
  context,
  extensionId,
  serviceWorker
}) => {
  const sitePage = await context.newPage();
  await mockSitePage(context, CHAPTER_URL, CHAPTER_HTML);
  await sitePage.goto(CHAPTER_URL);

  const popupPage = await context.newPage();
  await stubActiveTab(popupPage, serviceWorker, CHAPTER_URL);
  await popupPage.goto(extensionUrl(extensionId, 'popup.html'));
  await expect(popupPage.locator('#title')).toHaveValue('Test Fiction', { timeout: 15_000 });
  await popupPage.locator('#save-button').click();
  await expect(popupPage.locator('#status-message')).toContainText(/Added to your library|Bookmark updated/i);
  await popupPage.close();

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));
  await signIn(context, optionsPage);

  // options.js shows the ID token's display name (`E2E Tester`), not the
  // Keycloak username (`e2e-tester`) — see options.js's `account.name || account.email` fallback.
  await expect(optionsPage.locator('#account-title')).toContainText('E2E Tester', { timeout: 20_000 });
  await expect(optionsPage.locator('#sync-detail')).toContainText(/synced/i, { timeout: 20_000 });

  // Confirm the mutation actually reached the local API, not just local
  // storage: a fully synced state has no pending mutations left to push.
  await expect
    .poll(async () => {
      const stored = await serviceWorker.evaluate(() => chrome.storage.local.get('novel-tracker:sync-state'));
      return stored['novel-tracker:sync-state']?.pendingMutations?.length ?? -1;
    }, { timeout: 20_000 })
    .toBe(0);
});
