import test from "node:test";
import assert from "node:assert/strict";
import { applyMutation, createSyncState, enqueueLocalMutation } from "../src/lib/sync-core.js";
import { SyncClient } from "../src/lib/sync-client.js";
import {
  API_CLIENT_PLATFORM_HEADER,
  API_CLIENT_VERSION_HEADER,
  API_VERSION_HEADER
} from "../src/lib/api-version.js";

/**
 * The canonical blob as it actually arrives over the wire. server/index.js
 * deletes `appliedMutations` before persisting and responding (receipts are
 * its durable dedup), so a mock that keeps the field tests a payload the
 * server never sends.
 */
function canonicalStateFromServer(options) {
  const state = createSyncState(options);
  delete state.appliedMutations;
  return state;
}

test("push adopts canonical server state and removes acknowledged local duplicates", async () => {
  let local = createSyncState({ deviceId: "local-device", now: 1 });
  local = enqueueLocalMutation(local, {
    novelId: "local-novel",
    generation: 1,
    type: "novel.create",
    payload: { title: "Novel", sourceSite: "example.test" }
  }, { now: 2 }).state;
  const mutationId = local.pendingMutations[0].mutationId;
  const serverState = canonicalStateFromServer({ deviceId: "server", now: 3 });
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        acknowledgedMutationIds: [mutationId],
        novelIdMappings: [{ localNovelId: "local-novel", canonicalNovelId: "cloud-novel" }],
        state: serverState,
        cursor: "1"
      };
    }
  });
  const client = new SyncClient({ baseUrl: "https://api.test", getAccessToken: async () => "token", fetchImpl });
  const result = await client.push(local);
  assert.equal(result.state.deviceId, "local-device");
  assert.equal(result.state.pendingMutations.length, 0);
  assert.equal(result.state.cursor, "1");
});

test("requests identify the API contract, extension version, and platform", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() { return { mutations: [], cursor: "", hasMore: false }; }
    };
  };
  const client = new SyncClient({
    baseUrl: "https://api.test/",
    getAccessToken: async () => "token",
    clientIdentity: { version: "1.2.3.45", platform: "firefox" },
    fetchImpl
  });

  await client.pull(createSyncState({ deviceId: "test", now: 1 }));

  assert.equal(calls[0].url, "https://api.test/v1/sync?cursor=");
  assert.equal(calls[0].options.headers[API_VERSION_HEADER], "1");
  assert.equal(calls[0].options.headers[API_CLIENT_VERSION_HEADER], "1.2.3.45");
  assert.equal(calls[0].options.headers[API_CLIENT_PLATFORM_HEADER], "firefox");
});

test("rejected mutations are dropped from pending instead of wedging sync", async () => {
  let local = createSyncState({ deviceId: "local-device", now: 1 });
  local = enqueueLocalMutation(local, {
    novelId: "novel-a",
    generation: 1,
    type: "novel.create",
    payload: { title: "Good" }
  }, { now: 2 }).state;
  local = enqueueLocalMutation(local, {
    novelId: "novel-b",
    generation: 1,
    type: "novel.create",
    payload: { title: "Poisoned by schema drift" }
  }, { now: 3 }).state;

  const [goodMutation, badMutation] = local.pendingMutations;
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        acknowledgedMutationIds: [goodMutation.mutationId],
        rejectedMutations: [{ mutationId: badMutation.mutationId, reason: "invalid-mutation" }],
        novelIdMappings: [],
        state: canonicalStateFromServer({ deviceId: "server", now: 4 }),
        cursor: "2"
      };
    }
  });
  const client = new SyncClient({ baseUrl: "https://api.test", getAccessToken: async () => "token", fetchImpl });

  const first = await client.push(local);
  assert.equal(first.state.pendingMutations.length, 0, "rejections must not stay pending");
  assert.deepEqual(
    first.rejected.map((item) => ({ mutationId: item.mutationId, reason: item.reason })),
    [{ mutationId: badMutation.mutationId, reason: "invalid-mutation" }]
  );

  // The old failure mode: a second sync re-sends the poison pill forever.
  let secondCalls = 0;
  const countingFetch = async () => {
    secondCalls += 1;
    return { ok: true, async json() { return { acknowledgedMutationIds: [], novelIdMappings: [], cursor: "2" }; } };
  };
  const retryClient = new SyncClient({ baseUrl: "https://api.test", getAccessToken: async () => "token", fetchImpl: countingFetch });
  const second = await retryClient.push(first.state);
  assert.equal(second.state.pendingMutations.length, 0);
  assert.equal(secondCalls, 0, "nothing is re-pushed after rejection");
});

