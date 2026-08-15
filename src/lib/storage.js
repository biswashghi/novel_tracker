import {
  applyMutation,
  createSyncState,
  enqueueLocalMutation,
  matchesNovelIdentity,
  materializeNovels,
  purgeExpiredTombstones
} from "./sync-core.js";
import { getStorageLocal } from "./extension-api.js";

const STORAGE_KEY = "novel-tracker:novels";
const SYNC_STORAGE_KEY = "novel-tracker:sync-state";
const IMPORT_VERSION = 1;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function getStorageArea() {
  const storage = getStorageLocal();
  if (storage) {
    return storage;
  }

  return {
    async get(key) {
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.map((item) => {
        const raw = globalThis.localStorage?.getItem(item);
        return [item, raw ? JSON.parse(raw) : undefined];
      }));
    },
    async set(value) {
      const [key] = Object.keys(value);
      globalThis.localStorage?.setItem(key, JSON.stringify(value[key]));
    }
  };
}

function legacyEventId(novelId, entry, index) {
  return `legacy:${novelId}:${encodeURIComponent(normalizeUrl(entry.url))}:${entry.readAt || index}`;
}

function toEvent(entry, novelId, index, deviceId) {
  const parsed = Date.parse(entry.readAt || "");
  return {
    id: entry.id || legacyEventId(novelId, entry, index),
    url: normalizeUrl(entry.url),
    label: String(entry.label || "").trim(),
    source: entry.source || "manual",
    readAt: { wallMs: Number.isFinite(parsed) ? parsed : index, logical: 0, actorId: deviceId }
  };
}

export async function getSyncState() {
  const storage = getStorageArea();
  const result = await storage.get([SYNC_STORAGE_KEY, STORAGE_KEY]);
  if (result[SYNC_STORAGE_KEY]?.version) {
    return purgeExpiredTombstones(result[SYNC_STORAGE_KEY]);
  }

  let state = createSyncState();
  const legacyNovels = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  for (const [index, legacy] of legacyNovels.entries()) {
    const novelId = legacy.id || globalThis.crypto.randomUUID();
    const history = normalizeChapterHistory(legacy.chapterHistory);
    const event = toEvent(history[history.length - 1] || {
      url: legacy.lastReadChapterUrl,
      label: legacy.lastReadChapterLabel,
      readAt: legacy.updatedAt
    }, novelId, index, state.deviceId);
    const mutation = {
      mutationId: `migration:${novelId}`,
      deviceId: state.deviceId,
      novelId,
      generation: 1,
      clock: event.readAt,
      type: "novel.create",
      payload: { ...legacy, id: undefined, event }
    };
    state = applyMutation(state, mutation);
    state.pendingMutations.push(mutation);
    for (const [historyIndex, item] of history.entries()) {
      const importedEvent = toEvent(item, novelId, historyIndex, state.deviceId);
      const historyMutation = {
        ...mutation,
        mutationId: `migration:${novelId}:${importedEvent.id}`,
        clock: importedEvent.readAt,
        type: "checkpoint.record",
        payload: { event: importedEvent }
      };
      state = applyMutation(state, historyMutation);
      state.pendingMutations.push(historyMutation);
    }
  }
  await saveSyncState(state);
  return state;
}

export async function saveSyncState(state) {
  const storage = getStorageArea();
  const activeNovels = materializeNovels(state);
  await storage.set({ [SYNC_STORAGE_KEY]: state, [STORAGE_KEY]: activeNovels });
}

export async function prepareSyncForAccount(subject) {
  let state = await getSyncState();
  if (state.syncAccountSubject === subject) return state;
  for (const novel of Object.values(state.novels || {})) {
    const fields = Object.fromEntries(Object.entries(novel.fields || {}).map(([name, register]) => [name, register.value]));
    const history = Object.values(novel.chapterHistory || {}).sort((left, right) => left.readAt.wallMs - right.readAt.wallMs);
    state = enqueue(state, {
      novelId: novel.id,
      generation: novel.generation,
      type: "novel.create",
      payload: { ...fields, event: history[0] }
    });
    for (const event of history.slice(1)) {
      state = enqueue(state, {
        novelId: novel.id,
        generation: novel.generation,
        type: "checkpoint.record",
        payload: { event }
      });
    }
    if (novel.lifecycle === "deleted") {
      state = enqueue(state, { novelId: novel.id, generation: novel.generation, type: "novel.delete", payload: {} });
    }
  }
  state.cursor = "";
  state.syncAccountSubject = subject;
  await saveSyncState(state);
  return state;
}

export async function hasLocalLibraryData() {
  const state = await getSyncState();
  return Object.keys(state.novels || {}).length > 0 || state.pendingMutations.length > 0;
}

export async function disconnectSyncAccount() {
  const state = await getSyncState();
  const next = { ...state, cursor: "", syncAccountSubject: "" };
  await saveSyncState(next);
  return next;
}

function notifyPendingSync() {
  try {
    const result = globalThis.browser?.runtime?.sendMessage?.({ type: "novel-tracker:sync-pending" }) ||
      globalThis.chrome?.runtime?.sendMessage?.({ type: "novel-tracker:sync-pending" });
    result?.catch?.(() => {});
  } catch {
    // Local-only pages and tests do not have an extension runtime.
  }
}

