import { test, expect, extensionUrl, mockSitePage, stubActiveTab } from './fixtures/extension.js';

const HOME_URL = 'https://www.royalroad.com/fiction/12345/test-fiction';
const CHAPTER_7_URL = `${HOME_URL}/7`;
const CHAPTER_8_URL = `${HOME_URL}/8`;

function chapterHtml(number, title) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Chapter ${number}: ${title}</title>
        <meta property="og:title" content="Test Fiction" />
        <link rel="canonical" href="${HOME_URL}" />
      </head>
      <body>
        <h1 class="fic-title">Test Fiction</h1>
        <h1 class="chapter-title">Chapter ${number}: ${title}</h1>
        <div class="chapter-content"><p>Story content.</p></div>
      </body>
    </html>
  `;
}

test('the real content script auto-updates a tracked novel after navigating to the next chapter', async ({
  context,
  extensionId,
  serviceWorker
}) => {
  await context.route('https://www.royalroad.com/**', async (route) => {
    const url = new URL(route.request().url());
    const chapter = url.pathname.endsWith('/7') ? 7 : 8;
    const title = chapter === 7 ? 'The New Gateway' : 'The Rift Opens';
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: chapterHtml(chapter, title) });
  });

  const sitePage = await context.newPage();
  await sitePage.goto(CHAPTER_7_URL);

  // Track the novel at chapter 7 first, exactly like library-flow.spec.js —
  // auto-progress only updates a novel that's already tracked.
  const popupPage = await context.newPage();
  await stubActiveTab(popupPage, serviceWorker, CHAPTER_7_URL);
  await popupPage.goto(extensionUrl(extensionId, 'popup.html'));
  await expect(popupPage.locator('#title')).toHaveValue('Test Fiction', { timeout: 15_000 });
  await popupPage.locator('#save-button').click();
  await expect(popupPage.locator('#status-message')).toContainText(/Added to your library|Bookmark updated/i);
  await popupPage.close();

  // A real full navigation to chapter 8 — the manifest's content_scripts
  // re-inject automatically, no mocked `chrome` global involved.
  await sitePage.goto(CHAPTER_8_URL);

  await expect
    .poll(
      async () => {
        const stored = await serviceWorker.evaluate(() => chrome.storage.local.get(null));
        return JSON.stringify(stored);
      },
      { timeout: 20_000 }
    )
    .toContain('/test-fiction/8');
});
