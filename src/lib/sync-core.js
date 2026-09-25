export const SYNC_STATE_VERSION = 1;
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Replay-dedup memory for applyMutation. Bounded because replay stays
// structurally idempotent without it (checkpoint events dedupe by event id,
// patches lose LWW to newer clocks, delete/restore are generation-guarded).
// Do NOT add chapter-history capping on top of this until a replicated
// per-novel history floor exists — the history map is what keeps replays
// idempotent today. See docs/sync-api.md.
export const MAX_APPLIED_MUTATIONS = 5000;

const FIELD_NAMES = [
  "title",
  "sourceSite",
  "novelHomeUrl",
  "coverImageUrl",
  "status",
  "createdAt",
  "updatedAt",
  "lastReadChapterUrl",
  "lastReadChapterLabel",
  "tags",
  "notes",
  "rating"
];

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function compareClocks(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ["wallMs", "logical", "actorId"]) {
    const a = left[key];
    const b = right[key];
    if (a === b) continue;
    return a > b ? 1 : -1;
  }
  return 0;
}

export function tickClock(previous, actorId, now = Date.now()) {
  const wallMs = Math.max(Number(previous?.wallMs || 0), now);
  return {
    wallMs,
    logical: wallMs === Number(previous?.wallMs || 0) ? Number(previous?.logical || 0) + 1 : 0,
    actorId
  };
}

export function observeClock(previous, observed, actorId, now = Date.now()) {
  const wallMs = Math.max(Number(previous?.wallMs || 0), Number(observed?.wallMs || 0), now);
  const previousLogical = Number(previous?.logical || 0);
  const observedLogical = Number(observed?.logical || 0);
  let logical = 0;
  if (wallMs === Number(previous?.wallMs || 0) && wallMs === Number(observed?.wallMs || 0)) {
    logical = Math.max(previousLogical, observedLogical) + 1;
  } else if (wallMs === Number(previous?.wallMs || 0)) {
    logical = previousLogical + 1;
  } else if (wallMs === Number(observed?.wallMs || 0)) {
    logical = observedLogical + 1;
  }
  return { wallMs, logical, actorId };
}

export function createSyncState({ deviceId = randomId(), now = Date.now() } = {}) {
  return {
    version: SYNC_STATE_VERSION,
    deviceId,
    clock: { wallMs: now, logical: 0, actorId: deviceId },
    novels: {},
    pendingMutations: [],
    appliedMutations: {}
  };
}

function normalizedFieldPayload(payload = {}) {
  return Object.fromEntries(
    FIELD_NAMES.filter((name) => Object.prototype.hasOwnProperty.call(payload, name)).map((name) => [name, payload[name]])
  );
}

function ensureNovel(state, mutation) {
  const existing = state.novels[mutation.novelId];
  if (existing) return existing;
  const novel = {
    id: mutation.novelId,
    generation: mutation.generation || 1,
    lifecycle: "active",
    fields: {},
    chapterHistory: {},
    headCheckpointId: ""
  };
  state.novels[mutation.novelId] = novel;
  return novel;
}

function wins(incoming, current, mutation) {
  const clockComparison = compareClocks(incoming, current?.clock);
  if (clockComparison !== 0) return clockComparison > 0;
  const incomingSequence = Number(mutation.serverSequence || 0);
  const currentSequence = Number(current?.serverSequence || 0);
  if (incomingSequence !== currentSequence) return incomingSequence > currentSequence;
  return String(mutation.mutationId) > String(current?.mutationId || "");
}

function applyFields(novel, payload, mutation) {
  for (const [name, value] of Object.entries(normalizedFieldPayload(payload))) {
    if (wins(mutation.clock, novel.fields[name], mutation)) {
      novel.fields[name] = {
        value,
        clock: clone(mutation.clock),
        serverSequence: mutation.serverSequence || 0,
        mutationId: mutation.mutationId
      };
    }
  }
}

function beatsHead(candidate, current) {
  if (!current) return Boolean(candidate);
  const comparison = compareClocks(candidate.readAt, current.readAt);
  return comparison > 0 || (comparison === 0 && String(candidate.id) > String(current.id));
}

