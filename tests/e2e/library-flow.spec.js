import { test, expect, extensionUrl, mockSitePage, stubActiveTab } from './fixtures/extension.js';

const CHAPTER_URL = 'https://www.royalroad.com/fiction/12345/test-fiction/7';
const CHAPTER_HTML = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Chapter 7: The New Gateway</title>
      <meta property="og:title" content="Test Fiction" />
      <meta property="og:image" content="https://example.com/cover.jpg" />
      <link rel="canonical" href="https://www.royalroad.com/fiction/12345/test-fiction" />
    </head>
    <body>
      <h1 class="fic-title">Test Fiction</h1>
      <h1 class="chapter-title">Chapter 7: The New Gateway</h1>
      <div class="chapter-content"><p>Story content.</p></div>
    </body>
  </html>
`;

/**
 * Saves the current chapter through the *real* popup page: real
 * `chrome.scripting.executeScript` running the real site parser against the
 * routed chapter page, real `chrome.runtime` messaging to the real
 * background service worker, real `chrome.storage.local` write. Only the
 * "what tab is active" lookup is stubbed — see fixtures/extension.js.
 */
async function saveChapterViaPopup({ context, extensionId, serviceWorker }) {
  const sitePage = await context.newPage();
  await mockSitePage(context, CHAPTER_URL, CHAPTER_HTML);
  await sitePage.goto(CHAPTER_URL);

  const popupPage = await context.newPage();
  await stubActiveTab(popupPage, serviceWorker, CHAPTER_URL);
  await popupPage.goto(extensionUrl(extensionId, 'popup.html'));

  await expect(popupPage.locator('#title')).toHaveValue('Test Fiction', { timeout: 15_000 });
  await expect(popupPage.locator('#chapter-label')).toHaveValue(/Chapter 7/i);
  await popupPage.locator('#save-button').click();
  await expect(popupPage.locator('#status-message')).toContainText(/Added to your library|Bookmark updated/i);

  await popupPage.close();
  await sitePage.close();
}

test('popup saves the active chapter through the real background service worker and storage', async ({
  context,
  extensionId,
  serviceWorker
}) => {
  await saveChapterViaPopup({ context, extensionId, serviceWorker });

  const stored = await serviceWorker.evaluate(() => chrome.storage.local.get(null));
  const storedJson = JSON.stringify(stored);
  expect(storedJson).toContain('Test Fiction');
  expect(storedJson).toContain(CHAPTER_URL);
});

test('library page lists, edits, and deletes a saved novel', async ({ context, extensionId, serviceWorker }) => {
  await saveChapterViaPopup({ context, extensionId, serviceWorker });

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));

  const card = optionsPage.locator('.card', { hasText: 'Test Fiction' });
  await expect(card).toBeVisible({ timeout: 15_000 });

  // Edit: rename the novel and confirm the change persists after re-render.
  await card.locator('button[data-action="edit"]').click();
  const titleInput = card.locator('input[name="title"]');
  await titleInput.fill('Test Fiction (renamed)');
  await card.locator('form[data-form="edit"]').locator('button[type="submit"]').click();

  const renamedCard = optionsPage.locator('.card', { hasText: 'Test Fiction (renamed)' });
  await expect(renamedCard).toBeVisible();

  // Delete: accept the confirm() dialog and verify the card disappears.
  optionsPage.once('dialog', (dialog) => dialog.accept());
  await renamedCard.locator('button[data-action="delete"]').click();
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toHaveCount(0);
});

test('export downloads a JSON backup and import restores it', async ({ context, extensionId, serviceWorker }) => {
  await saveChapterViaPopup({ context, extensionId, serviceWorker });

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toBeVisible({ timeout: 15_000 });

  const [download] = await Promise.all([
    optionsPage.waitForEvent('download'),
    optionsPage.locator('#export-json').click()
  ]);
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  // Wipe local storage the way a fresh profile would start, then import the backup back in.
  await serviceWorker.evaluate(() => chrome.storage.local.clear());
  await optionsPage.reload();
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toHaveCount(0);

  await optionsPage.setInputFiles('#import-file', backupPath);
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toBeVisible({ timeout: 15_000 });
});
