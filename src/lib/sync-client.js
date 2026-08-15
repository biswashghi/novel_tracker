import { applyMutationBatch } from "./sync-core.js";

/**
 * Transport-neutral client for the documented /v1/sync API. Authentication is
 * supplied by the host so local-only users never need to construct this class.
 */
export class SyncClient {
  constructor({ baseUrl, getAccessToken, fetchImpl = globalThis.fetch }) {
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
    const next = applyMutationBatch(state, result.mutations || []);
    next.pendingMutations = next.pendingMutations.filter((item) => !acknowledged.has(item.mutationId));
    next.cursor = result.cursor || next.cursor || "";
    return { state: next, cursor: next.cursor };
  }

  async pull(state) {
    const result = await this.request(`/v1/sync?cursor=${encodeURIComponent(state.cursor || "")}`);
    const next = applyMutationBatch(state, result.mutations || []);
    next.cursor = result.cursor || next.cursor || "";
    return { state: next, cursor: next.cursor };
  }
}
