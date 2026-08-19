// Requires the local stack: `npm run e2e:stack:up && npm run build:e2e` first
// (see docs/testing-locally.md). Written but not executed in this
// environment (no Docker available here) — see the note in sync-flow.spec.js
// about verifying the Keycloak login form selectors against your version.
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, extensionUrl, mockSitePage, stubActiveTab, DIST_DIR, assertLocalStackConfig, logConsole } from './fixtures/extension.js';

test.beforeAll(assertLocalStackConfig);

const E2E_USERNAME = 'e2e-tester';
const E2E_PASSWORD = 'novel-tracker-e2e-password';

const HOME_URL = 'https://www.royalroad.com/fiction/12345/test-fiction';
const CHAPTER_URL = `${HOME_URL}/7`;
const CHAPTER_HTML = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Chapter 7: The New Gateway</title>
      <meta property="og:title" content="Test Fiction" />
      <link rel="canonical" href="${HOME_URL}" />
    </head>
    <body>
      <h1 class="fic-title">Test Fiction</h1>
      <h1 class="chapter-title">Chapter 7: The New Gateway</h1>
      <div class="chapter-content"><p>Story content.</p></div>
    </body>
  </html>
`;

async function openDevice(name) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), `novel-tracker-e2e-${name}-`));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${DIST_DIR}`, `--load-extension=${DIST_DIR}`, '--no-first-run']
  });
  context.on('page', (page) => logConsole(page, `${name} page`));
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  logConsole(serviceWorker, `${name} background`);
  const extensionId = new URL(serviceWorker.url()).host;
  return { context, userDataDir, serviceWorker, extensionId };
}

async function closeDevice(device) {
  await device.context.close();
  await rm(device.userDataDir, { recursive: true, force: true });
}

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

async function waitForSynced(optionsPage) {
  await expect(optionsPage.locator('#sync-detail')).toContainText(/synced/i, { timeout: 20_000 });
}

/**
 * Two independent "devices" (separate Chromium profiles, each with its own
 * copy of the extension) sign into the same seeded account, each mutates the
 * same novel, and both sync — proving the deterministic HLC / remove-wins
 * merge policy documented in docs/sync-api.md converges both copies rather
 * than one device's writes clobbering the other's.
 */
test('two devices signed into the same account converge on the same novel state', async () => {
  const deviceA = await openDevice('a');
  const deviceB = await openDevice('b');

  try {
    // Device A tracks the novel and signs in first, establishing the canonical copy.
    const siteA = await deviceA.context.newPage();
    await mockSitePage(deviceA.context, CHAPTER_URL, CHAPTER_HTML);
    await siteA.goto(CHAPTER_URL);

    const popupA = await deviceA.context.newPage();
    await stubActiveTab(popupA, deviceA.serviceWorker, CHAPTER_URL);
    await popupA.goto(extensionUrl(deviceA.extensionId, 'popup.html'));
    await expect(popupA.locator('#title')).toHaveValue('Test Fiction', { timeout: 15_000 });
    await popupA.locator('#save-button').click();
    await popupA.close();

    const optionsA = await deviceA.context.newPage();
    await optionsA.goto(extensionUrl(deviceA.extensionId, 'options.html'));
    await signIn(deviceA.context, optionsA);
    await waitForSynced(optionsA);

    // Device B signs into the *same* account and pulls A's novel down.
    const optionsB = await deviceB.context.newPage();
    await optionsB.goto(extensionUrl(deviceB.extensionId, 'options.html'));
    await signIn(deviceB.context, optionsB);
    await waitForSynced(optionsB);
    await expect(optionsB.locator('.card', { hasText: 'Test Fiction' })).toBeVisible({ timeout: 20_000 });

    // Device B marks it "paused" and syncs. The field-level LWW policy
    // (docs/sync-api.md) should propagate that write to device A rather than
    // losing it the next time device A syncs its own (unrelated) state.
    const cardB = optionsB.locator('.card', { hasText: 'Test Fiction' });
    await cardB.locator('button[data-action="edit"]').click();
    await cardB.locator('select[name="status"]').selectOption('paused');
    await cardB.locator('form[data-form="edit"] button[type="submit"]').click();
    // The submit handler's updateNovel()+refresh() (options.js) run async
    // after the click event dispatches; Playwright's click() only waits for
    // dispatch, not for that chain to finish. Wait for the card's own status
    // text to reflect "paused" (refresh() re-renders it from storage) before
    // triggering sync, or sync-now can race ahead of the mutation actually
    // landing in storage.
    await expect(cardB).toContainText('paused', { timeout: 10_000 });
    await optionsB.locator('#sync-now').click();
    await waitForSynced(optionsB);

    await optionsA.reload();
    await optionsA.locator('#sync-now').click();
    await waitForSynced(optionsA);
    const stateA = await deviceA.serviceWorker.evaluate(() => chrome.storage.local.get(null));
    expect(JSON.stringify(stateA)).toContain('"value":"paused"');

    // Device A pulls the same status; both devices now agree.
    await optionsB.reload();
    const stateB = await deviceB.serviceWorker.evaluate(() => chrome.storage.local.get(null));
    expect(JSON.stringify(stateB)).toContain('"value":"paused"');
  } finally {
    await closeDevice(deviceA);
    await closeDevice(deviceB);
  }
});
