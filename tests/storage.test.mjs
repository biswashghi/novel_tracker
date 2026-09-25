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
  deleteNovel,
  exportNovelsJson,
  getDeletedNovels,
  getNovels,
  getSyncState,
  importNovelsJson,
  normalizeRating,
  normalizeTags,
  normalizeUrl,
  markAccountSynced,
  prepareSyncForAccount,
  saveChapterFromPage,
  restoreNovel,
  saveSyncState,
  updateNovel,
  upsertNovel
} = storageModule;

test("normalizeUrl rejects executable and privileged URL schemes", () => {
  assert.equal(normalizeUrl("javascript:alert(1)"), "");
  assert.equal(normalizeUrl("data:text/html,unsafe"), "");
  assert.equal(normalizeUrl("https://example.test/chapter#section"), "https://example.test/chapter");
});

test("normalizeTags trims, dedupes case-insensitively, and caps the list", () => {
  assert.deepEqual(normalizeTags("Fantasy, fantasy , Slow Burn,  , Isekai"), ["Fantasy", "Slow Burn", "Isekai"]);
  assert.deepEqual(normalizeTags(["a", "b", "a"]), ["a", "b"]);
  assert.deepEqual(normalizeTags(null), []);
  assert.equal(normalizeTags(Array.from({ length: 30 }, (_, index) => `tag-${index}`)).length, 20);
});

test("normalizeRating clamps to an integer between 0 and 5", () => {
  assert.equal(normalizeRating(3), 3);
  assert.equal(normalizeRating(4.6), 5);
  assert.equal(normalizeRating(-2), 0);
  assert.equal(normalizeRating(9), 5);
  assert.equal(normalizeRating("not a number"), 0);
});

test("upsertNovel and updateNovel persist tags, notes, and rating", async () => {
  globalThis.localStorage.clear();

  await upsertNovel({
    title: "The Long Road",
    sourceSite: "royalroad.com",
    novelHomeUrl: "https://www.royalroad.com/fiction/1/the-long-road",
    lastReadChapterUrl: "https://www.royalroad.com/fiction/1/the-long-road/chapter/1/one",
    lastReadChapterLabel: "Chapter 1",
    status: "active",
    tags: ["Fantasy", "Slow Burn"],
    notes: "Great worldbuilding.",
    rating: 4
  });

  let [novel] = await getNovels();
  assert.deepEqual(novel.tags, ["Fantasy", "Slow Burn"]);
  assert.equal(novel.notes, "Great worldbuilding.");
  assert.equal(novel.rating, 4);

  await updateNovel(novel.id, { rating: 5, tags: "Fantasy, Adventure" });

  [novel] = await getNovels();
  assert.deepEqual(novel.tags, ["Fantasy", "Adventure"]);
  assert.equal(novel.rating, 5);
  // Notes were not part of the patch, so the previous value is retained.
  assert.equal(novel.notes, "Great worldbuilding.");
});

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

test("autoUpdateNovelProgress advances Chikari novels reader routes", async () => {
  globalThis.localStorage.clear();

  await upsertNovel({
    title: "Three Days of Happiness",
    sourceSite: "chikari.moe",
    novelHomeUrl: "https://chikari.moe/novels/three-days-of-happiness",
    lastReadChapterUrl: "https://chikari.moe/novels/three-days-of-happiness/1",
    lastReadChapterLabel: "Chapter 1",
    coverImageUrl: "",
    status: "active"
  });

  const result = await autoUpdateNovelProgress({
    title: "Three Days of Happiness",
    sourceSite: "chikari.moe",
    novelHomeUrl: "https://chikari.moe/novels/three-days-of-happiness",
    lastReadChapterUrl: "https://chikari.moe/novels/three-days-of-happiness/2",
    lastReadChapterLabel: "Chapter 2",
    coverImageUrl: ""
  });

  assert.equal(result.updated, true);
  assert.equal(result.reason, "progress-updated");

  const [novel] = await getNovels();
  assert.equal(novel.lastReadChapterUrl, "https://chikari.moe/novels/three-days-of-happiness/2");
  assert.equal(novel.chapterHistory.length, 2);
});

