import { applyMutationBatch, observeClock } from "./sync-core.js";

function adoptCanonicalState(localState, result, acknowledged) {
  if (!result.state) return applyMutationBatch(localState, result.mutations || []);
  const mappings = new Map((result.novelIdMappings || []).map((item) => [item.localNovelId, item.canonicalNovelId]));
  const pendingMutations = localState.pendingMutations
    .filter((item) => !acknowledged.has(item.mutationId))
    .map((item) => {
      const novelId = mappings.get(item.novelId) || item.novelId;
      const generation = result.state.novels?.[novelId]?.generation || item.generation;
      return { ...item, novelId, generation };
    });
  let next = {
    ...result.state,
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
    if (!state.pendingMutations.length) return { state, cursor: state.cursor || "" };
    const result = await this.request("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: state.pendingMutations })
    });
    const acknowledged = new Set(result.acknowledgedMutationIds || state.pendingMutations.map((item) => item.mutationId));
    const next = adoptCanonicalState(state, result, acknowledged);
    next.pendingMutations = next.pendingMutations.filter((item) => !acknowledged.has(item.mutationId));
    next.cursor = result.cursor || next.cursor || "";
    return { state: next, cursor: next.cursor };
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
