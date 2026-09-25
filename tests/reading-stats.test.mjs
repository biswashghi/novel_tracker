import test from "node:test";
import assert from "node:assert/strict";
import { computeReadingHeatmap, computeReadingStats } from "../src/lib/reading-stats.js";

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

test("computeReadingHeatmap lays out whole weeks ending with the current one", () => {
  // Wednesday 2026-09-23, local time.
  const now = new Date(2026, 8, 23, 20, 0, 0);
  const heatmap = computeReadingHeatmap([], { now, weeks: 4 });

  assert.equal(heatmap.weeks.length, 4);
  assert.ok(heatmap.weeks.every((week) => week.length === 7));
  assert.equal(heatmap.weeks[0][0].date, "2026-08-30"); // a Sunday, three weeks before this week's
  assert.equal(heatmap.weeks[3][3].date, "2026-09-23");
  assert.equal(heatmap.weeks[3][3].future, false);
  assert.equal(heatmap.weeks[3][4].future, true);
  assert.deepEqual({ max: heatmap.max, total: heatmap.total, activeDays: heatmap.activeDays }, { max: 0, total: 0, activeDays: 0 });
});

test("computeReadingHeatmap counts chapters per local day and scales levels to the busiest day", () => {
  const now = new Date(2026, 8, 23, 20, 0, 0);
  const at = (day, hour) => new Date(2026, 8, day, hour, 0, 0).toISOString();
  const heatmap = computeReadingHeatmap([
    novel({ chapterHistory: [{ readAt: at(23, 9) }, { readAt: at(23, 21) }, { readAt: at(21, 8) }] }),
    novel({ chapterHistory: [{ readAt: at(23, 12) }, { readAt: at(23, 13) }, { readAt: at(20, 23) }] }),
    // Outside the four-week window, and in the future: both ignored.
    novel({ chapterHistory: [{ readAt: new Date(2026, 5, 1).toISOString() }, { readAt: at(25, 10) }, { readAt: "not a date" }] })
  ], { now, weeks: 4 });

  const byDate = Object.fromEntries(heatmap.weeks.flat().map((day) => [day.date, day]));
  assert.equal(byDate["2026-09-23"].count, 4);
  assert.equal(byDate["2026-09-23"].level, 4);
  assert.equal(byDate["2026-09-21"].count, 1);
  assert.equal(byDate["2026-09-21"].level, 1);
  assert.equal(byDate["2026-09-20"].count, 1);
  assert.equal(byDate["2026-09-25"].count, 0);
  assert.deepEqual({ max: heatmap.max, total: heatmap.total, activeDays: heatmap.activeDays }, { max: 4, total: 6, activeDays: 3 });
});