test("a canonical blob with no appliedMutations does not break local replay", async () => {
  // Regression: the server strips appliedMutations, adoptCanonicalState spread
  // it straight into local state, and the next applyMutation read undefined —
  // crashing the push and persisting a state that broke every later pull.
  let local = createSyncState({ deviceId: "local-device", now: 1 });
  local = enqueueLocalMutation(local, {
    novelId: "novel-keep",
    generation: 1,
    type: "novel.create",
    payload: { title: "Still pending" }
  }, { now: 2 }).state;

  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        acknowledgedMutationIds: [],
        rejectedMutations: [],
        novelIdMappings: [],
        state: canonicalStateFromServer({ deviceId: "server", now: 3 }),
        cursor: "4"
      };
    }
  });
  const client = new SyncClient({ baseUrl: "https://api.test", getAccessToken: async () => "token", fetchImpl });

  const result = await client.push(local);
  assert.equal(result.state.pendingMutations.length, 1, "an unacknowledged mutation stays pending");
  assert.deepEqual(Object.keys(result.state.appliedMutations), [local.pendingMutations[0].mutationId]);
  // The persisted state must stay usable for the pull that follows every push.
  assert.doesNotThrow(() => applyMutation(result.state, {
    mutationId: "from-another-device",
    deviceId: "other",
    novelId: "novel-keep",
    generation: 1,
    clock: { wallMs: 9, logical: 0, actorId: "other" },
    type: "novel.patch",
    payload: { title: "Renamed elsewhere" }
  }));
});

test("a mutation rejected for an unusable id is dropped by position", async () => {
  // An id-only match cannot identify the one mutation whose id is the problem,
  // so the server reports the index too. Without it this stays pending forever.
  let local = createSyncState({ deviceId: "local-device", now: 1 });
  local = enqueueLocalMutation(local, {
    novelId: "novel-d",
    generation: 1,
    type: "novel.create",
    payload: { title: "Corrupt" }
  }, { now: 2 }).state;
  local.pendingMutations[0].mutationId = "";

  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        acknowledgedMutationIds: [],
        rejectedMutations: [{ index: 0, mutationId: "", reason: "invalid-mutation" }],
        novelIdMappings: [],
        cursor: "5"
      };
    }
  });
  const client = new SyncClient({ baseUrl: "https://api.test", getAccessToken: async () => "token", fetchImpl });

  const result = await client.push(local);
  assert.equal(result.state.pendingMutations.length, 0, "an id-less rejection must still be dropped");
  assert.deepEqual(result.rejected, [{ mutationId: "", reason: "invalid-mutation" }]);
});

test("a slim response with no canonical blob still acks, remaps, and advances", async () => {
  // Duplicate-only batches omit `state`. Acknowledged mutations must still be
  // dropped and the cursor adopted, and the id mappings still have to land or
  // the next push re-creates a novel the server already merged.
  let local = createSyncState({ deviceId: "local-device", now: 1 });
  local = enqueueLocalMutation(local, {
    novelId: "local-only",
    generation: 1,
    type: "novel.create",
    payload: { title: "Mapped" }
  }, { now: 2 }).state;
  local = enqueueLocalMutation(local, {
    novelId: "local-only",
    generation: 1,
    type: "novel.patch",
    payload: { notes: "second, still pending" }
  }, { now: 3 }).state;
  const [firstId] = local.pendingMutations.map((item) => item.mutationId);

  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        acknowledgedMutationIds: [firstId],
        rejectedMutations: [],
        novelIdMappings: [{ localNovelId: "local-only", canonicalNovelId: "cloud-id" }],
        cursor: "7"
      };
    }
  });
  const client = new SyncClient({ baseUrl: "https://api.test", getAccessToken: async () => "token", fetchImpl });

  const result = await client.push(local);
  assert.equal(result.state.pendingMutations.length, 1, "the acknowledged mutation is dropped");
  assert.notEqual(result.state.pendingMutations[0].mutationId, firstId);
  assert.equal(result.state.pendingMutations[0].novelId, "cloud-id", "survivor is remapped to the canonical id");
  assert.equal(result.cursor, "7");
});
