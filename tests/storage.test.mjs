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
const { autoUpdateNovelProgress, exportNovelsJson, getNovels, importNovelsJson, upsertNovel } = storageModule;

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
