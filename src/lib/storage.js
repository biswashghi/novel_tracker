const STORAGE_KEY = "novel-tracker:novels";
const IMPORT_VERSION = 1;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function getStorageArea() {
  if (globalThis.chrome?.storage?.local) {
    return globalThis.chrome.storage.local;
  }

  return {
    async get(key) {
      const raw = globalThis.localStorage?.getItem(key);
      return { [key]: raw ? JSON.parse(raw) : [] };
    },
    async set(value) {
      const [key] = Object.keys(value);
      globalThis.localStorage?.setItem(key, JSON.stringify(value[key]));
    }
  };
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function hasRequiredNovelIdentity(input) {
  return Boolean(
    normalizeUrl(input?.lastReadChapterUrl) ||
    (String(input?.title || "").trim() && String(input?.sourceSite || "").trim())
  );
}

function normalizeChapterHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  const seen = new Map();
  for (const entry of history) {
    const url = normalizeUrl(entry?.url);
    if (!url) {
      continue;
    }

    seen.set(url, {
      url,
      label: String(entry?.label || "").trim(),
      readAt: String(entry?.readAt || "").trim() || new Date().toISOString()
    });
  }

  return [...seen.values()];
}

function appendChapterHistory(history, input, now) {
  const next = normalizeChapterHistory(history);
  const url = normalizeUrl(input.lastReadChapterUrl);
  if (!url) {
    return next;
  }

  const label = String(input.lastReadChapterLabel || "").trim();
  const existingIndex = next.findIndex((entry) => entry.url === url);
  const entry = {
    url,
    label,
    readAt: now
  };

  if (existingIndex >= 0) {
    next[existingIndex] = entry;
    return next;
  }

  next.push(entry);
  return next;
}

function getUrlParts(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);

    return {
      hostname: parsed.hostname.replace(/^www\./, ""),
      segments
    };
  } catch {
    return {
      hostname: "",
      segments: []
    };
  }
}

function looksNumeric(value) {
  return /^[0-9]+$/.test(value);
}

function looksChapterSlug(value) {
  return /(^|[-_])(chapter|chap|ch|episode|ep|prologue|epilogue|volume|vol|book|part)([-_]*\d+|[-_]|$)/i.test(value);
}

function segmentShape(segment) {
  if (!segment) {
    return "empty";
  }

  if (looksChapterSlug(segment)) {
    return "chapter";
  }

  if (looksNumeric(segment)) {
    return "number";
  }

  if (/^[a-z-]+$/.test(segment)) {
    return "slug";
  }

  if (/^[a-z0-9-]+$/.test(segment)) {
    return "mixed";
  }

  return "other";
}

function pathStartsWith(path, prefix) {
  if (!prefix.length || path.length < prefix.length) {
    return false;
  }

  return prefix.every((segment, index) => path[index] === segment);
}

function countSharedPrefix(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function hasChapterSignal(url, label) {
  const normalizedLabel = normalizeText(label);
  const { segments } = getUrlParts(url);

  return (
    /(^|[^a-z])(chapter|chap|ch|episode|ep|prologue|epilogue|volume|vol|book|part)([^a-z]|$)/i.test(normalizedLabel) ||
    segments.some((segment) => looksChapterSlug(segment)) ||
    segments.some((segment) => /\d/.test(segment) && segment.includes("-"))
  );
}

export function isLikelyChapterPage(input) {
  return hasChapterSignal(input?.lastReadChapterUrl, input?.lastReadChapterLabel);
}

function matchesSavedChapterPattern(savedNovel, incoming) {
  const savedChapter = getUrlParts(savedNovel.lastReadChapterUrl);
  const incomingChapter = getUrlParts(incoming.lastReadChapterUrl);
  const novelHome = getUrlParts(savedNovel.novelHomeUrl);

  if (!savedChapter.hostname || savedChapter.hostname !== incomingChapter.hostname) {
    return false;
  }

  if (!hasChapterSignal(savedNovel.lastReadChapterUrl, savedNovel.lastReadChapterLabel)) {
    return false;
  }

  if (!hasChapterSignal(incoming.lastReadChapterUrl, incoming.lastReadChapterLabel)) {
    return false;
  }

  const sharedPrefix = countSharedPrefix(savedChapter.segments, incomingChapter.segments);
  const requiredPrefix = Math.min(
    Math.max(savedChapter.segments.length - 1, 1),
    Math.max(incomingChapter.segments.length - 1, 1)
  );

  const followsNovelRoot =
    novelHome.segments.length > 0 &&
    pathStartsWith(savedChapter.segments, novelHome.segments.slice(0, Math.min(2, novelHome.segments.length))) &&
    pathStartsWith(incomingChapter.segments, novelHome.segments.slice(0, Math.min(2, novelHome.segments.length)));

  const shapeMatches =
    savedChapter.segments.length === incomingChapter.segments.length &&
    savedChapter.segments.every((segment, index) => {
      const savedShape = segmentShape(segment);
      const incomingShape = segmentShape(incomingChapter.segments[index]);
      return savedShape === incomingShape || (savedShape === "chapter" && incomingShape === "mixed");
    });

  return (
    sharedPrefix >= requiredPrefix ||
    (followsNovelRoot && sharedPrefix >= Math.min(2, savedChapter.segments.length, incomingChapter.segments.length)) ||
    (shapeMatches && sharedPrefix >= Math.max(1, requiredPrefix - 1))
  );
}

function findTrackedNovelForAutoUpdate(novels, incoming) {
  const directMatch = novels.find((novel) => matchesNovel(novel, incoming));
  if (directMatch) {
    return directMatch;
  }

  return novels.find((novel) => {
    return (
      normalizeText(novel.sourceSite) === normalizeText(incoming.sourceSite) &&
      matchesSavedChapterPattern(novel, incoming)
    );
  });
}

function findExistingNovelForSave(novels, incoming) {
  const directMatch = novels.find((novel) => matchesNovel(novel, incoming));
  if (directMatch) {
    return directMatch;
  }

  if (!isLikelyChapterPage(incoming)) {
    return undefined;
  }

  return novels.find((novel) => {
    return (
      normalizeText(novel.sourceSite) === normalizeText(incoming.sourceSite) &&
      matchesSavedChapterPattern(novel, incoming)
    );
  });
}

export function normalizeUrl(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(url).trim();
  }
}

