import {
  test,
  expect,
  extensionUrl,
  stubActiveTab
} from '../fixtures/extension.js';

const scenarios = [
  {
    name: "Academy's Weapon Replicator",
    title: "The Academy’s Weapon Replicator",
    homeUrl: 'https://chikari.moe/novels/the-academys-weapon-replicator',
    firstUrl: 'https://chikari.moe/novels/the-academys-weapon-replicator/1',
    firstLabel: 'Chapter 1 · Prologue',
    nextUrl: 'https://chikari.moe/novels/the-academys-weapon-replicator/2',
    nextLabel: "Chapter 1 (1) - The Academy's Weapon Replicator",
    readerSelector: 'main header p'
  },
  {
    name: 'Three Days of Happiness',
    title: 'Three Days of Happiness',
    homeUrl: 'https://chikari.moe/novels/three-days-of-happiness',
    firstUrl: 'https://chikari.moe/novels/three-days-of-happiness/1',
    firstLabel: 'Chapter 1 A Promise For Ten Years Time',
    nextUrl: 'https://chikari.moe/novels/three-days-of-happiness/2',
    nextLabel: 'Chapter 2 The Beginning of the End',
    readerSelector: 'main header p'
  },
  {
    name: 'Shadow Slave',
    title: 'Shadow Slave',
    homeUrl: 'https://chikari.moe/novels/shadow-slave',
    firstUrl: 'https://chikari.moe/novels/shadow-slave/2',
    firstLabel: 'Chapter 2 - 2: Slave Caravan',
    nextUrl: 'https://chikari.moe/novels/shadow-slave/3',
    nextLabel: 'Chapter 3 - 3: The Strings of Fate',
    readerSelector: 'main header p'
  },
  {
    name: 'Omniscient Reader series',
    title: 'Omniscient Reader',
    homeUrl: 'https://chikari.moe/series/omniscient-reader',
    firstUrl: 'https://chikari.moe/series/omniscient-reader/8',
    firstLabel: 'Chapter 8',
    nextUrl: 'https://chikari.moe/series/omniscient-reader/9',
    nextLabel: 'Chapter 9',
    readerSelector: 'img[alt="Page 1"]'
  }
];

async function waitForReader(page, scenario, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(scenario.readerSelector).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.title(), { timeout: 30_000 }).toMatch(/^Chapter\s+/i);
}

async function readLibrary(extensionPage) {
  return extensionPage.evaluate(async () => {
    const { getNovels } = await import(chrome.runtime.getURL('lib/storage.js'));
    return getNovels();
  });
}

for (const scenario of scenarios) {
  test(`Chikari live flow saves and advances ${scenario.name}`, async ({
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
    await expect(popupPage.locator('#chapter-label')).not.toHaveValue(/Comments/i);

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
}
