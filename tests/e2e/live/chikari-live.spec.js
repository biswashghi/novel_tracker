import {
  test,
  expect,
  extensionUrl,
  stubActiveTab
} from '../fixtures/extension.js';

const scenario = {
  title: 'Omniscient Reader',
  homeUrl: 'https://chikari.moe/series/omniscient-reader',
  firstUrl: 'https://chikari.moe/series/omniscient-reader/8',
  firstLabel: 'Chapter 8',
  nextUrl: 'https://chikari.moe/series/omniscient-reader/9',
  nextLabel: 'Chapter 9',
  readerSelector: 'img[alt="Page 1"]'
};

async function waitForReader(page, scenario, url) {
  let upstreamBlocked = false;
  const watchResponse = (response) => {
    const resourceType = response.request().resourceType();
    if ([403, 503].includes(response.status()) && ['document', 'xhr', 'fetch'].includes(resourceType)) {
      upstreamBlocked = true;
    }
  };
  page.on('response', watchResponse);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await expect(page.locator(scenario.readerSelector).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.title(), { timeout: 30_000 }).toMatch(/^Chapter\s+/i);
  } catch (error) {
    const offline = await page.getByText(/status:\s*offline|checking back automatically/i).first().isVisible();
    test.skip(upstreamBlocked || offline, 'Chikari did not serve reader content to this canary');
    throw error;
  } finally {
    page.off('response', watchResponse);
  }
}

async function readLibrary(extensionPage) {
  return extensionPage.evaluate(async () => {
    const { getNovels } = await import(chrome.runtime.getURL('lib/storage.js'));
    return getNovels();
  });
}

test('Chikari live flow saves and advances a current series', async ({
  context,
  extensionId,
  serviceWorker
}) => {
  const sitePage = await context.newPage();
  await waitForReader(sitePage, scenario, scenario.firstUrl);

  const popupPage = await context.newPage();
  await stubActiveTab(popupPage, serviceWorker, scenario.firstUrl);
  await popupPage.goto(extensionUrl(extensionId, 'popup.html'));

  await expect(popupPage.locator('#title')).toHaveValue(scenario.title, { timeout: 20_000 });
  await expect(popupPage.locator('#home-url')).toHaveValue(scenario.homeUrl);
  await expect(popupPage.locator('#chapter-label')).toHaveValue(scenario.firstLabel);

  await popupPage.locator('#save-button').click();
  await expect(popupPage.locator('#status-message')).toContainText(/Added to your library|Bookmark updated/i);

  await waitForReader(sitePage, scenario, scenario.nextUrl);

  await expect.poll(
    async () => {
      const novels = await readLibrary(popupPage);
      return novels.find((novel) => novel.novelHomeUrl === scenario.homeUrl)?.lastReadChapterUrl;
    },
    { timeout: 30_000 }
  ).toBe(scenario.nextUrl);

  const novels = await readLibrary(popupPage);
  const novel = novels.find((item) => item.novelHomeUrl === scenario.homeUrl);
  expect(novel).toBeTruthy();
  expect(novel.title).toBe(scenario.title);
  expect(novel.lastReadChapterLabel).toBe(scenario.nextLabel);
  expect(novel.chapterHistory).toHaveLength(2);
  await popupPage.close();
});
