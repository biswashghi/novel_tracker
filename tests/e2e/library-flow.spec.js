import { test, expect, extensionUrl, mockSitePage, stubActiveTab } from './fixtures/extension.js';
import { readFile } from 'node:fs/promises';

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

  // Delete: the card disappears at once, with no confirm() dialog.
  await renamedCard.locator('button[data-action="delete"]').click();
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toHaveCount(0);

  // Undo from the toast brings it straight back.
  await optionsPage.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(renamedCard).toBeVisible();
  await expect(optionsPage.locator('#toast')).toBeHidden();

  // Delete again and restore from Recently deleted instead.
  await renamedCard.locator('button[data-action="delete"]').click();
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toHaveCount(0);
  const trash = optionsPage.locator('#trash');
  await trash.locator('summary').click();
  const trashItem = trash.locator('.trash-item', { hasText: 'Test Fiction (renamed)' });
  await expect(trashItem).toBeVisible();
  await trashItem.locator('button[data-action="restore"]').click();
  await expect(renamedCard).toBeVisible();
  await expect(trash).toBeHidden();
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

test('the save shortcut and context menu save the tab without opening the popup', async ({
  context,
  extensionId,
  serviceWorker
}) => {
  const sitePage = await context.newPage();
  await mockSitePage(context, CHAPTER_URL, CHAPTER_HTML);
  await sitePage.goto(CHAPTER_URL);

  // The menu item is registered for page right-clicks. chrome.contextMenus
  // has no getter; update() with no changes fails only for a missing id, so
  // it checks without touching the item. The background creates it
  // asynchronously after install, so poll.
  await expect
    .poll(
      () =>
        serviceWorker.evaluate(
          () =>
            new Promise((resolve) => {
              chrome.contextMenus.update('novel-tracker:save-chapter', {}, () =>
                resolve(chrome.runtime.lastError?.message || 'registered')
              );
            })
        ),
      { timeout: 10_000 }
    )
    .toBe('registered');

  const commands = await serviceWorker.evaluate(() => chrome.commands.getAll());
  expect(commands.find((command) => command.name === 'save-chapter')?.description).toBeTruthy();

  const saved = await serviceWorker.evaluate(async (url) => {
    const [tab] = (await chrome.tabs.query({})).filter((candidate) => candidate.url === url);
    const result = await globalThis.novelTrackerSaveChapterFromTab(tab);
    return { title: result?.title, badge: await chrome.action.getBadgeText({ tabId: tab.id }) };
  }, CHAPTER_URL);
  expect(saved).toEqual({ title: 'Test Fiction', badge: '✓' });

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toBeVisible({ timeout: 15_000 });
});

test('CSV export downloads one spreadsheet row per novel', async ({ context, extensionId, serviceWorker }) => {
  await saveChapterViaPopup({ context, extensionId, serviceWorker });

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));
  await expect(optionsPage.locator('.card', { hasText: 'Test Fiction' })).toBeVisible({ timeout: 15_000 });

  const [download] = await Promise.all([
    optionsPage.waitForEvent('download'),
    optionsPage.locator('#export-csv').click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^novel-tracker-library-\d{4}-\d{2}-\d{2}\.csv$/);

  const csv = (await readFile(await download.path(), 'utf8')).replace(/^\uFEFF/, '');
  const [header, row, trailing] = csv.split('\r\n');
  expect(header).toBe('Title,Source,Novel page,Chapter,Chapter URL,Status,Rating,Tags,Notes,Chapters read,Last read');
  expect(row).toContain('Test Fiction');
  expect(row).toContain(CHAPTER_URL);
  expect(trailing).toBe('');
});