// Recorded events are immutable, so the head is a running maximum: a freshly
// recorded checkpoint only has to beat the incumbent. Callers with no
// candidate (restore) fall back to the full scan.
function chooseHead(novel, candidate) {
  let winner = novel.chapterHistory[novel.headCheckpointId];
  if (candidate) {
    if (beatsHead(candidate, winner)) winner = candidate;
  } else {
    winner = undefined;
    for (const event of Object.values(novel.chapterHistory)) {
      if (beatsHead(event, winner)) winner = event;
    }
  }
  novel.headCheckpointId = winner?.id || "";
  if (winner) {
    for (const [name, value] of Object.entries({
      lastReadChapterUrl: winner.url,
      lastReadChapterLabel: winner.label
    })) {
      novel.fields[name] = { value, clock: clone(winner.readAt), serverSequence: 0, mutationId: winner.id };
    }
  }
}

function applyCheckpoint(novel, payload, mutation) {
  const event = payload?.event;
  if (!event?.id || !event.url || novel.chapterHistory[event.id]) return;
  novel.chapterHistory[event.id] = {
    id: event.id,
    url: event.url,
    label: event.label || "",
    source: event.source || "manual",
    // A checkpoint's ordering is the mutation HLC. Importers set the mutation
    // clock from the historical timestamp, while live clients receive the
    // logical increment that distinguishes rapid successive reads.
    readAt: clone(mutation.clock)
  };
  chooseHead(novel, novel.chapterHistory[event.id]);
}

export function applyMutation(inputState, mutation, options) {
  const state = clone(inputState);
  applyMutationTo(state, mutation, options);
  pruneAppliedMutations(state);
  return state;
}

// Mutates `state` in place. Callers own the copy; `applyMutation` clones per
// call, `applyMutationBatch` clones once for the whole batch (cloning per
// mutation made a batch quadratic in its own size).
function applyMutationTo(state, mutation, { now = Date.now() } = {}) {
  // States that arrive from the server have no `appliedMutations` — receipts
  // are the durable dedup there, so the field is stripped before persisting.
  state.appliedMutations ||= {};
  if (!mutation?.mutationId || state.appliedMutations[mutation.mutationId]) return state;
  state.clock = observeClock(state.clock, mutation.clock, state.deviceId, now);
  // Restoring a novel this state never had (or already purged) has nothing to
  // bring back. Creating it here left an active novel with no fields: a blank
  // card on every device.
  if (mutation.type === "novel.restore" && !state.novels[mutation.novelId]) {
    state.appliedMutations[mutation.mutationId] = true;
    return state;
  }
  const novel = ensureNovel(state, mutation);
  const currentGeneration = Number(novel.generation || 1);

  if (mutation.type === "novel.restore") {
    if (novel.lifecycle === "deleted" && Number(mutation.generation) === currentGeneration) {
      novel.lifecycle = "active";
      novel.generation = currentGeneration + 1;
      delete novel.deletedAt;
      applyFields(novel, mutation.payload, mutation);
      chooseHead(novel);
    }
  } else if (Number(mutation.generation) === currentGeneration && novel.lifecycle !== "deleted") {
    if (mutation.type === "novel.delete") {
      novel.lifecycle = "deleted";
      novel.deletedAt = clone(mutation.clock);
      novel.deletedAtMs = now;
    } else if (mutation.type === "novel.create" || mutation.type === "novel.patch") {
      applyFields(novel, mutation.payload, mutation);
      if (mutation.type === "novel.create") applyCheckpoint(novel, mutation.payload, mutation);
    } else if (mutation.type === "checkpoint.record") {
      applyCheckpoint(novel, mutation.payload, mutation);
    }
  }

  state.appliedMutations[mutation.mutationId] = true;
  return state;
}

function pruneAppliedMutations(state) {
  if (!state.appliedMutations) return;
  const ids = Object.keys(state.appliedMutations);
  if (ids.length <= MAX_APPLIED_MUTATIONS) return;
  for (const id of ids.slice(0, ids.length - MAX_APPLIED_MUTATIONS)) {
    delete state.appliedMutations[id];
  }
}

