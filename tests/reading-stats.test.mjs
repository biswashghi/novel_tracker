import test from "node:test";
import assert from "node:assert/strict";
import { computeReadingStats } from "../src/lib/reading-stats.js";

function novel(overrides = {}) {
  return {
    status: "active",
    chapterHistory: [],
    ...overrides
  };
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("computeReadingStats counts novels by status", () => {
  const stats = computeReadingStats([
    novel({ status: "active" }),
    novel({ status: "completed" }),
    novel({ status: "completed" }),
    novel({ status: "dropped" })
  ]);

  assert.equal(stats.totalNovels, 4);
  assert.equal(stats.activeCount, 1);
  assert.equal(stats.completedCount, 2);
});

test("computeReadingStats counts chapters read within the last week and month", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const stats = computeReadingStats([
    novel({
      chapterHistory: [
        { readAt: daysAgo(now, 1) },
        { readAt: daysAgo(now, 3) },
        { readAt: daysAgo(now, 10) },
        { readAt: daysAgo(now, 45) }
      ]
    })
  ], { now });

  assert.equal(stats.chaptersThisWeek, 2);
  assert.equal(stats.chaptersThisMonth, 3);
  assert.equal(stats.totalChaptersLogged, 4);
});

test("computeReadingStats ignores future-dated entries", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const stats = computeReadingStats([
    novel({ chapterHistory: [{ readAt: daysAgo(now, -2) }] })
  ], { now });

  assert.equal(stats.chaptersThisWeek, 0);
  assert.equal(stats.chaptersThisMonth, 0);
});

test("computeReadingStats finds a streak of consecutive reading days, counting today as current even with no entry yet", () => {
  const now = new Date("2026-06-15T09:00:00.000Z");
  const stats = computeReadingStats([
    novel({
      chapterHistory: [
        { readAt: daysAgo(now, 1) },
        { readAt: daysAgo(now, 2) },
        { readAt: daysAgo(now, 3) },
        { readAt: daysAgo(now, 5) }
      ]
    })
  ], { now });

  assert.equal(stats.streakDays, 3);
});

test("computeReadingStats resets the streak to zero once a day is skipped", () => {
  const now = new Date("2026-06-15T09:00:00.000Z");
  const stats = computeReadingStats([
    novel({ chapterHistory: [{ readAt: daysAgo(now, 2) }] })
  ], { now });

  assert.equal(stats.streakDays, 0);
});

test("computeReadingStats handles an empty library", () => {
  const stats = computeReadingStats([]);
  assert.equal(stats.totalNovels, 0);
  assert.equal(stats.streakDays, 0);
  assert.equal(stats.chaptersThisWeek, 0);
});
