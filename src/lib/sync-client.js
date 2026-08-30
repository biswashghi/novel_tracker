import { applyMutationBatch, observeClock } from "./sync-core.js";

/**
 * Rebuild local state around the server's answer. `survivors` are the pending
 * mutations that were neither acknowledged nor rejected, already resolved
 * against the exact array that was sent.
 */
function adoptCanonicalState(localState, result, survivors) {
  const mappings = new Map((result.novelIdMappings || []).map((item) => [item.localNovelId, item.canonicalNovelId]));
  const remapped = survivors.map((item) => ({ ...item, novelId: mappings.get(item.novelId) || item.novelId }));

  // A response without the canonical blob (steady-state duplicate batches) is
  // not a reason to skip the id mappings — dropping them would let the next
  // push re-create novels the server has already merged.
  if (!result.state) {
    const next = applyMutationBatch({ ...localState, pendingMutations: remapped }, result.mutations || []);
    next.pendingMutations = remapped;
    return next;
  }

  const pendingMutations = remapped.map((item) => ({
    ...item,
    generation: result.state.novels?.[item.novelId]?.generation || item.generation
  }));
  let next = {
    ...result.state,
    // The server strips `appliedMutations` before persisting (receipts are its
    // durable dedup), so the canonical blob arrives without it. Restoring the
    // local replay map here is what keeps applyMutation from reading undefined.
    appliedMutations: result.state.appliedMutations || {},
    deviceId: localState.deviceId,
    clock: observeClock(localState.clock, result.state.clock, localState.deviceId),
    pendingMutations,
    syncAccountSubject: localState.syncAccountSubject
  };
  next = applyMutationBatch(next, pendingMutations);
  next.pendingMutations = pendingMutations;
  return next;
}

/**
 * Match the server's rejections back to the mutations that were sent.
 *
 * Positional index is preferred over `mutationId`: a mutation rejected
 * *because* its id is missing or malformed cannot be matched by id, and
 * leaving it pending is exactly the permanent wedge this reporting exists to
 * prevent.
 */
function resolveRejections(sent, rejectedMutations) {
  const indices = new Set();
  const reported = [];
  for (const entry of rejectedMutations || []) {
    const index = Number.isInteger(entry?.index) && entry.index >= 0 && entry.index < sent.length
      ? entry.index
      : sent.findIndex((item) => item.mutationId && item.mutationId === entry?.mutationId);
    if (index < 0 || indices.has(index)) continue;
    indices.add(index);
    reported.push({ mutationId: sent[index].mutationId || "", reason: entry?.reason || "rejected" });
  }
  return { indices, reported };
}

/**
 * Transport-neutral client for the documented /v1/sync API. Authentication is
 * supplied by the host so local-only users never need to construct this class.
 */
export class SyncClient {
  constructor({ baseUrl, getAccessToken, fetchImpl = globalThis.fetch?.bind(globalThis) }) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.getAccessToken = getAccessToken;
    this.fetchImpl = fetchImpl;
  }

  async request(path, options = {}) {
    const token = await this.getAccessToken?.();
    if (!token) throw new Error("Sign in is required to synchronize");
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`Sync request failed (${response.status})`);
    return response.json();
  }

  async push(state) {
    const sent = state.pendingMutations;
    if (!sent.length) return { state, cursor: state.cursor || "", rejected: [] };
    const result = await this.request("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: sent })
    });
    const acknowledged = new Set(result.acknowledgedMutationIds || sent.map((item) => item.mutationId));
    // The server explicitly rejects (never silently skips) structurally
    // invalid mutations; dropping them here is what keeps one poison pill from
    // wedging every future sync. Rejections surface to the user via sync meta.
    const rejections = resolveRejections(sent, result.rejectedMutations);
    const survivors = sent.filter((item, index) => !acknowledged.has(item.mutationId) && !rejections.indices.has(index));
    const next = adoptCanonicalState(state, result, survivors);
    next.cursor = result.cursor || next.cursor || "";
    return { state: next, cursor: next.cursor, rejected: rejections.reported };
  }

  async pull(state) {
    let next = state;
    let hasMore = false;
    do {
      const result = await this.request(`/v1/sync?cursor=${encodeURIComponent(next.cursor || "")}`);
      next = applyMutationBatch(next, result.mutations || []);
      next.cursor = result.cursor || next.cursor || "";
      hasMore = Boolean(result.hasMore);
    } while (hasMore);
    return { state: next, cursor: next.cursor };
  }
}
