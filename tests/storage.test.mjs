import test from "node:test";
import assert from "node:assert/strict";

function createLocalStorage() {
  const store = new Map();

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

globalThis.localStorage = createLocalStorage();

const storageModule = await import("../src/lib/storage.js");
const {
  autoUpdateNovelProgress,
  exportNovelsJson,
  getNovels,
  getSyncState,
  importNovelsJson,
  prepareSyncForAccount,
  saveSyncState,
  upsertNovel
} = storageModule;

test("upsertNovel updates an existing Patreon entry when saving the next chapter manually", async () => {
  globalThis.localStorage.clear();

  await upsertNovel({
    title: "6.9 - Rage Against the Machine [T3]",
    sourceSite: "patreon.com",
    novelHomeUrl: "https://www.patreon.com/posts/6-9-rage-against-154102223",
    lastReadChapterUrl: "https://www.patreon.com/posts/6-9-rage-against-154102223",
    lastReadChapterLabel: "6.9 - Rage Against the Machine [T3]",
    coverImageUrl: "",
    status: "active"
  });

  await upsertNovel({
    title: "6.10 - How Green Was My Valley [T3]",
    sourceSite: "patreon.com",
    novelHomeUrl: "https://www.patreon.com/posts/6-10-how-green-154340515",
    lastReadChapterUrl: "https://www.patreon.com/posts/6-10-how-green-154340515",
    lastReadChapterLabel: "6.10 - How Green Was My Valley [T3]",
    coverImageUrl: "",
    status: "active"
  });

  const novels = await getNovels();
  assert.equal(novels.length, 1);
  assert.equal(novels[0].lastReadChapterUrl, "https://www.patreon.com/posts/6-10-how-green-154340515");
  assert.equal(novels[0].title, "6.10 - How Green Was My Valley [T3]");
  assert.equal(novels[0].chapterHistory.length, 2);
});

test("autoUpdateNovelProgress skips a Patreon home page but accepts the next Patreon chapter", async () => {
  globalThis.localStorage.clear();

  await upsertNovel({
    title: "6-9 rage against the",
    sourceSite: "patreon.com",
    novelHomeUrl: "https://www.patreon.com/c/example-author",
    lastReadChapterUrl: "https://www.patreon.com/posts/6-9-rage-against-154102223",
    lastReadChapterLabel: "6-9 rage against the",
    coverImageUrl: "",
    status: "active"
  });

  const homeResult = await autoUpdateNovelProgress({
    title: "Example Author",
    sourceSite: "patreon.com",
    novelHomeUrl: "https://www.patreon.com/c/example-author",
    lastReadChapterUrl: "https://www.patreon.com/example-author",
    lastReadChapterLabel: "Example Author home",
    coverImageUrl: ""
  });

  assert.equal(homeResult.updated, false);
  assert.equal(homeResult.reason, "not-chapter-like");

  const chapterResult = await autoUpdateNovelProgress({
    title: "6-10 how green",
    sourceSite: "patreon.com",
    novelHomeUrl: "https://www.patreon.com/c/example-author",
    lastReadChapterUrl: "https://www.patreon.com/posts/6-10-how-green-154340515",
    lastReadChapterLabel: "6-10 how green",
    coverImageUrl: ""
  });

  assert.equal(chapterResult.updated, true);
  assert.equal(chapterResult.reason, "progress-updated");

  const [novel] = await getNovels();
  assert.equal(novel.lastReadChapterUrl, "https://www.patreon.com/posts/6-10-how-green-154340515");
  assert.equal(novel.chapterHistory.length, 2);
});

test("upsertNovel keeps Royal Road chapter history on one novel", async () => {
  globalThis.localStorage.clear();

  await upsertNovel({
    title: "Chapter 383 - Exhausted",
    sourceSite: "royalroad.com",
    novelHomeUrl: "https://www.royalroad.com/fiction/67742/elydes",
    lastReadChapterUrl: "https://www.royalroad.com/fiction/67742/elydes/chapter/3210843/chapter-383-exhausted",
    lastReadChapterLabel: "Chapter 383 - Exhausted",
    coverImageUrl: "",
    status: "active"
  });

  await upsertNovel({
    title: "Chapter 384 - The Line",
    sourceSite: "royalroad.com",
    novelHomeUrl: "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line",
    lastReadChapterUrl: "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line",
    lastReadChapterLabel: "Chapter 384 - The Line",
    coverImageUrl: "",
    status: "active"
  });

  const [novel] = await getNovels();
  assert.equal((await getNovels()).length, 1);
  assert.equal(novel.lastReadChapterUrl, "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line");
  assert.equal(novel.chapterHistory.length, 2);
  assert.deepEqual(
    novel.chapterHistory.map((entry) => entry.url).sort(),
    [
      "https://www.royalroad.com/fiction/67742/elydes/chapter/3210843/chapter-383-exhausted",
      "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line"
    ].sort()
  );
});

test("upsertNovel updates existing entries for supported smaller chapter sites", async () => {
  const cases = [
    {
      title: "Scarlet Steel",
      sourceSite: "scribblehub.com",
      novelHomeUrl: "https://www.scribblehub.com/series/2291530/scarlet-steel/",
      firstUrl: "https://www.scribblehub.com/read/2291530-scarlet-steel/chapter/2470326/",
      firstLabel: "Chapter 2470326",
      nextUrl: "https://www.scribblehub.com/read/2291530-scarlet-steel/chapter/2470450/",
      nextLabel: "Chapter 2470450"
    },
    {
      title: "The Fractured Light",
      sourceSite: "creativenovels.com",
      novelHomeUrl: "https://creativenovels.com/302045/",
      firstUrl: "https://creativenovels.com/302045/chapter-1-the-boy-the-world-forgot/",
      firstLabel: "Chapter 1 — The Boy the World Forgot",
      nextUrl: "https://creativenovels.com/302045/chapter-2-the-mark-that-should-not-exist/",
      nextLabel: "Chapter 2 — The Mark That Should Not Exist"
    },
    {
      title: "I Became A Living Cheat",
      sourceSite: "lightnovelstranslations.com",
      novelHomeUrl: "https://lightnovelstranslations.com/novel/i-became-a-living-cheat/",
      firstUrl: "https://lightnovelstranslations.com/novel/i-became-a-living-cheat/chapter-364-approaching-the-seventh/",
      firstLabel: "Chapter 364: Approaching The Seventh",
      nextUrl: "https://lightnovelstranslations.com/novel/i-became-a-living-cheat/chapter-365-returning-home/",
      nextLabel: "Chapter 365: Returning Home"
    },
    {
      title: "Starting a New Life for the Discarded All-Rounder",
      sourceSite: "shintranslations.com",
      novelHomeUrl: "https://shintranslations.com",
      firstUrl: "https://shintranslations.com/starting-a-new-life-for-the-discarded-all-rounder-vol-7-chapter-26-part-3/",
      firstLabel: "Starting a New Life for the Discarded All-Rounder Vol. 7 Chapter 26 Part 3",
      nextUrl: "https://shintranslations.com/starting-a-new-life-for-the-discarded-all-rounder-vol-7-chapter-27-part-1/",
      nextLabel: "Starting a New Life for the Discarded All-Rounder Vol. 7 Chapter 27 Part 1"
    }
  ];

  for (const scenario of cases) {
    globalThis.localStorage.clear();

    await upsertNovel({
      title: scenario.title,
      sourceSite: scenario.sourceSite,
      novelHomeUrl: scenario.novelHomeUrl,
      lastReadChapterUrl: scenario.firstUrl,
      lastReadChapterLabel: scenario.firstLabel,
      coverImageUrl: "",
      status: "active"
    });

    await upsertNovel({
      title: scenario.title,
      sourceSite: scenario.sourceSite,
      novelHomeUrl: scenario.novelHomeUrl,
      lastReadChapterUrl: scenario.nextUrl,
      lastReadChapterLabel: scenario.nextLabel,
      coverImageUrl: "",
      status: "active"
    });

    const novels = await getNovels();
    assert.equal(novels.length, 1, `${scenario.sourceSite} should update the existing novel`);
    assert.equal(novels[0].lastReadChapterUrl, scenario.nextUrl);
    assert.equal(novels[0].chapterHistory.length, 2);
  }
});

test("autoUpdateNovelProgress ignores non-chapter pages on supported smaller chapter sites", async () => {
  const cases = [
    {
      title: "Scarlet Steel",
      sourceSite: "scribblehub.com",
      novelHomeUrl: "https://www.scribblehub.com/series/2291530/scarlet-steel/",
      chapterUrl: "https://www.scribblehub.com/read/2291530-scarlet-steel/chapter/2470326/",
      chapterLabel: "Chapter 2470326",
      nonChapterUrl: "https://www.scribblehub.com/series/2291530/scarlet-steel/",
      nonChapterLabel: "Scarlet Steel"
    },
    {
      title: "The Fractured Light",
      sourceSite: "creativenovels.com",
      novelHomeUrl: "https://creativenovels.com/302045/",
      chapterUrl: "https://creativenovels.com/302045/chapter-1-the-boy-the-world-forgot/",
      chapterLabel: "Chapter 1 — The Boy the World Forgot",
      nonChapterUrl: "https://creativenovels.com/302045/",
      nonChapterLabel: "The Fractured Light"
    },
    {
      title: "I Became A Living Cheat",
      sourceSite: "lightnovelstranslations.com",
      novelHomeUrl: "https://lightnovelstranslations.com/novel/i-became-a-living-cheat/",
      chapterUrl: "https://lightnovelstranslations.com/novel/i-became-a-living-cheat/chapter-364-approaching-the-seventh/",
      chapterLabel: "Chapter 364: Approaching The Seventh",
      nonChapterUrl: "https://lightnovelstranslations.com/novel/i-became-a-living-cheat/",
      nonChapterLabel: "I Became A Living Cheat"
    },
    {
      title: "Starting a New Life for the Discarded All-Rounder",
      sourceSite: "shintranslations.com",
      novelHomeUrl: "https://shintranslations.com",
      chapterUrl: "https://shintranslations.com/starting-a-new-life-for-the-discarded-all-rounder-vol-7-chapter-26-part-3/",
      chapterLabel: "Starting a New Life for the Discarded All-Rounder Vol. 7 Chapter 26 Part 3",
      nonChapterUrl: "https://shintranslations.com",
      nonChapterLabel: "Shin Translations"
    }
  ];

  for (const scenario of cases) {
    globalThis.localStorage.clear();

    await upsertNovel({
      title: scenario.title,
      sourceSite: scenario.sourceSite,
      novelHomeUrl: scenario.novelHomeUrl,
      lastReadChapterUrl: scenario.chapterUrl,
      lastReadChapterLabel: scenario.chapterLabel,
      coverImageUrl: "",
      status: "active"
    });

    const result = await autoUpdateNovelProgress({
      title: scenario.title,
      sourceSite: scenario.sourceSite,
      novelHomeUrl: scenario.novelHomeUrl,
      lastReadChapterUrl: scenario.nonChapterUrl,
      lastReadChapterLabel: scenario.nonChapterLabel,
      coverImageUrl: ""
    });

    assert.equal(result.updated, false, `${scenario.sourceSite} non-chapter page should not update progress`);

    const [novel] = await getNovels();
    assert.equal(novel.lastReadChapterUrl, scenario.chapterUrl);
    assert.equal(novel.chapterHistory.length, 1);
  }
});

test("importNovelsJson merges a backup into the existing library", async () => {
  globalThis.localStorage.clear();

  await upsertNovel({
    title: "Chapter 383 - Exhausted",
    sourceSite: "royalroad.com",
    novelHomeUrl: "https://www.royalroad.com/fiction/67742/elydes",
    lastReadChapterUrl: "https://www.royalroad.com/fiction/67742/elydes/chapter/3210843/chapter-383-exhausted",
    lastReadChapterLabel: "Chapter 383 - Exhausted",
    coverImageUrl: "",
    status: "active"
  });

  const backup = JSON.stringify({
    version: 1,
    novels: [
      {
        title: "Chapter 384 - The Line",
        sourceSite: "royalroad.com",
        novelHomeUrl: "https://www.royalroad.com/fiction/67742/elydes",
        lastReadChapterUrl: "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line",
        lastReadChapterLabel: "Chapter 384 - The Line",
        coverImageUrl: "",
        status: "active",
        chapterHistory: [
          {
            url: "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line",
            label: "Chapter 384 - The Line",
            readAt: "2026-05-05T12:00:00.000Z"
          }
        ]
      }
    ]
  });

  await importNovelsJson(backup);
  const novels = await getNovels();
  assert.equal(novels.length, 1);
  assert.equal(novels[0].chapterHistory.length, 2);

  const exported = JSON.parse(await exportNovelsJson());
  assert.equal(exported.version, 1);
  assert.equal(exported.novels.length, 1);
});

test("importNovelsJson skips blank novel entries", async () => {
  globalThis.localStorage.clear();

  await importNovelsJson(
    JSON.stringify({
      version: 1,
      novels: [
        {
          title: "",
          sourceSite: "",
          novelHomeUrl: "",
          lastReadChapterUrl: "",
          lastReadChapterLabel: ""
        }
      ]
    })
  );

  const novels = await getNovels();
  assert.equal(novels.length, 0);
});

test("legacy local data is queued for first cloud sync", async () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem("novel-tracker:novels", JSON.stringify([{
    id: "legacy-novel",
    title: "Legacy Novel",
    sourceSite: "example.test",
    lastReadChapterUrl: "https://example.test/chapter-1",
    lastReadChapterLabel: "Chapter 1",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }]));
  const state = await getSyncState();
  assert.ok(state.pendingMutations.length >= 1);
});

test("switching accounts queues a fresh snapshot of the retained local library", async () => {
  globalThis.localStorage.clear();
  await upsertNovel({
    title: "Local Novel",
    sourceSite: "example.test",
    lastReadChapterUrl: "https://example.test/chapter-1",
    lastReadChapterLabel: "Chapter 1"
  });
  const synced = await getSyncState();
  synced.pendingMutations = [];
  synced.syncAccountSubject = "old-account";
  await saveSyncState(synced);
  const switched = await prepareSyncForAccount("new-account");
  assert.equal(switched.syncAccountSubject, "new-account");
  assert.ok(switched.pendingMutations.some((item) => item.type === "novel.create"));
});
