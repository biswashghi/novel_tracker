import test from "node:test";
import assert from "node:assert/strict";
import { sortNovels } from "../src/lib/library-sort.js";

const history = (count) => Array.from({ length: count }, () => ({}));
const novels = [
  { title: "Beta", sourceSite: "b.com", rating: 4, createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", chapterHistory: history(5) },
  { title: "Alpha", sourceSite: "c.com", rating: 5, createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z", chapterHistory: history(40) },
  { title: "Gamma", sourceSite: "a.com", rating: 0, createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", chapterHistory: history(12) }
];
const titles = (mode) => sortNovels(novels, mode).map((novel) => novel.title);

test("sortNovels orders by recency, staleness, date added and chapters read", () => {
  assert.deepEqual(titles("updated"), ["Gamma", "Beta", "Alpha"]);
  assert.deepEqual(titles("stale"), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(titles("added"), ["Alpha", "Gamma", "Beta"]);
  assert.deepEqual(titles("chapters"), ["Alpha", "Gamma", "Beta"]);
});

test("sortNovels keeps the existing title, source and rating orders", () => {
  assert.deepEqual(titles("title"), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(titles("source"), ["Gamma", "Beta", "Alpha"]);
  assert.deepEqual(titles("rating"), ["Alpha", "Beta", "Gamma"]);
});

test("sortNovels falls back to most recent for unknown modes and does not mutate its input", () => {
  const before = novels.map((novel) => novel.title);
  assert.deepEqual(titles("nonsense"), ["Gamma", "Beta", "Alpha"]);
  assert.deepEqual(novels.map((novel) => novel.title), before);
});