test("autoUpdateNovelProgress repairs a Chikari record saved with a comments heading", async () => {
  globalThis.localStorage.clear();

  await upsertNovel({
    title: "The Academy’s Weapon Replicator",
    sourceSite: "chikari.moe",
    novelHomeUrl: "https://chikari.moe/novels/the-academys-weapon-replicator",
    lastReadChapterUrl: "https://chikari.moe/novels/the-academys-weapon-replicator/1",
    lastReadChapterLabel: "Comments (4)",
    coverImageUrl: "",
    status: "active"
  });

  const result = await autoUpdateNovelProgress({
    title: "The Academy’s Weapon Replicator",
    sourceSite: "chikari.moe",
    novelHomeUrl: "https://chikari.moe/novels/the-academys-weapon-replicator",
    lastReadChapterUrl: "https://chikari.moe/novels/the-academys-weapon-replicator/2",
    lastReadChapterLabel: "Chapter 1 (1) - The Academy's Weapon Replicator",
    coverImageUrl: ""
  });

  assert.equal(result.updated, true);
  assert.equal(result.reason, "progress-updated");

  const [novel] = await getNovels();
  assert.equal(novel.lastReadChapterUrl, "https://chikari.moe/novels/the-academys-weapon-replicator/2");
  assert.equal(novel.lastReadChapterLabel, "Chapter 1 (1) - The Academy's Weapon Replicator");
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
    },
    {
      title: "Omniscient Reader",
      sourceSite: "chikari.moe",
      novelHomeUrl: "https://chikari.moe/series/omniscient-reader",
      firstUrl: "https://chikari.moe/series/omniscient-reader/8",
      firstLabel: "Chapter 8 Protagonist (Part 2)",
      nextUrl: "https://chikari.moe/series/omniscient-reader/9",
      nextLabel: "Chapter 9 Protagonist (Part 3)"
    },
    {
      title: "Three Days of Happiness",
      sourceSite: "chikari.moe",
      novelHomeUrl: "https://chikari.moe/novels/three-days-of-happiness",
      firstUrl: "https://chikari.moe/novels/three-days-of-happiness/1",
      firstLabel: "Chapter 1",
      nextUrl: "https://chikari.moe/novels/three-days-of-happiness/2",
      nextLabel: "Chapter 2"
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
    },
    {
      title: "Omniscient Reader",
      sourceSite: "chikari.moe",
      novelHomeUrl: "https://chikari.moe/series/omniscient-reader",
      chapterUrl: "https://chikari.moe/series/omniscient-reader/8",
      chapterLabel: "Chapter 8 Protagonist (Part 2)",
      nonChapterUrl: "https://chikari.moe/series/omniscient-reader",
      nonChapterLabel: "Omniscient Reader"
    },
    {
      title: "Three Days of Happiness",
      sourceSite: "chikari.moe",
      novelHomeUrl: "https://chikari.moe/novels/three-days-of-happiness",
      chapterUrl: "https://chikari.moe/novels/three-days-of-happiness/1",
      chapterLabel: "Chapter 1",
      nonChapterUrl: "https://chikari.moe/novels/three-days-of-happiness",
      nonChapterLabel: "Three Days of Happiness"
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

test("importNovelsJson round-trips tags, notes, and rating", async () => {
  globalThis.localStorage.clear();

  await importNovelsJson(JSON.stringify({
    version: 1,
    novels: [
      {
        title: "Elydes",
        sourceSite: "royalroad.com",
        novelHomeUrl: "https://www.royalroad.com/fiction/67742/elydes",
        lastReadChapterUrl: "https://www.royalroad.com/fiction/67742/elydes/chapter/1/one",
        lastReadChapterLabel: "Chapter 1",
        status: "active",
        tags: ["Fantasy", "fantasy"],
        notes: "Recommended by a friend.",
        rating: 4
      }
    ]
  }));

  const [novel] = await getNovels();
  assert.deepEqual(novel.tags, ["Fantasy"]);
  assert.equal(novel.notes, "Recommended by a friend.");
  assert.equal(novel.rating, 4);

  const exported = JSON.parse(await exportNovelsJson());
  assert.deepEqual(exported.novels[0].tags, ["Fantasy"]);
  assert.equal(exported.novels[0].rating, 4);
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

test("switching back to a remembered account with an unchanged library queues nothing", async () => {
  globalThis.localStorage.clear();
  await upsertNovel({
    title: "Local Novel",
    sourceSite: "example.test",
    lastReadChapterUrl: "https://example.test/chapter-1",
    lastReadChapterLabel: "Chapter 1"
  });
  let state = await getSyncState();
  state.pendingMutations = [];
  state.syncAccountSubject = "google-user";
  state.cursor = "17";
  await markAccountSynced(state);

  await prepareSyncForAccount("apple-user");
  state = await getSyncState();
  state.pendingMutations = [];
  state.cursor = "3";
  await markAccountSynced(state);

  const back = await prepareSyncForAccount("google-user");
  assert.equal(back.syncAccountSubject, "google-user");
  assert.equal(back.cursor, "17", "resumes from the account's own cursor");
  assert.deepEqual(back.pendingMutations, [], "nothing to upload when the library is unchanged");
});

test("re-linking an account queues content-derived ids so unchanged novels dedupe server-side", async () => {
  globalThis.localStorage.clear();
  await upsertNovel({
    title: "Local Novel",
    sourceSite: "example.test",
    lastReadChapterUrl: "https://example.test/chapter-1",
    lastReadChapterLabel: "Chapter 1"
  });
  let state = await getSyncState();
  state.pendingMutations = [];
  state.syncAccountSubject = "";
  await saveSyncState(state);

  const first = await prepareSyncForAccount("google-user");
  const firstIds = first.pendingMutations.map((item) => item.mutationId);
  assert.ok(firstIds.every((id) => id.startsWith("link:google-user:")));

  state = await getSyncState();
  state.pendingMutations = [];
  await saveSyncState(state);
  await prepareSyncForAccount("apple-user");
  await upsertNovel({
    title: "Second Novel",
    sourceSite: "example.test",
    lastReadChapterUrl: "https://example.test/other/chapter-1",
    lastReadChapterLabel: "Chapter 1"
  });
  state = await getSyncState();
  state.pendingMutations = [];
  await saveSyncState(state);

  const again = await prepareSyncForAccount("google-user");
  const againIds = again.pendingMutations.map((item) => item.mutationId);
  for (const id of firstIds) assert.ok(againIds.includes(id), `unchanged novel keeps id ${id}`);
  assert.equal(againIds.length, firstIds.length + 1, "only the novel added meanwhile is new");
});

test("importing a backup keeps the device linked to its synced account", async () => {
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

  const linked = await getSyncState();
  linked.pendingMutations = [];
  linked.cursor = "42";
  linked.syncAccountSubject = "reader@example.test";
  await saveSyncState(linked);

  await importNovelsJson(JSON.stringify({
    version: 1,
    novels: [
      {
        title: "Chapter 384 - The Line",
        sourceSite: "royalroad.com",
        novelHomeUrl: "https://www.royalroad.com/fiction/67742/elydes",
        lastReadChapterUrl: "https://www.royalroad.com/fiction/67742/elydes/chapter/3227191/chapter-384-the-line",
        lastReadChapterLabel: "Chapter 384 - The Line",
        coverImageUrl: "",
        status: "active"
      }
    ]
  }));

  const afterImport = await getSyncState();
  assert.equal(afterImport.deviceId, linked.deviceId);
  assert.equal(afterImport.syncAccountSubject, "reader@example.test");
  assert.equal(afterImport.cursor, "42");
});

test("localStorage fallback persists every key, not just the first", async () => {
  globalThis.localStorage.clear();

  await upsertNovel({
    title: "Fallback Novel",
    sourceSite: "royalroad.com",
    novelHomeUrl: "https://www.royalroad.com/fiction/9/fallback",
    lastReadChapterUrl: "https://www.royalroad.com/fiction/9/fallback/chapter/1/one",
    lastReadChapterLabel: "Chapter 1"
  });

  const syncRaw = globalThis.localStorage.getItem("novel-tracker:sync-state");
  const novelsRaw = globalThis.localStorage.getItem("novel-tracker:novels");
  assert.ok(syncRaw, "sync-state key should be persisted by the fallback");
  assert.ok(novelsRaw, "novels key should be persisted by the fallback");

  const parsedSync = JSON.parse(syncRaw);
  assert.equal(parsedSync.version, 1);
  const parsedNovels = JSON.parse(novelsRaw);
  assert.equal(parsedNovels.length, 1);
  assert.equal(parsedNovels[0].title, "Fallback Novel");
});

const { createSerialQueue } = await import("../src/lib/sync-service.js");

test("concurrent library writers drop mutations unless they are serialized", async () => {
  // Every mutation is a read-modify-write of the whole sync blob, so two
  // writers that read before either writes will clobber each other's
  // pendingMutations — the queued sync operation of the loser vanishes. This
  // is the race the background service worker's single-writer queue exists to
  // prevent; see src/background.js.
  const writes = () => [
    () => upsertNovel({
      title: "Racer One",
      sourceSite: "royalroad.com",
      novelHomeUrl: "https://www.royalroad.com/fiction/101/one",
      lastReadChapterUrl: "https://www.royalroad.com/fiction/101/one/chapter/1/a",
      lastReadChapterLabel: "Chapter 1"
    }),
    () => upsertNovel({
      title: "Racer Two",
      sourceSite: "scribblehub.com",
      novelHomeUrl: "https://www.scribblehub.com/series/202/two",
      lastReadChapterUrl: "https://www.scribblehub.com/read/202-two/chapter/1",
      lastReadChapterLabel: "Chapter 1"
    })
  ];

  globalThis.localStorage.clear();
  await Promise.all(writes().map((run) => run()));
  const raced = await getNovels();
  const racedPending = (await getSyncState()).pendingMutations.length;

  globalThis.localStorage.clear();
  const queue = createSerialQueue();
  await Promise.all(writes().map((run) => queue(run)));
  const serialized = await getNovels();
  const serializedPending = (await getSyncState()).pendingMutations.length;

  assert.equal(serialized.length, 2, "serialized writers both land");
  assert.deepEqual(
    serialized.map((novel) => novel.title).sort(),
    ["Racer One", "Racer Two"]
  );
  assert.ok(serializedPending >= 2, "each serialized write leaves its mutation queued for sync");
  assert.ok(
    raced.length < serialized.length || racedPending < serializedPending,
    `unserialized writers must lose work (novels ${raced.length}/${serialized.length}, pending ${racedPending}/${serializedPending})`
  );
});

test("the serial queue keeps running after a task rejects", async () => {
  const order = [];
  const queue = createSerialQueue();
  const failing = queue(async () => {
    order.push("first");
    throw new Error("boom");
  });
  const following = queue(async () => {
    order.push("second");
    return "ok";
  });

  await assert.rejects(failing, /boom/);
  assert.equal(await following, "ok");
  assert.deepEqual(order, ["first", "second"]);
});

test("upsertNovel keeps two novels apart when their chapter URLs share a shape", async () => {
  globalThis.localStorage.clear();

  const first = await upsertNovel({
    title: "Shadow Slave",
    sourceSite: "novelfire.net",
    novelHomeUrl: "https://novelfire.net/book/shadow-slave",
    lastReadChapterUrl: "https://novelfire.net/book/shadow-slave/chapter-118",
    lastReadChapterLabel: "Chapter 118"
  });
  const second = await upsertNovel({
    title: "Lord of the Mysteries",
    sourceSite: "novelfire.net",
    novelHomeUrl: "https://novelfire.net/book/lord-of-the-mysteries",
    lastReadChapterUrl: "https://novelfire.net/book/lord-of-the-mysteries/chapter-21",
    lastReadChapterLabel: "Chapter 21"
  });

  assert.notEqual(second.id, first.id);
  assert.equal((await getNovels()).length, 2);

  const progress = await autoUpdateNovelProgress({
    title: "Lord of the Mysteries",
    sourceSite: "novelfire.net",
    novelHomeUrl: "https://novelfire.net/book/lord-of-the-mysteries",
    lastReadChapterUrl: "https://novelfire.net/book/lord-of-the-mysteries/chapter-22",
    lastReadChapterLabel: "Chapter 22"
  });
  assert.equal(progress.novel.id, second.id);
  const shadowSlave = (await getNovels()).find((novel) => novel.id === first.id);
  assert.equal(shadowSlave.lastReadChapterLabel, "Chapter 118");
});

test("autoUpdateNovelProgress keeps tracking when the parser's novel page changes form", async () => {
  // Saved before a parser learned the real novel page, or reached through a
  // different spelling of the same page: exact identity still wins.
  const cases = [
    {
      name: "Shin Translations record saved with the site root as its home",
      saved: {
        title: "TNG",
        sourceSite: "shintranslations.com",
        novelHomeUrl: "https://shintranslations.com",
        lastReadChapterUrl: "https://shintranslations.com/chapter/tng-vol-22-chapter-4-part-1/",
        lastReadChapterLabel: "TNG Vol. 22 Chapter 4 Part 1"
      },
      next: {
        title: "THE NEW GATE",
        sourceSite: "shintranslations.com",
        novelHomeUrl: "https://shintranslations.com/series/the-new-gate-tng-toc/",
        lastReadChapterUrl: "https://shintranslations.com/chapter/tng-vol-22-chapter-4-part-2/",
        lastReadChapterLabel: "TNG Vol. 22 Chapter 4 Part 2"
      }
    },
    {
      name: "Patreon post opened with a tracking query",
      saved: {
        title: "DoF 1.6 - A New Home",
        sourceSite: "patreon.com",
        novelHomeUrl: "https://www.patreon.com/posts/dof-1-6-new-home-167109588",
        lastReadChapterUrl: "https://www.patreon.com/posts/dof-1-6-new-home-167109588",
        lastReadChapterLabel: "DoF 1.6 - A New Home"
      },
      next: {
        title: "DoF 1.7 - Buzzing",
        sourceSite: "patreon.com",
        novelHomeUrl: "https://www.patreon.com/posts/dof-1-7-buzzing-167546160",
        lastReadChapterUrl: "https://www.patreon.com/posts/dof-1-7-buzzing-167546160?utm_source=email",
        lastReadChapterLabel: "DoF 1.7 - Buzzing"
      }
    },
    {
      name: "the same novel page with and without www.",
      saved: {
        title: "Shadow Slave",
        sourceSite: "webnovel.com",
        novelHomeUrl: "https://www.webnovel.com/book/shadow-slave_22196546206090805",
        lastReadChapterUrl: "https://www.webnovel.com/book/shadow-slave_22196546206090805/one_1",
        lastReadChapterLabel: "Chapter 1: One"
      },
      next: {
        title: "Shadow Slave (renamed on site)",
        sourceSite: "webnovel.com",
        novelHomeUrl: "https://webnovel.com/book/shadow-slave_22196546206090805/",
        lastReadChapterUrl: "https://www.webnovel.com/book/shadow-slave_22196546206090805/two_2",
        lastReadChapterLabel: "Chapter 2: Two"
      }
    }
  ];

  for (const { name, saved, next } of cases) {
    globalThis.localStorage.clear();
    const stored = await upsertNovel(saved);
    const result = await autoUpdateNovelProgress(next);
    assert.equal(result.updated, true, `${name}: ${result.reason}`);
    assert.equal(result.novel.id, stored.id, name);
    assert.equal(result.novel.lastReadChapterLabel, next.lastReadChapterLabel, name);
  }
});

test("autoUpdateNovelProgress follows Wattpad parts, whose URLs share no path", async () => {
  globalThis.localStorage.clear();

  const saved = await upsertNovel({
    title: "Empire of Ashes",
    sourceSite: "wattpad.com",
    novelHomeUrl: "https://www.wattpad.com/story/66766637-empire-of-ashes",
    lastReadChapterUrl: "https://www.wattpad.com/235603347-empire-of-ashes-preview",
    lastReadChapterLabel: "Preview"
  });

  const result = await autoUpdateNovelProgress({
    title: "Empire of Ashes",
    sourceSite: "wattpad.com",
    novelHomeUrl: "https://www.wattpad.com/story/66766637-empire-of-ashes",
    lastReadChapterUrl: "https://www.wattpad.com/235603690-empire-of-ashes-chapter-i-chains-and-bones",
    lastReadChapterLabel: "Chapter I - Chains and Bones"
  });

  assert.equal(result.updated, true, result.reason);
  assert.equal(result.novel.id, saved.id);
  assert.equal(result.novel.lastReadChapterLabel, "Chapter I - Chains and Bones");
});

test("saveChapterFromPage keeps a tracked novel's status, novel page and cover", async () => {
  globalThis.localStorage.clear();

  const saved = await upsertNovel({
    title: "Some Novel",
    sourceSite: "example.com",
    novelHomeUrl: "https://example.com/novels/some-novel",
    lastReadChapterUrl: "https://example.com/novels/some-novel/chapter-1",
    lastReadChapterLabel: "Chapter 1",
    coverImageUrl: "https://example.com/covers/some-novel.jpg",
    status: "paused"
  });

  // What the shortcut reads from a generic chapter page: no cover, and the
  // chapter itself standing in for the novel page.
  const result = await saveChapterFromPage({
    title: "Some Novel",
    lastReadChapterUrl: "https://example.com/novels/some-novel/chapter-2",
    lastReadChapterLabel: "Chapter 2",
    novelHomeUrl: "https://example.com/novels/some-novel/chapter-2",
    coverImageUrl: ""
  });

  assert.equal(result.id, saved.id);
  assert.equal(result.lastReadChapterLabel, "Chapter 2");
  assert.equal(result.status, "paused");
  assert.equal(result.novelHomeUrl, "https://example.com/novels/some-novel");
  assert.equal(result.coverImageUrl, "https://example.com/covers/some-novel.jpg");
});

test("getDeletedNovels lists restorable novels until restoreNovel brings them back", async () => {
  globalThis.localStorage.clear();

  const saved = await upsertNovel({
    title: "Gone Tomorrow",
    sourceSite: "royalroad.com",
    novelHomeUrl: "https://www.royalroad.com/fiction/9/gone-tomorrow",
    lastReadChapterUrl: "https://www.royalroad.com/fiction/9/gone-tomorrow/chapter/3/three",
    lastReadChapterLabel: "Chapter 3",
    tags: ["keep"]
  });
  assert.deepEqual(await getDeletedNovels(), []);

  await deleteNovel(saved.id);
  assert.deepEqual(await getNovels(), []);

  const [deleted] = await getDeletedNovels();
  assert.equal(deleted.id, saved.id);
  assert.equal(deleted.title, "Gone Tomorrow");
  assert.equal(deleted.lastReadChapterLabel, "Chapter 3");
  assert.deepEqual(deleted.tags, ["keep"]);
  // Offered until a day before the 30-day tombstone could be purged.
  assert.equal(Date.parse(deleted.purgeAt) - Date.parse(deleted.deletedAt), 29 * 24 * 60 * 60 * 1000);

  await restoreNovel(saved.id);
  assert.deepEqual(await getDeletedNovels(), []);
  const [restored] = await getNovels();
  assert.equal(restored.id, saved.id);
  assert.equal(restored.lastReadChapterUrl, "https://www.royalroad.com/fiction/9/gone-tomorrow/chapter/3/three");
});

test("getDeletedNovels times the restore window from the delete's own clock", async () => {
  globalThis.localStorage.clear();
  const DAY = 24 * 60 * 60 * 1000;

  const recent = await upsertNovel({
    title: "Deleted Recently",
    sourceSite: "example.com",
    novelHomeUrl: "https://example.com/recent",
    lastReadChapterUrl: "https://example.com/recent/chapter-1"
  });
  const old = await upsertNovel({
    title: "Deleted Long Ago",
    sourceSite: "example.com",
    novelHomeUrl: "https://example.com/old",
    lastReadChapterUrl: "https://example.com/old/chapter-1"
  });
  await deleteNovel(recent.id);
  await deleteNovel(old.id);

  // As if the old delete had been made 29.5 days ago on another device but
  // only pulled here today: deletedAtMs (local apply time) is fresh, the
  // delete's clock is not.
  const state = await getSyncState();
  state.novels[old.id].deletedAt = { ...state.novels[old.id].deletedAt, wallMs: Date.now() - 29.5 * DAY };
  // And a tombstone for a novel this device never had any fields for.
  state.novels["ghost"] = { id: "ghost", generation: 1, lifecycle: "deleted", fields: {}, chapterHistory: {}, headCheckpointId: "", deletedAt: { wallMs: Date.now(), logical: 0, actorId: "x" }, deletedAtMs: Date.now() };
  await saveSyncState(state);

  const listed = await getDeletedNovels();
  assert.deepEqual(listed.map((novel) => novel.title), ["Deleted Recently"]);
});

test("importNovelsJson keeps each chapter's original read time", async () => {
  globalThis.localStorage.clear();

  await importNovelsJson(JSON.stringify({
    version: 1,
    novels: [{
      title: "Old Favourite",
      sourceSite: "example.com",
      novelHomeUrl: "https://example.com/old-favourite",
      lastReadChapterUrl: "https://example.com/old-favourite/3",
      lastReadChapterLabel: "Chapter 3",
      updatedAt: "2025-05-03T10:00:00.000Z",
      chapterHistory: [
        { url: "https://example.com/old-favourite/1", label: "Chapter 1", readAt: "2025-05-01T10:00:00.000Z" },
        { url: "https://example.com/old-favourite/2", label: "Chapter 2", readAt: "2025-05-02T10:00:00.000Z" },
        { url: "https://example.com/old-favourite/3", label: "Chapter 3", readAt: "2025-05-03T10:00:00.000Z" }
      ]
    }]
  }));

  const [novel] = await getNovels();
  assert.deepEqual(novel.chapterHistory.map((entry) => entry.readAt), [
    "2025-05-01T10:00:00.000Z",
    "2025-05-02T10:00:00.000Z",
    "2025-05-03T10:00:00.000Z"
  ]);
  assert.equal(novel.updatedAt, "2025-05-03T10:00:00.000Z");
  assert.equal(novel.lastReadChapterLabel, "Chapter 3");

  // The local clock still moves forward, so the next real read sorts after them.
  const state = await getSyncState();
  assert.ok(state.clock.wallMs >= Date.parse("2025-05-03T10:00:00.000Z"));
  assert.equal(state.pendingMutations.length, 3);
});
