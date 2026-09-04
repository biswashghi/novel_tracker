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
  state.novels ||= {};
  const existing = state.novels[mutation.novelId];
  if (existing) {
    // SYNC_STATE_VERSION was already 1 when chapter history moved from the
    // materialized library into the replicated state. Records persisted by
    // those early builds therefore pass the version check but can lack these
    // containers. Normalize on read so the first incoming checkpoint upgrades
    // the record instead of crashing the entire sign-in/sync request.
    existing.fields ||= {};
    existing.chapterHistory ||= {};
    existing.headCheckpointId ||= "";
    existing.lifecycle ||= "active";
    existing.generation ||= mutation.generation || 1;
    return existing;
  }
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

export function createLocalMutation(state, { novelId, generation, type, payload, now = Date.now() }) {
  const clock = tickClock(state.clock, state.deviceId, now);
  return {
    mutationId: randomId(),
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
  const fieldsByName = novel.fields || {};
  const chapterHistory = novel.chapterHistory || {};
  const fields = Object.fromEntries(Object.entries(fieldsByName).map(([name, register]) => [name, register.value]));
  const history = Object.values(chapterHistory)
    .sort((left, right) => compareClocks(left.readAt, right.readAt) || String(left.id).localeCompare(String(right.id)))
    .map((event) => ({
      id: event.id,
      url: event.url,
      label: event.label,
      readAt: new Date(event.readAt.wallMs).toISOString(),
      source: event.source
    }));
  const head = chapterHistory[novel.headCheckpointId];
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
  return Object.values(state.novels || {}).map(materializeNovel).filter(Boolean);
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

export function matchesNovelIdentity(existing, incoming) {
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
