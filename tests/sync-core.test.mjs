import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMutation,
  applyMutationBatch,
  createSyncState,
  findCanonicalNovelId,
  materializeNovel,
  purgeExpiredTombstones,
  TOMBSTONE_RETENTION_MS
} from "../src/lib/sync-core.js";

const deviceA = "device-a";
const deviceB = "device-b";
const baseClock = (wallMs, actorId = deviceA, logical = 0) => ({ wallMs, logical, actorId });

function mutation(overrides = {}) {
  return {
    mutationId: "mutation-1",
    deviceId: deviceA,
    novelId: "novel-1",
    generation: 1,
    clock: baseClock(100),
    type: "novel.create",
    payload: { title: "Novel", status: "active" },
    ...overrides
  };
}

test("offline checkpoint events merge as an append-only set and newest read wins", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  state = applyMutation(state, mutation());
  state = applyMutationBatch(state, [
    mutation({
      mutationId: "chapter-a",
      type: "checkpoint.record",
      clock: baseClock(200, deviceA),
      payload: { event: { id: "event-a", url: "https://example.test/chapter-12", label: "Chapter 12", readAt: baseClock(200, deviceA) } }
    }),
    mutation({
      mutationId: "chapter-b",
      deviceId: deviceB,
      type: "checkpoint.record",
      clock: baseClock(300, deviceB),
      payload: { event: { id: "event-b", url: "https://example.test/chapter-2", label: "Chapter 2", readAt: baseClock(300, deviceB) } }
    })
  ]);

  const novel = materializeNovel(state.novels["novel-1"]);
  assert.equal(novel.chapterHistory.length, 2);
  assert.equal(novel.lastReadChapterLabel, "Chapter 2");
});

test("mutation retries are idempotent", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  const chapter = mutation({
    mutationId: "same-event",
    type: "novel.create",
    payload: {
      title: "Novel",
      event: { id: "event-1", url: "https://example.test/chapter-1", label: "Chapter 1", readAt: baseClock(100) }
    }
  });
  state = applyMutation(state, chapter);
  state = applyMutation(state, chapter);
  assert.equal(materializeNovel(state.novels["novel-1"]).chapterHistory.length, 1);
});

test("a tombstone suppresses stale patches until explicit restore", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  state = applyMutation(state, mutation());
  state = applyMutation(state, mutation({ mutationId: "delete", type: "novel.delete", clock: baseClock(200) }));
  state = applyMutation(state, mutation({ mutationId: "stale-patch", type: "novel.patch", clock: baseClock(500, deviceB), payload: { title: "Zombie" } }));
  assert.equal(materializeNovel(state.novels["novel-1"]), null);

  state = applyMutation(state, mutation({ mutationId: "restore", type: "novel.restore", clock: baseClock(600), payload: {} }));
  assert.equal(state.novels["novel-1"].generation, 2);
  assert.equal(materializeNovel(state.novels["novel-1"]).title, "Novel");
  state = applyMutation(state, mutation({ mutationId: "old-generation", generation: 1, type: "novel.patch", clock: baseClock(700), payload: { title: "Still stale" } }));
  assert.equal(materializeNovel(state.novels["novel-1"]).title, "Novel");
});

test("field-level LWW registers preserve unrelated concurrent edits", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  state = applyMutation(state, mutation());
  state = applyMutationBatch(state, [
    mutation({ mutationId: "title", type: "novel.patch", clock: baseClock(200, deviceA), payload: { title: "Renamed" } }),
    mutation({ mutationId: "status", type: "novel.patch", clock: baseClock(200, deviceB), payload: { status: "paused" } })
  ]);
  const novel = materializeNovel(state.novels["novel-1"]);
  assert.equal(novel.title, "Renamed");
  assert.equal(novel.status, "paused");
});

test("tags, notes, and rating are field-level LWW registers like any other field", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  state = applyMutation(state, mutation({ payload: { title: "Novel", status: "active" } }));
  state = applyMutation(state, mutation({
    mutationId: "organize",
    type: "novel.patch",
    clock: baseClock(200, deviceA),
    payload: { tags: ["fantasy"], notes: "Reread later", rating: 4 }
  }));
  const novel = materializeNovel(state.novels["novel-1"]);
  assert.deepEqual(novel.tags, ["fantasy"]);
  assert.equal(novel.notes, "Reread later");
  assert.equal(novel.rating, 4);
});

test("novels created before tags/notes/rating existed still materialize with safe defaults", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  state = applyMutation(state, mutation({ payload: { title: "Legacy Novel", status: "active" } }));
  const novel = materializeNovel(state.novels["novel-1"]);
  assert.deepEqual(novel.tags, []);
  assert.equal(novel.notes, "");
  assert.equal(novel.rating, 0);
});

test("expired tombstones are purged after the retention window", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  state = applyMutation(state, mutation());
  state = applyMutation(state, mutation({ mutationId: "delete", type: "novel.delete", clock: baseClock(100) }), { now: 100 });
  state = purgeExpiredTombstones(state, 100 + TOMBSTONE_RETENTION_MS);
  assert.equal(state.novels["novel-1"], undefined);
});

test("first sync maps a matching local novel to the cloud canonical id", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  state = applyMutation(state, mutation({
    novelId: "cloud-id",
    payload: {
      title: "The Same Novel",
      sourceSite: "royalroad.com",
      novelHomeUrl: "https://www.royalroad.com/fiction/42/the-same-novel"
    }
  }));
  const canonicalId = findCanonicalNovelId(state, mutation({
    mutationId: "local-create",
    novelId: "local-id",
    deviceId: deviceB,
    payload: {
      title: "The Same Novel",
      sourceSite: "royalroad.com",
      novelHomeUrl: "https://www.royalroad.com/fiction/42/the-same-novel"
    }
  }));
  assert.equal(canonicalId, "cloud-id");
});

test("first sync keeps a distinct local novel id when no identity matches", () => {
  const state = createSyncState({ deviceId: deviceA, now: 0 });
  assert.equal(findCanonicalNovelId(state, mutation({ novelId: "local-id" })), "local-id");
});

test("equal field clocks use server sequence and then mutation id deterministically", () => {
  let state = createSyncState({ deviceId: deviceA, now: 0 });
  const clock = baseClock(100);
  state = applyMutation(state, mutation({ mutationId: "a", clock, serverSequence: 1, payload: { title: "First" } }));
  state = applyMutation(state, mutation({ mutationId: "b", type: "novel.patch", clock, serverSequence: 2, payload: { title: "Second" } }));
  state = applyMutation(state, mutation({ mutationId: "z", type: "novel.patch", clock, serverSequence: 2, payload: { title: "Tie winner" } }));
  assert.equal(materializeNovel(state.novels["novel-1"]).title, "Tie winner");
});
