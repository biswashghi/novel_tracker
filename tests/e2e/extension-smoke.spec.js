// Fast component-level smoke test: opens popup.html/content-script.js
// directly with a hand-mocked `chrome` global rather than loading the real
// packaged extension. For real-extension coverage (real service worker,
// real chrome.storage, real background message handling), see
// library-flow.spec.js and auto-progress.spec.js, which use
// tests/e2e/fixtures/extension.js instead.
import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const popupPath = `file://${path.join(projectRoot, 'dist', 'popup.html')}`;

function pageHtml(chapterNumber, chapterTitle) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${chapterTitle}</title>
        <meta property="og:title" content="Test Fiction" />
        <meta property="og:image" content="https://example.com/cover.jpg" />
        <link rel="canonical" href="https://www.royalroad.com/fiction/12345/test-fiction" />
      </head>
      <body>
        <h1 class="fic-title">Test Fiction</h1>
        <h1 class="chapter-title">Chapter ${chapterNumber}: ${chapterTitle}</h1>
        <div class="chapter-content">
          <p>Story content.</p>
        </div>
      </body>
    </html>
  `;
}

test('popup loads a chapter and saves the novel bookmark', async () => {
  // popup.html loads popup.js as an ES module. Chromium hard-blocks
  // cross-origin fetches for module scripts on schemes outside
  // {chrome, chrome-untrusted, data, http, https} — file:// isn't in that
  // list, so a plain file:// load throws a CORS error before popup.js ever
  // runs. --allow-file-access-from-files lifts that restriction for
  // file:// pages only; it doesn't relax any http(s) origin's CORS policy.
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();

  await page.addInitScript(() => {
    const storage = {
      'novel-tracker:novels': []
    };

    globalThis.chrome = {
      tabs: {
        query: async () => [{
          id: 1,
          url: 'https://www.royalroad.com/fiction/12345/test-fiction/7'
        }]
      },
      scripting: {
        executeScript: async () => [{
          result: {
            title: 'Test Fiction',
            sourceSite: 'royalroad.com',
            novelHomeUrl: 'https://www.royalroad.com/fiction/12345/test-fiction',
            lastReadChapterUrl: 'https://www.royalroad.com/fiction/12345/test-fiction/7',
            lastReadChapterLabel: 'Chapter 7: The New Gateway',
            coverImageUrl: 'https://example.com/cover.jpg',
            status: 'active'
          }
        }]
      },
      storage: {
        local: {
          async get(key) {
            const keys = Array.isArray(key) ? key : [key];
            return Object.fromEntries(keys.map((entry) => [entry, storage[entry]]));
          },
          async set(values) {
            Object.assign(storage, values);
          }
        }
      },
      runtime: {
        openOptionsPage: async () => {}
      }
    };

    globalThis.__novelTrackerStorage = storage;
  });

  await page.goto(popupPath);

  await expect(page.locator('#title')).toHaveValue('Test Fiction');
  await expect(page.locator('#chapter-label')).toHaveValue(/Chapter 7/i);
  await expect(page.locator('#site-pill')).toContainText(/royalroad/i);

  await page.locator('#save-button').click();
  await expect(page.locator('#status-message')).toContainText(/Added to your library|Bookmark updated/i);

  const stored = await page.evaluate(() => window.__novelTrackerStorage['novel-tracker:novels']);
  expect(Array.isArray(stored)).toBe(true);
  expect(stored.some((novel) => String(novel.lastReadChapterUrl).includes('/7'))).toBe(true);

  await browser.close();
});

test('content script forwards chapter progress on a new page', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.route('https://www.royalroad.com/**', async (route) => {
    const url = new URL(route.request().url());
    const chapter = url.pathname.endsWith('/7') ? 7 : 8;
    const title = chapter === 7 ? 'The New Gateway' : 'The Rift Opens';
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: pageHtml(chapter, title)
    });
  });

  await page.addInitScript(() => {
    globalThis.chrome = {
      runtime: {
        // content-script.js gates every send on `runtime.id` being truthy
        // (its way of detecting a live extension context) before it will
        // call sendMessage at all, so the mock needs one even though
        // nothing reads the value itself.
        id: 'test-extension-id',
        sendMessage: async (message) => {
          globalThis.__novelTrackerLastMessage = message;
          return { accepted: true };
        }
      }
    };
  });

  await page.goto('https://www.royalroad.com/fiction/12345/test-fiction/7');
  await page.addScriptTag({ path: path.join(projectRoot, 'dist', 'lib', 'parser-core.js') });
  await page.addScriptTag({ path: path.join(projectRoot, 'dist', 'lib', 'page-metadata.js') });
  await page.addScriptTag({ path: path.join(projectRoot, 'dist', 'content-script.js') });

  await page.evaluate(() => {
    history.pushState(null, '', 'https://www.royalroad.com/fiction/12345/test-fiction/8');
  });

  await expect.poll(async () => {
    const message = await page.evaluate(() => window.__novelTrackerLastMessage);
    return message?.type === 'novel-tracker:auto-progress' && message.payload?.lastReadChapterUrl?.includes('/8');
  }, { timeout: 20_000 }).toBeTruthy();

  await browser.close();
});
