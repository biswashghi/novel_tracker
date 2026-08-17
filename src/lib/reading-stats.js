const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

function dateKey(date) {
  return date.toDateString();
}

function collectReadDates(novels) {
  const dates = [];
  for (const novel of novels) {
    for (const entry of novel?.chapterHistory || []) {
      const date = new Date(entry?.readAt);
      if (!Number.isNaN(date.getTime())) dates.push(date);
    }
  }
  return dates;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Derives library-wide reading stats from the novels the library already
 * stores (each novel's chapterHistory carries an ISO readAt timestamp per
 * checkpoint). Pure function of its inputs so it is easy to unit test and
 * can be reused anywhere the novel list is already materialized.
 */
export function computeReadingStats(novels, { now = new Date() } = {}) {
  const list = Array.isArray(novels) ? novels : [];
  const readDates = collectReadDates(list);
  const nowTime = now.getTime();

  const chaptersThisWeek = readDates.filter((date) => {
    const delta = nowTime - date.getTime();
    return delta >= 0 && delta <= WEEK_MS;
  }).length;

  const chaptersThisMonth = readDates.filter((date) => {
    const delta = nowTime - date.getTime();
    return delta >= 0 && delta <= MONTH_MS;
  }).length;

  const activeDayKeys = new Set(readDates.map(dateKey));

  let streakDays = 0;
  let cursor = startOfDay(now);
  if (!activeDayKeys.has(dateKey(cursor))) {
    // Today has no activity yet; a streak is still "current" as long as
    // yesterday had activity, so start checking from there instead.
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  while (activeDayKeys.has(dateKey(cursor))) {
    streakDays += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  return {
    totalNovels: list.length,
    activeCount: list.filter((novel) => novel?.status === "active").length,
    completedCount: list.filter((novel) => novel?.status === "completed").length,
    totalChaptersLogged: readDates.length,
    chaptersThisWeek,
    chaptersThisMonth,
    streakDays
  };
}
