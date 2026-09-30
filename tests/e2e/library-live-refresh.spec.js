import { test, expect, extensionUrl, stubActiveTab } from './fixtures/extension.js';

// The library tab is often left open while the reader keeps reading in
// another tab. These check that it follows along without a reload.

const HOME_URL = 'https://www.royalroad.com/fiction/12345/test-fiction';
const chapterUrl = (number) => `${HOME_URL}/${number}`;
const TITLES = { 7: 'The New Gateway', 8: 'The Rift Opens', 9: 'Aftermath' };

function chapterHtml(number) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Chapter ${number}: ${TITLES[number]}</title>
        <meta property="og:title" content="Test Fiction" />
        <link rel="canonical" href="${HOME_URL}" />
      </head>
      <body>
        <h1 class="fic-title">Test Fiction</h1>
        <h1 class="chapter-title">Chapter ${number}: ${TITLES[number]}</h1>
        <div class="chapter-content"><p>Story content.</p></div>
      </body>
    </html>
  `;
}

async function trackAtChapter7({ context, extensionId, serviceWorker }) {
  await context.route('https://www.royalroad.com/**', async (route) => {
    const number = Number(new URL(route.request().url()).pathname.split('/').pop()) || 7;
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: chapterHtml(number) });
  });

  const sitePage = await context.newPage();
  await sitePage.goto(chapterUrl(7));

  const popupPage = await context.newPage();
  await stubActiveTab(popupPage, serviceWorker, chapterUrl(7));
  await popupPage.goto(extensionUrl(extensionId, 'popup.html'));
  await expect(popupPage.locator('#title')).toHaveValue('Test Fiction');
  await popupPage.locator('#save-button').click();
  await expect(popupPage.locator('#status-message')).toContainText(/Added to your library/);
  await popupPage.close();

  const optionsPage = await context.newPage();
  await optionsPage.goto(extensionUrl(extensionId, 'options.html'));
  const card = optionsPage.locator('.card', { hasText: 'Test Fiction' });
  await expect(card.locator('.chapter-pill')).toHaveText(/Chapter 7/);

  return { sitePage, optionsPage, card };
}

test('an open library shows progress made in another tab without a reload', async ({ context, extensionId, serviceWorker }) => {
  const { sitePage, card, optionsPage } = await trackAtChapter7({ context, extensionId, serviceWorker });

  // Keep reading in the other tab: the real content script moves the bookmark.
  await sitePage.goto(chapterUrl(8));

  await expect(card.locator('.chapter-pill')).toHaveText(/Chapter 8/, { timeout: 20_000 });
  await expect(card.locator('.progress-count')).toHaveText('2 chapters read');
  await expect(optionsPage.locator('#stat-week')).toHaveText('2');
});

test('a live update keeps an open chapter history open', async ({ context, extensionId, serviceWorker }) => {
  const { sitePage, card } = await trackAtChapter7({ context, extensionId, serviceWorker });

  await sitePage.goto(chapterUrl(8));
  await expect(card.locator('.chapter-pill')).toHaveText(/Chapter 8/, { timeout: 20_000 });

  await card.locator('details.history summary').click();
  await expect(card.locator('details.history')).toHaveAttribute('open', '');

  await sitePage.goto(chapterUrl(9));
  await expect(card.locator('.chapter-pill')).toHaveText(/Chapter 9/, { timeout: 20_000 });
  await expect(card.locator('details.history')).toHaveAttribute('open', '');
  await expect(card.locator('details.history summary')).toContainText('History (3)');
});

test('a live update waits while a novel is being edited, then catches up', async ({ context, extensionId, serviceWorker }) => {
  const { sitePage, card } = await trackAtChapter7({ context, extensionId, serviceWorker });

  await card.locator('button[data-action="edit"]').click();
  const titleInput = card.locator('input[name="title"]');
  await titleInput.fill('Half-typed new tit');

  await sitePage.goto(chapterUrl(8));
  // Give the change time to land and the refresh time to (not) run.
  await expect
    .poll(async () => JSON.stringify(await serviceWorker.evaluate(() => chrome.storage.local.get(null))), {
      timeout: 20_000
    })
    .toContain('/test-fiction/8');
  await card.page().waitForTimeout(600);

  await expect(card).toHaveClass(/\bediting\b/);
  await expect(titleInput).toHaveValue('Half-typed new tit');

  await card.locator('button[data-action="cancel"]').click();
  await expect(card.locator('.chapter-pill')).toHaveText(/Chapter 8/);
});
