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

function localDayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Chapters read per local calendar day over the last `weeks` weeks, laid out
 * as a calendar heatmap: `weeks` columns of seven days, Sunday first, ending
 * with the week that contains `now`. Days after `now` in that last week are
 * marked `future` so the grid stays rectangular without implying zero reads.
 *
 * `level` buckets each day's count into 0–4 relative to the busiest day in
 * range, so one binge does not wash every other day out to the lowest shade.
 */
export function computeReadingHeatmap(novels, { now = new Date(), weeks = 26 } = {}) {
  const counts = new Map();
  for (const date of collectReadDates(Array.isArray(novels) ? novels : [])) {
    const key = localDayKey(date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Step by calendar date at local noon, and compare day keys, never
  // midnight timestamps: where daylight saving starts at midnight (Chile,
  // the Azores, Cuba) that day has no 00:00, and midnight arithmetic drifted
  // to 01:00 and marked today as a future day.
  const todayKey = localDayKey(now);
  const firstDay = now.getDate() - now.getDay() - (weeks - 1) * 7;

  const columns = [];
  let max = 0;
  let total = 0;
  let activeDays = 0;
  for (let week = 0; week < weeks; week += 1) {
    const days = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), firstDay + week * 7 + weekday, 12);
      const key = localDayKey(date);
      const future = key > todayKey;
      const count = future ? 0 : counts.get(key) || 0;
      days.push({ date: key, count, future });
      max = Math.max(max, count);
      total += count;
      if (count) activeDays += 1;
    }
    columns.push(days);
  }

  for (const day of columns.flat()) {
    day.level = day.count === 0 || max === 0 ? 0 : Math.min(4, Math.ceil((day.count / max) * 4));
  }

  return { weeks: columns, max, total, activeDays };
}
