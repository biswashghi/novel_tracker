// Requires the local stack: `npm run e2e:stack:up && npm run build:e2e` first
// (see docs/testing-locally.md). Written but not executed in this
// environment (no Docker available here) — see the note in sync-flow.spec.js
// about verifying the Keycloak login form selectors against your version.
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

async function signIn(context, optionsPage) {
  const [authPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 20_000 }),
    optionsPage.locator('#sign-in').click()
  ]);
  await authPage.waitForLoadState('domcontentloaded');
  await authPage.locator('#username').fill(E2E_USERNAME);
  await authPage.locator('#password').fill(E2E_PASSWORD);
  await authPage.locator('#kc-login').click();
  await authPage.waitForEvent('close', { timeout: 20_000 }).catch(() => {});
}

test('deleting cloud data removes it from the API without touching the local library', async ({
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
  await popupPage.close();

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));
  await signIn(context, optionsPage);
  await expect(optionsPage.locator('#sync-detail')).toContainText(/synced/i, { timeout: 20_000 });

  // The novel synced up before deletion; the local library keeps it either way.
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toBeVisible();

  optionsPage.once('dialog', (dialog) => dialog.accept());
  await optionsPage.locator('#delete-cloud').click();
  await expect(optionsPage.locator('#account-title')).not.toContainText('e2e-tester', { timeout: 20_000 });

  // Deleting cloud data signs the device out and clears sync linkage, but
  // per docs/operations.md it must NOT touch the local library.
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toBeVisible();

  // Signing back in re-links this device as a fresh sync account (per
  // docs/sync-api.md, deletion is server-side; a subsequent sync just pushes
  // the still-intact local library back up as new server state). This
  // should complete cleanly, not surface as a sync error.
  await signIn(context, optionsPage);
  await optionsPage.locator('#sync-now').click();
  await expect(optionsPage.locator('#sync-detail')).toContainText(/synced/i, { timeout: 20_000 });
  await expect(optionsPage.locator('#sync-detail')).not.toContainText(/error/i);
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toHaveCount(1);
});