export function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function getNovels() {
  const storage = getStorageArea();
  const result = await storage.get(STORAGE_KEY);
  const novels = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  return novels.map((novel) => ({
    ...novel,
    chapterHistory: normalizeChapterHistory(novel.chapterHistory)
  }));
}

async function saveNovels(novels) {
  const storage = getStorageArea();
  await storage.set({ [STORAGE_KEY]: novels });
}

function mergeChapterHistories(left, right) {
  return normalizeChapterHistory([...(left || []), ...(right || [])]);
}

export function matchesNovel(existing, incoming) {
  const existingHome = normalizeUrl(existing.novelHomeUrl);
  const incomingHome = normalizeUrl(incoming.novelHomeUrl);

  if (existingHome && incomingHome && existingHome === incomingHome) {
    return true;
  }

  const existingChapter = normalizeUrl(existing.lastReadChapterUrl);
  const incomingChapter = normalizeUrl(incoming.lastReadChapterUrl);
  if (existingChapter && incomingChapter && existingChapter === incomingChapter) {
    return true;
  }

  return (
    normalizeText(existing.title) === normalizeText(incoming.title) &&
    normalizeText(existing.sourceSite) === normalizeText(incoming.sourceSite)
  );
}

export async function upsertNovel(input) {
  const novels = await getNovels();
  const now = new Date().toISOString();
  const existing = findExistingNovelForSave(novels, input);

  const novel = {
    id: existing?.id || globalThis.crypto.randomUUID(),
    title: String(input.title || "Untitled Novel").trim(),
    sourceSite: String(input.sourceSite || getHostname(input.lastReadChapterUrl) || "Unknown source").trim(),
    novelHomeUrl: normalizeUrl(input.novelHomeUrl),
    lastReadChapterUrl: normalizeUrl(input.lastReadChapterUrl),
    lastReadChapterLabel: String(input.lastReadChapterLabel || "").trim(),
    coverImageUrl: normalizeUrl(input.coverImageUrl),
    status: input.status || existing?.status || "active",
    chapterHistory: appendChapterHistory(existing?.chapterHistory, input, now),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  const next = existing
    ? novels.map((item) => (item.id === existing.id ? novel : item))
    : [novel, ...novels];

  await saveNovels(next);
  return novel;
}

export async function autoUpdateNovelProgress(input) {
  const novels = await getNovels();
  const existing = findTrackedNovelForAutoUpdate(novels, input);
  if (!existing) {
    return { updated: false, reason: "not-tracked" };
  }

  if (!matchesSavedChapterPattern(existing, input)) {
    return { updated: false, reason: "not-chapter-like", novel: existing };
  }

  const nextChapterUrl = normalizeUrl(input.lastReadChapterUrl);
  const nextHomeUrl = normalizeUrl(input.novelHomeUrl);
  const currentChapterUrl = normalizeUrl(existing.lastReadChapterUrl);
  const currentHomeUrl = normalizeUrl(existing.novelHomeUrl);

  if (
    nextChapterUrl === currentChapterUrl &&
    (!nextHomeUrl || nextHomeUrl === currentHomeUrl)
  ) {
    return { updated: false, reason: "unchanged", novel: existing };
  }

  const now = new Date().toISOString();
  const updatedNovel = {
    ...existing,
    title: String(input.title || existing.title).trim() || existing.title,
    sourceSite: String(input.sourceSite || existing.sourceSite).trim() || existing.sourceSite,
    novelHomeUrl: nextHomeUrl || currentHomeUrl,
    lastReadChapterUrl: nextChapterUrl || currentChapterUrl,
    lastReadChapterLabel: String(input.lastReadChapterLabel || existing.lastReadChapterLabel).trim(),
    coverImageUrl: normalizeUrl(input.coverImageUrl || existing.coverImageUrl),
    chapterHistory: appendChapterHistory(existing.chapterHistory, input, now),
    updatedAt: now
  };

  const next = novels.map((novel) => (novel.id === existing.id ? updatedNovel : novel));
  await saveNovels(next);
  return { updated: true, reason: "progress-updated", novel: updatedNovel };
}

export async function updateNovel(id, patch) {
  const novels = await getNovels();
  const now = new Date().toISOString();
  const next = novels.map((novel) => {
    if (novel.id !== id) {
      return novel;
    }

    return {
      ...novel,
      ...patch,
      novelHomeUrl: normalizeUrl(patch.novelHomeUrl ?? novel.novelHomeUrl),
      lastReadChapterUrl: normalizeUrl(patch.lastReadChapterUrl ?? novel.lastReadChapterUrl),
      coverImageUrl: normalizeUrl(patch.coverImageUrl ?? novel.coverImageUrl),
      chapterHistory: appendChapterHistory(novel.chapterHistory, {
        lastReadChapterUrl: patch.lastReadChapterUrl ?? novel.lastReadChapterUrl,
        lastReadChapterLabel: patch.lastReadChapterLabel ?? novel.lastReadChapterLabel
      }, now),
      updatedAt: now
    };
  });

  await saveNovels(next);
}

export async function deleteNovel(id) {
  const novels = await getNovels();
  await saveNovels(novels.filter((novel) => novel.id !== id));
}

export async function exportNovelsJson() {
  const novels = await getNovels();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: IMPORT_VERSION,
      novels
    },
    null,
    2
  );
}

