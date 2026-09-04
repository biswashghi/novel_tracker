// Requires the local stack: `npm run e2e:stack:up && npm run build:e2e` first
// (see docs/testing-locally.md). Written but not executed in this
// environment (no Docker available here) — see the note in sync-flow.spec.js
// about verifying the Keycloak login form selectors against your version.
import { test, expect, extensionUrl, mockSitePage, stubActiveTab, assertLocalStackConfig } from './fixtures/extension.js';

test.beforeAll(assertLocalStackConfig);

// This spec deletes its user for real (App Store guideline 5.1.1(v) — the
// account itself has to go, not just its synced rows), so it cannot share
// `e2e-tester` with the sync specs; whichever ran afterwards would fail. The
// realm seeds this account solely to be destroyed here.
const E2E_USERNAME = 'e2e-deletable';
const E2E_PASSWORD = 'novel-tracker-e2e-password';

const REALM_URL = process.env.NOVEL_TRACKER_REALM_URL || 'http://localhost:8793/realms/novel-tracker';

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

async function signIn(context, optionsPage) {
  const [authPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 20_000 }),
    optionsPage.locator('.sign-in-button').first().click()
  ]);
  await authPage.waitForLoadState('domcontentloaded');
  await authPage.locator('#username').fill(E2E_USERNAME);
  await authPage.locator('#password').fill(E2E_PASSWORD);
  await authPage.locator('#kc-login').click();
  await authPage.waitForEvent('close', { timeout: 20_000 }).catch(() => {});
}

/**
 * Direct-grant password login, used only to ask Keycloak whether the account
 * still exists. `novel-tracker-extension` enables it in the e2e realm.
 */
async function passwordGrantStatus() {
  const response = await fetch(`${REALM_URL}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'novel-tracker-extension',
      scope: 'openid',
      username: E2E_USERNAME,
      password: E2E_PASSWORD
    }).toString()
  });
  return response.status;
}

test('deleting the account removes the identity while the local library survives', async ({
  context,
  extensionId,
  serviceWorker
}) => {
  // The account must exist before the test claims to have deleted it.
  expect(await passwordGrantStatus()).toBe(200);

  const sitePage = await context.newPage();
  await mockSitePage(context, CHAPTER_URL, CHAPTER_HTML);
  await sitePage.goto(CHAPTER_URL);

  const popupPage = await context.newPage();
  await stubActiveTab(popupPage, serviceWorker, CHAPTER_URL);
  await popupPage.goto(extensionUrl(extensionId, 'popup.html'));
  await expect(popupPage.locator('#title')).toHaveValue('Test Fiction', { timeout: 15_000 });
  await popupPage.locator('#save-button').click();
  await popupPage.close();

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));
  await signIn(context, optionsPage);
  await expect(optionsPage.locator('#sync-detail')).toContainText(/synced/i, { timeout: 20_000 });

  // The novel synced up before deletion; the local library keeps it either way.
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toBeVisible();

  optionsPage.once('dialog', (dialog) => dialog.accept());
  await optionsPage.locator('#delete-account').click();
  await expect(optionsPage.locator('#account-title')).not.toContainText(E2E_USERNAME, { timeout: 20_000 });

  // Deletion signs the device out and clears sync linkage, but per
  // docs/operations.md it must NOT touch the local library.
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toBeVisible();

  // The point of the change: the identity is gone, not merely disconnected.
  // Keycloak answers 401 once the user no longer exists.
  await expect.poll(passwordGrantStatus, { timeout: 20_000 }).toBe(401);
});