test('popup lists recently read novels and reopens their chapter', async ({ context, extensionId, serviceWorker }) => {
  await saveChapterViaPopup({ context, extensionId, serviceWorker });

  // Opened directly, the popup's "active tab" is itself — not a readable page —
  // which is exactly when the jump-back-in list matters most.
  const popupPage = await context.newPage();
  await popupPage.goto(extensionUrl(extensionId, 'popup.html'));
  await expect(popupPage.locator('#site-pill')).toHaveText(/No novel page/);
  await expect(popupPage.locator('#continue-reading')).toHaveAttribute('open', '');
  await expect(popupPage.locator('#title')).toBeHidden();

  const item = popupPage.locator('#continue-list .continue-item', { hasText: 'Test Fiction' });
  await expect(item).toBeVisible();
  await expect(item).toContainText(/Chapter 7/);

  const [chapterTab] = await Promise.all([context.waitForEvent('page'), item.click()]);
  await expect.poll(() => chapterTab.url()).toBe(CHAPTER_URL);

  // On the novel's own chapter the list leaves it out: you are already there.
  const onChapter = await context.newPage();
  await stubActiveTab(onChapter, serviceWorker, CHAPTER_URL);
  await onChapter.goto(extensionUrl(extensionId, 'popup.html'));
  await expect(onChapter.locator('#status-message')).toContainText(/Already tracking/);
  await expect(onChapter.locator('#continue-reading')).toBeHidden();
});

test('popup stays within Chrome\'s 600px popup height with a full Continue reading list', async ({
  context,
  extensionId,
  serviceWorker
}) => {
  const others = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((title, index) => ({
    title,
    sourceSite: 'example.com',
    novelHomeUrl: `https://example.com/${title.toLowerCase()}`,
    lastReadChapterUrl: `https://example.com/${title.toLowerCase()}/chapter-${index + 2}`,
    lastReadChapterLabel: `Chapter ${index + 2}`,
    status: 'active',
    updatedAt: new Date(Date.now() - index * 3600_000).toISOString()
  }));
  const seeder = await context.newPage();
  await seeder.goto(extensionUrl(extensionId, 'options.html'));
  await seeder.evaluate(
    (text) => chrome.runtime.sendMessage({ type: 'novel-tracker:library-import', payload: { text } }),
    JSON.stringify({ version: 1, novels: others })
  );
  await saveChapterViaPopup({ context, extensionId, serviceWorker });

  const contentHeight = (page) => page.evaluate(() => document.documentElement.scrollHeight);

  // Not a readable page: the form collapses and the list is open.
  const idle = await context.newPage();
  await idle.setViewportSize({ width: 390, height: 600 });
  await idle.goto(extensionUrl(extensionId, 'popup.html'));
  await expect(idle.locator('#continue-list .continue-item')).toHaveCount(3);
  expect(await contentHeight(idle)).toBeLessThanOrEqual(600);

  // On a chapter: the full form, with the list folded to one line.
  const sitePage = await context.newPage();
  await sitePage.goto(CHAPTER_URL);
  const onChapter = await context.newPage();
  await onChapter.setViewportSize({ width: 390, height: 600 });
  await stubActiveTab(onChapter, serviceWorker, CHAPTER_URL);
  await onChapter.goto(extensionUrl(extensionId, 'popup.html'));
  await expect(onChapter.locator('#status-message')).toContainText(/Already tracking/);
  const list = onChapter.locator('#continue-reading');
  await expect(list).toBeVisible();
  await expect(list).not.toHaveAttribute('open', '');
  await expect(list.locator('#continue-count')).toHaveText('3');
  expect(await contentHeight(onChapter)).toBeLessThanOrEqual(600);
});

test('reading activity heatmap counts the chapters read today', async ({ context, extensionId, serviceWorker }) => {
  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));
  // Nothing read yet: the panel stays out of the way.
  await expect(optionsPage.locator('#reading-activity')).toBeHidden();

  await saveChapterViaPopup({ context, extensionId, serviceWorker });
  await optionsPage.reload();

  const activity = optionsPage.locator('#reading-activity');
  await expect(activity).toBeVisible({ timeout: 15_000 });
  await expect(activity.locator('#activity-summary')).toHaveText('1 chapter on 1 day in the last year');
  const today = activity.locator('.activity-cell[data-level="4"]');
  await expect(today).toHaveCount(1);

  await today.hover();
  await expect(activity.locator('#activity-summary')).toHaveText(/^1 chapter · /);
});