export async function importNovelsJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Import file is empty");
  }

  if (text.length > MAX_IMPORT_BYTES) {
    throw new Error("Import file is too large");
  }

  const parsed = JSON.parse(text);
  if (parsed?.version != null && parsed.version !== IMPORT_VERSION) {
    throw new Error("Unsupported backup version");
  }
  const incomingNovels = Array.isArray(parsed) ? parsed : parsed?.novels;
  if (!Array.isArray(incomingNovels)) {
    throw new Error("Invalid import format");
  }

  const existingNovels = await getNovels();
  let merged = [...existingNovels];

  for (const item of incomingNovels) {
    const input = {
      title: String(item.title || "").trim(),
      sourceSite: String(item.sourceSite || "").trim(),
      novelHomeUrl: item.novelHomeUrl || "",
      lastReadChapterUrl: item.lastReadChapterUrl || "",
      lastReadChapterLabel: item.lastReadChapterLabel || "",
      coverImageUrl: item.coverImageUrl || "",
      status: item.status || "active"
    };

    if (!hasRequiredNovelIdentity(input)) {
      continue;
    }

    const existing = findExistingNovelForSave(merged, input);
    if (!existing) {
      merged = [
        {
          id: item.id || globalThis.crypto.randomUUID(),
          title: input.title || "Untitled Novel",
          sourceSite: input.sourceSite || getHostname(input.lastReadChapterUrl) || "Unknown source",
          novelHomeUrl: normalizeUrl(input.novelHomeUrl),
          lastReadChapterUrl: normalizeUrl(input.lastReadChapterUrl),
          lastReadChapterLabel: String(input.lastReadChapterLabel || "").trim(),
          coverImageUrl: normalizeUrl(input.coverImageUrl),
          status: input.status,
          chapterHistory: normalizeChapterHistory(item.chapterHistory),
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString()
        },
        ...merged
      ];
      continue;
    }

    merged = merged.map((novel) => {
      if (novel.id !== existing.id) {
        return novel;
      }

      return {
        ...novel,
        title: input.title || novel.title,
        sourceSite: input.sourceSite || novel.sourceSite,
        novelHomeUrl: normalizeUrl(input.novelHomeUrl || novel.novelHomeUrl),
        lastReadChapterUrl: normalizeUrl(input.lastReadChapterUrl || novel.lastReadChapterUrl),
        lastReadChapterLabel: String(input.lastReadChapterLabel || novel.lastReadChapterLabel).trim(),
        coverImageUrl: normalizeUrl(input.coverImageUrl || novel.coverImageUrl),
        status: input.status || novel.status,
        chapterHistory: mergeChapterHistories(novel.chapterHistory, item.chapterHistory),
        updatedAt: item.updatedAt || novel.updatedAt
      };
    });
  }

  await saveNovels(merged);
  return merged.length;
}