export function createLocalMutation(state, { novelId, generation, type, payload, now = Date.now(), mutationId = randomId() }) {
  const clock = tickClock(state.clock, state.deviceId, now);
  return {
    mutationId,
    deviceId: state.deviceId,
    novelId,
    generation,
    clock,
    type,
    payload
  };
}

export function enqueueLocalMutation(state, draft, options) {
  const mutation = createLocalMutation(state, draft, options);
  const next = applyMutation(state, mutation, options);
  next.pendingMutations.push(mutation);
  return { state: next, mutation };
}

export function applyMutationBatch(state, mutations, options) {
  const next = clone(state);
  const ordered = [...mutations].sort((left, right) =>
    compareClocks(left.clock, right.clock) || String(left.mutationId).localeCompare(String(right.mutationId)));
  for (const mutation of ordered) applyMutationTo(next, mutation, options);
  pruneAppliedMutations(next);
  return next;
}

export function purgeExpiredTombstones(inputState, now = Date.now()) {
  const state = clone(inputState);
  for (const [id, novel] of Object.entries(state.novels)) {
    if (novel.lifecycle === "deleted" && now - Number(novel.deletedAtMs || now) >= TOMBSTONE_RETENTION_MS) {
      delete state.novels[id];
    }
  }
  return state;
}

export function materializeNovel(novel) {
  if (!novel || novel.lifecycle === "deleted") return null;
  const fields = Object.fromEntries(Object.entries(novel.fields).map(([name, register]) => [name, register.value]));
  const history = Object.values(novel.chapterHistory)
    .sort((left, right) => compareClocks(left.readAt, right.readAt) || String(left.id).localeCompare(String(right.id)))
    .map((event) => ({
      id: event.id,
      url: event.url,
      label: event.label,
      readAt: new Date(event.readAt.wallMs).toISOString(),
      source: event.source
    }));
  const head = novel.chapterHistory[novel.headCheckpointId];
  return {
    id: novel.id,
    tags: [],
    notes: "",
    rating: 0,
    ...fields,
    lastReadChapterUrl: head?.url || fields.lastReadChapterUrl || "",
    lastReadChapterLabel: head?.label || fields.lastReadChapterLabel || "",
    chapterHistory: history,
    createdAt: fields.createdAt || new Date(0).toISOString(),
    updatedAt: head ? new Date(head.readAt.wallMs).toISOString() : (fields.updatedAt || new Date(0).toISOString())
  };
}

export function materializeNovels(state) {
  return Object.values(state.novels).map(materializeNovel).filter(Boolean);
}

// FNV-1a over two seeds: a short, stable, synchronous fingerprint for
// content-derived ids and checksums. Not cryptographic; collisions only
// matter within one account's novel set.
export function stableHash(value) {
  const text = String(value);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

// Fingerprint of everything a sync account would receive from this device:
// every live novel's fields and history, in id order. Two states with the
// same checksum have nothing to push that the other lacks.
export function libraryChecksum(state) {
  const novels = materializeNovels(state)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((novel) => ({ ...novel, chapterHistory: novel.chapterHistory.map((event) => event.id) }));
  return stableHash(JSON.stringify(novels));
}

function normalizeIdentityText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeIdentityUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return String(value).trim();
  }
}

