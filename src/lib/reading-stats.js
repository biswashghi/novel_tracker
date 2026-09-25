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

  const today = startOfDay(now);
  const start = new Date(today);
  start.setDate(start.getDate() - today.getDay() - (weeks - 1) * 7);

  const columns = [];
  let max = 0;
  let total = 0;
  let activeDays = 0;
  const cursor = new Date(start);
  for (let week = 0; week < weeks; week += 1) {
    const days = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const future = cursor > today;
      const count = future ? 0 : counts.get(localDayKey(cursor)) || 0;
      days.push({ date: localDayKey(cursor), count, future });
      max = Math.max(max, count);
      total += count;
      if (count) activeDays += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(days);
  }

  for (const day of columns.flat()) {
    day.level = day.count === 0 || max === 0 ? 0 : Math.min(4, Math.ceil((day.count / max) * 4));
  }

  return { weeks: columns, max, total, activeDays };
}
