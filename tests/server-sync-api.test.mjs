import test from "node:test";
import assert from "node:assert/strict";

// Integration suite for server/index.js against the live local stack
// (infra/docker-compose.yml + docker-compose.e2e.yml). Requires:
//   npm run e2e:stack:up
// The e2e realm enables direct access grants so this authenticates headlessly
// as the seeded throwaway user — production realms are untouched.
// Skips automatically when the stack isn't running, so plain `npm test`
// never fails without Docker.

const API_URL = process.env.NOVEL_TRACKER_API_URL || "http://localhost:8792";
const REALM_URL =
  process.env.NOVEL_TRACKER_REALM_URL || "http://localhost:8793/realms/novel-tracker";
const CLIENT_ID = "novel-tracker-extension";
const E2E_USERNAME = "e2e-tester";
const E2E_PASSWORD = "novel-tracker-e2e-password";

const RUN_ID = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const DEVICE_ID = `api-test-device-${RUN_ID}`;

async function fetchJson(url, options = {}, timeoutMs = 30_000) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, ok: response.ok, body };
}

async function apiUp() {
  try {
    const probe = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return probe.ok;
  } catch {
    return false;
  }
}

let cachedToken = "";
async function getAccessToken() {
  if (cachedToken) return cachedToken;
  const result = await fetchJson(`${REALM_URL}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: CLIENT_ID,
      scope: "openid",
      username: E2E_USERNAME,
      password: E2E_PASSWORD
    }).toString()
  });
  assert.equal(result.ok, true, `direct-grant token request failed: ${JSON.stringify(result.body)}`);
  cachedToken = result.body.access_token;
  assert.ok(cachedToken, "token response missing access_token");
  return cachedToken;
}

async function authedApi(path, options = {}) {
  const token = await getAccessToken();
  return fetchJson(`${API_URL}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
}

function validMutation(overrides = {}) {
  const novelId = overrides.novelId || `api-novel-${RUN_ID}-${Math.random().toString(16).slice(2, 8)}`;
  const now = Date.now();
  return {
    mutationId: `api-mutation-${RUN_ID}-${Math.random().toString(16).slice(2, 8)}`,
    deviceId: DEVICE_ID,
    novelId,
    generation: 1,
    clock: { wallMs: now, logical: 0, actorId: DEVICE_ID },
    type: "novel.create",
    payload: {
      title: `API Test Novel ${RUN_ID}`,
      sourceSite: "example.test",
      event: {
        id: `${novelId}-event`,
        url: `https://example.test/${novelId}/chapter-1`,
        label: "Chapter 1",
        readAt: { wallMs: now, logical: 0, actorId: DEVICE_ID }
      }
    },
    ...overrides
  };
}

const up = await apiUp();

if (!up) {
  test("server sync API integration", { skip: "local e2e stack not running — npm run e2e:stack:up" }, () => {});
} else {
  test.before(async () => {
    await authedApi("/v1/account", { method: "DELETE" }).catch(() => {});
  });

  test.after(async () => {
    await authedApi("/v1/account", { method: "DELETE" }).catch(() => {});
  });

  test("valid push is acknowledged and returns the canonical state blob", async () => {
    const mutation = validMutation();
    const result = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: [mutation] })
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.acknowledgedMutationIds, [mutation.mutationId]);
    assert.equal(result.body.cursor, "1");
    assert.ok(result.body.state, "a batch that applied changes must return the canonical state");
    assert.ok(result.body.state.novels[mutation.novelId], "state contains the created novel");

    const pull = await authedApi("/v1/sync");
    assert.equal(pull.status, 200);
    assert.ok(Array.isArray(pull.body.mutations));
    assert.ok(pull.body.mutations.some((item) => item.mutationId === mutation.mutationId));
    assert.equal(typeof pull.body.hasMore, "boolean");
  });

  test("structurally invalid mutations are explicitly rejected, not silently skipped", async () => {
    const bad = validMutation({ type: "bogus.type" });
    const result = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: [bad] })
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.acknowledgedMutationIds.length, 0);
    assert.ok(Array.isArray(result.body.rejectedMutations), "rejectedMutations must be reported");
    assert.equal(result.body.rejectedMutations.length, 1);
    assert.equal(result.body.rejectedMutations[0].mutationId, bad.mutationId);
    assert.match(result.body.rejectedMutations[0].reason, /invalid/);

    // And the pull log must not contain it.
    const pull = await authedApi("/v1/sync");
    assert.ok(!pull.body.mutations.some((item) => item.mutationId === bad.mutationId));
  });

  test("an oversized single payload is rejected individually with payload-too-large", async () => {
    const big = validMutation({
      payload: { title: "Big", notes: "x".repeat(40 * 1024) }
    });
    const serialized = JSON.stringify(big);
    assert.ok(serialized.length > 32 * 1024, "test payload must exceed the per-mutation cap");

    const result = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: [big] })
    });
    assert.equal(result.status, 200, "one large item must not sink the whole batch transport");
    assert.equal(result.body.acknowledgedMutationIds.length, 0);
    assert.equal(result.body.rejectedMutations.length, 1);
    assert.equal(result.body.rejectedMutations[0].mutationId, big.mutationId);
    assert.equal(result.body.rejectedMutations[0].reason, "payload-too-large");
  });

  test("a multi-megabyte body yields per-item rejections instead of a body-size failure", async () => {
    // 10 x ~200KB payloads ≈ 2MB total: under the old 1MB bodyLimit this
    // request died with HTTP 413 before validation ever ran; under the 4MB
    // limit it parses and every oversized item is rejected explicitly.
    const items = Array.from({ length: 10 }, (_, index) =>
      validMutation({
        payload: { title: `Big ${index}`, notes: "x".repeat(200 * 1024) }
      })
    );
    const bodySize = JSON.stringify({ mutations: items }).length;
    assert.ok(bodySize > 1024 * 1024, "batch must exceed the old 1MB bodyLimit");
    assert.ok(bodySize < 4 * 1024 * 1024, "batch must fit the new 4MB bodyLimit");

    const result = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: items })
    });
    assert.equal(result.status, 200, `expected 200 with rejections, got ${result.status}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.acknowledgedMutationIds.length, 0);
    assert.equal(result.body.rejectedMutations.length, items.length);
    assert.ok(result.body.rejectedMutations.every((item) => item.reason === "payload-too-large"));
  });

  test("a rejection reports its position so an unusable id can still be dropped", async () => {
    const nameless = validMutation();
    delete nameless.mutationId;
    const good = validMutation();
    const result = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: [nameless, good] })
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.acknowledgedMutationIds, [good.mutationId]);
    assert.equal(result.body.rejectedMutations.length, 1);
    // Position is the only handle the client has on a mutation rejected for
    // having no usable id; without it the mutation stays pending forever.
    assert.equal(result.body.rejectedMutations[0].index, 0);
    assert.equal(result.body.rejectedMutations[0].mutationId, "");
  });

  test("the canonical state blob never ships appliedMutations", async () => {
    // Receipts are the durable dedup; keeping the map in the JSONB state made
    // sync_states grow without bound. Clients restore their own local map.
    const result = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: [validMutation()] })
    });
    assert.equal(result.status, 200);
    assert.ok(result.body.state, "an applied batch returns state");
    assert.equal("appliedMutations" in result.body.state, false);
  });

  test("a full legal batch is validated per item rather than refused wholesale", async () => {
    // MAX_MUTATIONS_PER_BATCH x MAX_MUTATION_JSON_BYTES must fit under
    // bodyLimit, or a worst-case legal batch dies on an opaque body-size error
    // before validation ever runs.
    const items = Array.from({ length: 500 }, (_, index) =>
      validMutation({ payload: { title: `Bulk ${index}`, notes: "n".repeat(4000) } })
    );
    const result = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: items })
    });
    assert.equal(result.status, 200, `expected 200, got ${result.status}: ${JSON.stringify(result.body)?.slice(0, 200)}`);
    assert.equal(result.body.rejectedMutations.length, 0, "a legal batch has nothing to reject");
    assert.equal(result.body.acknowledgedMutationIds.length, items.length);
  });

  test("duplicate-only replay omits the canonical state blob from the response", async () => {
    const mutation = validMutation();
    const first = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: [mutation] })
    });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.acknowledgedMutationIds, [mutation.mutationId]);
    assert.ok(first.body.state, "first application must return state");

    const replay = await authedApi("/v1/sync/mutations", {
      method: "POST",
      body: JSON.stringify({ mutations: [mutation] })
    });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.acknowledgedMutationIds, [mutation.mutationId], "replay stays idempotent");
    assert.equal(
      replay.body.state,
      undefined,
      "steady-state duplicate batches must not ship the whole canonical blob"
    );
    assert.equal(replay.body.cursor, first.body.cursor, "cursor does not move for duplicates");
  });
}
