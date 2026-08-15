import test from "node:test";
import assert from "node:assert/strict";
import { createSyncState, enqueueLocalMutation } from "../src/lib/sync-core.js";
import { SyncClient } from "../src/lib/sync-client.js";

test("push adopts canonical server state and removes acknowledged local duplicates", async () => {
  let local = createSyncState({ deviceId: "local-device", now: 1 });
  local = enqueueLocalMutation(local, {
    novelId: "local-novel",
    generation: 1,
    type: "novel.create",
    payload: { title: "Novel", sourceSite: "example.test" }
  }, { now: 2 }).state;
  const mutationId = local.pendingMutations[0].mutationId;
  const serverState = createSyncState({ deviceId: "server", now: 3 });
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