// Comparable host+path for a URL: www. and trailing slashes dropped,
// lower-cased like the rest of the library's URL matching.
function urlKey(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

// A path segment that is a site's own numeric id for a work: a bare number
// of 3+ digits that is not a year (/fiction/21220, /works/10057010), or a long
// id with a slug (/story/66766637-empire-of-ashes). Slugs that merely start
// with a number ("1000-years-in-hell") and dates (/2025/01/…) are not ids.
function workIdSegment(segment) {
  if (/^\d{3,}$/.test(segment) && !/^(19|20)\d\d$/.test(segment)) return segment;
  return segment.match(/^(\d{6,})-/)?.[1] || "";
}

// urlKey cut after the work's id segment, so a work keeps one key when its
// site renames the slug: /fiction/21220/<old> and /fiction/21220/<new>.
function pageKey(value) {
  const key = urlKey(value);
  if (!key) return "";
  const [host, ...segments] = key.split("/");
  const kept = [];
  for (const segment of segments) {
    const id = workIdSegment(segment);
    kept.push(id || segment);
    if (id) break;
  }
  return [host, ...kept].join("/");
}

function isUnderPage(key, page) {
  return key === page || key.startsWith(`${page}/`);
}

/**
 * A comparable form of a record's novel page, or "" when it has no real one:
 * just the site root (Shin Translations' old parser), or the very chapter it
 * was saved from (the generic fallback, e.g. a Patreon post, or a site an
 * older build had no parser for).
 */
export function comparableNovelHome(record) {
  const home = urlKey(record?.novelHomeUrl);
  if (!home || !home.includes("/") || home === urlKey(record?.lastReadChapterUrl)) return "";
  return pageKey(record.novelHomeUrl);
}

/**
 * True when two records are evidently different works, whatever else matches
 * (title, or a chapter URL of the same shape):
 * - both name a real novel page, and those differ; or
 * - one names a real novel page on a site that files chapters under it
 *   (/novels/<slug>/<n>, /fiction/<id>/…, /works/<id>/chapters/…), and the
 *   other's chapter in the same section of that site is not under it.
 * The second case covers records with no usable novel page, like those an
 * older build saved for Chikari's /novels/ route: without it, any chapter of
 * any other novel on the site looked like that record's next chapter.
 */
export function belongToDifferentNovels(saved, incoming) {
  const savedHome = comparableNovelHome(saved);
  const incomingHome = comparableNovelHome(incoming);
  if (savedHome && incomingHome) return savedHome !== incomingHome;

  const chapterOutside = (home, own, other) => {
    if (!home) return false;
    const ownChapter = pageKey(own?.lastReadChapterUrl);
    const otherChapter = pageKey(other?.lastReadChapterUrl);
    if (!ownChapter || !otherChapter || !isUnderPage(ownChapter, home)) return false;
    // Same host and same section (/novels vs /novels); a chapter elsewhere on
    // the site (/collections/…/works/…) may be the same work under another path.
    const [homeHost, homeSection] = home.split("/");
    const [otherHost, otherSection] = otherChapter.split("/");
    return otherHost === homeHost && otherSection === homeSection && !isUnderPage(otherChapter, home);
  };
  return chapterOutside(incomingHome, incoming, saved) || chapterOutside(savedHome, saved, incoming);
}

/**
 * Same work by novel page, chapter URL, or title on the same site, unless
 * the two are evidently different works (belongToDifferentNovels): two works
 * that share a title (a novel and its manhwa), or an old record whose only
 * link to the incoming page is a shared site. Used by the library and by the
 * server's canonical-id mapping, so sync cannot merge them either.
 */
export function matchesNovelIdentity(existing, incoming) {
  if (belongToDifferentNovels(existing, incoming)) return false;
  const existingHome = normalizeIdentityUrl(existing?.novelHomeUrl);
  const incomingHome = normalizeIdentityUrl(incoming?.novelHomeUrl);
  if (existingHome && incomingHome && existingHome === incomingHome) return true;
  const existingChapter = normalizeIdentityUrl(existing?.lastReadChapterUrl);
  const incomingChapter = normalizeIdentityUrl(incoming?.lastReadChapterUrl);
  if (existingChapter && incomingChapter && existingChapter === incomingChapter) return true;
  const title = normalizeIdentityText(incoming?.title);
  const source = normalizeIdentityText(incoming?.sourceSite);
  return Boolean(
    title && source &&
    normalizeIdentityText(existing?.title) === title &&
    normalizeIdentityText(existing?.sourceSite) === source
  );
}

export function findCanonicalNovelId(state, mutation) {
  if (state.novels?.[mutation.novelId]) return mutation.novelId;
  const event = mutation.payload?.event;
  const candidate = {
    ...mutation.payload,
    lastReadChapterUrl: event?.url || mutation.payload?.lastReadChapterUrl || "",
    lastReadChapterLabel: event?.label || mutation.payload?.lastReadChapterLabel || ""
  };
  return materializeNovels(state).find((novel) => matchesNovelIdentity(novel, candidate))?.id || mutation.novelId;
}
