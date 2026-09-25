function time(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function chaptersRead(novel) {
  return Array.isArray(novel.chapterHistory) ? novel.chapterHistory.length : 0;
}

const byRecent = (a, b) => time(b.updatedAt) - time(a.updatedAt);

const COMPARATORS = {
  updated: byRecent,
  // Longest untouched first: surfaces novels you have fallen behind on.
  stale: (a, b) => time(a.updatedAt) - time(b.updatedAt),
  added: (a, b) => time(b.createdAt) - time(a.createdAt) || byRecent(a, b),
  chapters: (a, b) => chaptersRead(b) - chaptersRead(a) || byRecent(a, b),
  title: (a, b) => a.title.localeCompare(b.title),
  source: (a, b) => a.sourceSite.localeCompare(b.sourceSite) || a.title.localeCompare(b.title),
  rating: (a, b) => (b.rating || 0) - (a.rating || 0) || byRecent(a, b)
};

export const SORT_MODES = Object.freeze(Object.keys(COMPARATORS));

/** Returns a sorted copy; unknown modes fall back to most recently read. */
export function sortNovels(novels, mode) {
  return [...novels].sort(COMPARATORS[mode] || COMPARATORS.updated);
}