function novelFields(input, existing, now) {
  return {
    title: String(input.title || existing?.title || "Untitled Novel").trim(),
    sourceSite: String(input.sourceSite || existing?.sourceSite || getHostname(input.lastReadChapterUrl) || "Unknown source").trim(),
    novelHomeUrl: normalizeUrl(input.novelHomeUrl ?? existing?.novelHomeUrl),
    coverImageUrl: normalizeUrl(input.coverImageUrl ?? existing?.coverImageUrl),
    status: input.status || existing?.status || "active",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function rawNovel(state, id) {
  return state.novels[id];
}

function enqueue(state, draft, now) {
  return enqueueLocalMutation(state, draft, { now }).state;
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
  return materializeNovels(await getSyncState());
}

async function saveNovels(novels) {
  // Compatibility bridge for callers that still provide the legacy array shape.
  let state = createSyncState();
  for (const novel of novels) {
    const now = Date.parse(novel.updatedAt || "") || Date.now();
    const novelId = novel.id || globalThis.crypto.randomUUID();
    const history = normalizeChapterHistory(novel.chapterHistory);
    const event = toEvent(history[history.length - 1] || {
      url: novel.lastReadChapterUrl,
      label: novel.lastReadChapterLabel,
      readAt: novel.updatedAt
    }, novelId, history.length - 1, state.deviceId);
    state = enqueue(state, {
      novelId,
      generation: 1,
      type: "novel.create",
      payload: { ...novel, event }
    }, now);
    for (const [index, historyEntry] of history.entries()) {
      const importedEvent = toEvent(historyEntry, novelId, index, state.deviceId);
      if (importedEvent.id === event.id) continue;
      state = enqueue(state, {
        novelId,
        generation: 1,
        type: "checkpoint.record",
        payload: { event: importedEvent }
      }, Date.parse(historyEntry.readAt || "") || now);
    }
  }
  await saveSyncState(state);
  notifyPendingSync();
}

function mergeChapterHistories(left, right) {
  return normalizeChapterHistory([...(left || []), ...(right || [])]);
}

export function matchesNovel(existing, incoming) {
  return matchesNovelIdentity(existing, incoming);
}

export async function upsertNovel(input) {
  let state = await getSyncState();
  const novels = materializeNovels(state);
  const now = new Date().toISOString();
  const existing = findExistingNovelForSave(novels, input);
  const novelId = existing?.id || globalThis.crypto.randomUUID();
  const raw = rawNovel(state, novelId);
  const fields = novelFields(input, existing, now);
  const event = toEvent({
    url: input.lastReadChapterUrl,
    label: input.lastReadChapterLabel,
    readAt: now,
    source: "manual"
  }, novelId, Date.now(), state.deviceId);
  state = enqueue(state, {
    novelId,
    generation: raw?.generation || 1,
    type: existing ? "novel.patch" : "novel.create",
    payload: existing ? fields : { ...fields, event }
  });
  if (existing && normalizeUrl(existing.lastReadChapterUrl) !== event.url) {
    state = enqueue(state, { novelId, generation: raw.generation, type: "checkpoint.record", payload: { event } });
  }
  await saveSyncState(state);
  notifyPendingSync();
  return materializeNovels(state).find((novel) => novel.id === novelId);
}

export async function autoUpdateNovelProgress(input) {
  let state = await getSyncState();
  const novels = materializeNovels(state);
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
  const raw = rawNovel(state, existing.id);
  state = enqueue(state, {
    novelId: existing.id,
    generation: raw.generation,
    type: "novel.patch",
    payload: novelFields({ ...input, novelHomeUrl: nextHomeUrl || currentHomeUrl }, existing, now)
  });
  const event = toEvent({
    url: nextChapterUrl,
    label: input.lastReadChapterLabel || existing.lastReadChapterLabel,
    readAt: now,
    source: "auto"
  }, existing.id, Date.now(), state.deviceId);
  state = enqueue(state, { novelId: existing.id, generation: raw.generation, type: "checkpoint.record", payload: { event } });
  await saveSyncState(state);
  notifyPendingSync();
  const updatedNovel = materializeNovels(state).find((novel) => novel.id === existing.id);
  return { updated: true, reason: "progress-updated", novel: updatedNovel };
}

export async function updateNovel(id, patch) {
  let state = await getSyncState();
  const novels = materializeNovels(state);
  const now = new Date().toISOString();
  const existing = novels.find((novel) => novel.id === id);
  const raw = rawNovel(state, id);
  if (!existing || !raw) return;
  state = enqueue(state, { novelId: id, generation: raw.generation, type: "novel.patch", payload: novelFields(patch, existing, now) });
  if (normalizeUrl(patch.lastReadChapterUrl) && normalizeUrl(patch.lastReadChapterUrl) !== normalizeUrl(existing.lastReadChapterUrl)) {
    const event = toEvent({ url: patch.lastReadChapterUrl, label: patch.lastReadChapterLabel, readAt: now }, id, Date.now(), state.deviceId);
    state = enqueue(state, { novelId: id, generation: raw.generation, type: "checkpoint.record", payload: { event } });
  }
  await saveSyncState(state);
  notifyPendingSync();
}

export async function deleteNovel(id) {
  let state = await getSyncState();
  const raw = rawNovel(state, id);
  if (!raw || raw.lifecycle === "deleted") return;
  state = enqueue(state, { novelId: id, generation: raw.generation, type: "novel.delete", payload: {} });
  await saveSyncState(state);
  notifyPendingSync();
}

export async function restoreNovel(id) {
  let state = await getSyncState();
  const raw = rawNovel(state, id);
  if (!raw || raw.lifecycle !== "deleted") return;
  state = enqueue(state, { novelId: id, generation: raw.generation, type: "novel.restore", payload: {} });
  await saveSyncState(state);
  notifyPendingSync();
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
