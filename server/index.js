import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { createRemoteJWKSet, jwtVerify } from "jose";
import pg from "pg";
import {
  applyMutation,
  createSyncState,
  findCanonicalNovelId,
  purgeExpiredTombstones,
  TOMBSTONE_RETENTION_MS
} from "../src/lib/sync-core.js";
import { clampMutationClock } from "../src/lib/sync-policy.js";
import {
  API_CLIENT_PLATFORM_HEADER,
  API_CLIENT_VERSION_HEADER,
  API_CONTRACTS,
  API_VERSION,
  API_VERSION_HEADER
} from "../src/lib/api-version.js";
import { readAppleConfig } from "./apple-client-secret.js";
import {
  deleteIdentityUser,
  readBrokerToken,
  readIdentityAdminConfig,
  revokeAppleToken
} from "./identity-admin.js";
import { runMigrations } from "./migrations.js";

const { Pool } = pg;
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const releaseInfo = {
  version: packageJson.version,
  commit: process.env.NOVEL_TRACKER_COMMIT || "unknown",
  apiVersion: API_VERSION
};
const database = new Pool({ connectionString: process.env.DATABASE_URL });
const issuer = process.env.KEYCLOAK_ISSUER;
const audience = process.env.KEYCLOAK_AUDIENCE;
// KEYCLOAK_JWKS_URL lets the signing-key fetch target a different address
// than `issuer` (which must equal tokens' exact `iss` claim). Needed for the
// local e2e stack: Keycloak's issuer has to be the host-reachable
// http://localhost:8793 the browser used to sign in, but that address is
// meaningless from inside the API container's own network namespace — it
// has to reach Keycloak via the compose network's http://keycloak:8080
// instead. Production only sets KEYCLOAK_ISSUER, so this defaults to the
// prior behavior there.
const jwksUrl = process.env.KEYCLOAK_JWKS_URL || (issuer ? `${issuer}/protocol/openid-connect/certs` : null);
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;
const appleConfig = readAppleConfig();
const identityAdminConfig = readIdentityAdminConfig();
const MAX_MUTATIONS_PER_BATCH = 500;
// A single legal mutation stays well under this: notes cap at 4,000 chars and
// tags at 20 x 40 (see src/lib/storage.js). Anything larger is rejected with an
// explicit reason (never silently skipped — see the validation loop below).
const MAX_MUTATION_JSON_BYTES = 8 * 1024;
// Derived from the two limits above so a worst-case *legal* batch can never be
// killed by an opaque body-size error before per-item validation runs. The
// slack covers the JSON envelope around the array.
const BODY_LIMIT_BYTES = MAX_MUTATIONS_PER_BATCH * MAX_MUTATION_JSON_BYTES + 64 * 1024;
const app = Fastify({ logger: true, bodyLimit: BODY_LIMIT_BYTES });
const SYNC_PAGE_SIZE = 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_REQUESTS_PER_WINDOW = 120;
const PURGE_BATCH_SIZE = 100;
const requestWindows = new Map();
const MUTATION_TYPES = new Set(["novel.create", "novel.patch", "checkpoint.record", "novel.delete", "novel.restore"]);
const CLIENT_PLATFORMS = new Set(["chrome", "firefox", "safari", "safari-ios-app", "integration", "unknown"]);

const migrationState = await runMigrations(database);

function safeClientVersion(value) {
  const normalized = String(value || "unknown").trim().slice(0, 64);
  return /^(?:unknown|[0-9]+(?:\.[0-9]+){1,3}(?:-[a-zA-Z0-9.-]+)?)$/.test(normalized) ? normalized : "invalid";
}

function safeClientPlatform(value) {
  const normalized = String(value || "unknown").trim().slice(0, 32);
  return CLIENT_PLATFORMS.has(normalized) ? normalized : "other";
}

app.addHook("onRequest", async (request, reply) => {
  const versionMatch = request.url.match(/^\/(v[1-9][0-9]*)(?:\/|\?|$)/);
  if (!versionMatch || !API_CONTRACTS[versionMatch[1]]) return;
  request.apiVersion = versionMatch[1];
  const apiVersionNumber = request.apiVersion.slice(1);
  request.apiClientVersion = safeClientVersion(request.headers[API_CLIENT_VERSION_HEADER]);
  request.apiClientPlatform = safeClientPlatform(request.headers[API_CLIENT_PLATFORM_HEADER]);
  reply.header(API_VERSION_HEADER, apiVersionNumber);

  const claimedVersion = request.headers[API_VERSION_HEADER];
  if (claimedVersion && claimedVersion !== apiVersionNumber) {
    return reply.code(400).send({ error: "API version header does not match request path" });
  }
});

app.addHook("onResponse", async (request, reply) => {
  if (!request.apiVersion) return;
  request.log.info({
    event: "api-client-request",
    apiVersion: request.apiVersion,
    clientVersion: request.apiClientVersion,
    clientPlatform: request.apiClientPlatform,
    method: request.method,
    route: request.routeOptions?.url || request.url.split("?", 1)[0],
    statusCode: reply.statusCode
  }, "API client request");
  if (!request.userSubject) return;
  try {
    await database.query(
      `INSERT INTO api_client_usage (api_version, client_version, client_platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (api_version, client_version, client_platform)
       DO UPDATE SET last_seen_at = now(), request_count = api_client_usage.request_count + 1`,
      [request.apiVersion, request.apiClientVersion, request.apiClientPlatform]
    );
  } catch (error) {
    request.log.error({ error, event: "api-client-usage-write-failed" }, "Could not record API client usage");
  }
});

app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/health" || request.url === "/ready") return;
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token || !jwks) return reply.code(401).send({ error: "unauthorized" });
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    request.userSubject = payload.sub;
    // `provider` is a Keycloak mapper over the `identity_provider` session note
    // (scripts/configure-keycloak.sh). Account deletion needs it to decide
    // whether an Apple grant also has to be revoked, and the raw token is what
    // reads that user's stored broker token.
    request.userProvider = typeof payload.provider === "string" ? payload.provider : "";
    request.userAccessToken = token;
    const now = Date.now();
    const current = requestWindows.get(payload.sub);
    const window = !current || now - current.startedAt >= RATE_WINDOW_MS
      ? { startedAt: now, count: 0 }
      : current;
    window.count += 1;
    requestWindows.set(payload.sub, window);
    if (requestWindows.size > 10_000) {
      for (const [subject, candidate] of requestWindows) {
        if (now - candidate.startedAt >= RATE_WINDOW_MS) requestWindows.delete(subject);
      }
    }
    if (window.count > RATE_REQUESTS_PER_WINDOW) {
      return reply.code(429).send({ error: "rate limit exceeded" });
    }
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

async function lockedState(client, subject) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [subject]);
  const row = await client.query("SELECT state, sequence FROM sync_states WHERE subject = $1 FOR UPDATE", [subject]);
  if (row.rowCount) {
    const state = row.rows[0].state;
    // Stripped before persisting (receipts are the durable dedup), so states
    // written by this version arrive without it.
    state.appliedMutations ||= {};
    return { state, sequence: Number(row.rows[0].sequence) };
  }
  const state = createSyncState();
  await client.query("INSERT INTO sync_states (subject, state) VALUES ($1, $2)", [subject, state]);
  return { state, sequence: 0 };
}

async function canonicalNovelId(client, subject, state, mutation) {
  const mapped = await client.query(
    "SELECT canonical_novel_id FROM novel_id_mappings WHERE subject = $1 AND device_id = $2 AND local_novel_id = $3",
    [subject, mutation.deviceId, mutation.novelId]
  );
  if (mapped.rowCount) return mapped.rows[0].canonical_novel_id;
  const canonicalId = findCanonicalNovelId(state, mutation);
  await client.query(
    `INSERT INTO novel_id_mappings (subject, device_id, local_novel_id, canonical_novel_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (subject, device_id, local_novel_id) DO NOTHING`,
    [subject, mutation.deviceId, mutation.novelId, canonicalId]
  );
  return canonicalId;
}

app.post(API_CONTRACTS.v1.endpoints.pushMutations.path, async (request, reply) => {
  const mutations = Array.isArray(request.body?.mutations) ? request.body.mutations : null;
  if (!mutations) return reply.code(400).send({ error: "mutations must be an array" });
  if (mutations.length > MAX_MUTATIONS_PER_BATCH) return reply.code(413).send({ error: "mutation batch is too large" });
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    let { state, sequence } = await lockedState(client, request.userSubject);
    state = purgeExpiredTombstones(state);
    const acknowledgedMutationIds = [];
    const rejectedMutations = [];
    const novelIdMappings = [];
    let appliedCount = 0;
    for (const [index, original] of mutations.entries()) {
      // Structurally invalid mutations are reported, never silently skipped.
      // A silent skip would leave the mutation in the client's pending queue
      // forever (the client drops only acknowledged ids), wedging that
      // account's sync on every future batch. The position is reported
      // alongside the id because the one mutation an id cannot identify is the
      // one rejected for having no usable id.
      const reject = (reason) =>
        rejectedMutations.push({ index, mutationId: String(original?.mutationId || ""), reason });
      if (
        !original?.mutationId || String(original.mutationId).length > 200 ||
        !original?.deviceId || String(original.deviceId).length > 200 ||
        !original?.novelId || String(original.novelId).length > 200 ||
        !MUTATION_TYPES.has(original?.type) || !original?.clock ||
        !Number.isInteger(Number(original.generation)) || Number(original.generation) < 1 ||
        typeof original.payload !== "object" || original.payload === null
      ) {
        reject("invalid-mutation");
        continue;
      }
      if (Buffer.byteLength(JSON.stringify(original), "utf8") > MAX_MUTATION_JSON_BYTES) {
        reject("payload-too-large");
        continue;
      }
      const canonicalId = await canonicalNovelId(client, request.userSubject, state, original);
      novelIdMappings.push({ localNovelId: original.novelId, canonicalNovelId: canonicalId });
      const existing = await client.query(
        "SELECT 1 FROM sync_mutation_receipts WHERE subject = $1 AND mutation_id = $2",
        [request.userSubject, original.mutationId]
      );
      if (existing.rowCount) {
        acknowledgedMutationIds.push(original.mutationId);
        continue;
      }
      await client.query(
        "INSERT INTO sync_mutation_receipts (subject, mutation_id) VALUES ($1, $2)",
        [request.userSubject, original.mutationId]
      );
      const purged = await client.query(
        "SELECT 1 FROM purged_novel_ids WHERE subject = $1 AND canonical_novel_id = $2",
        [request.userSubject, canonicalId]
      );
      if (purged.rowCount) {
        acknowledgedMutationIds.push(original.mutationId);
        continue;
      }
      sequence += 1;
      const currentNovel = state.novels?.[canonicalId];
      const mutation = clampMutationClock({
        ...original,
        novelId: canonicalId,
        generation: currentNovel?.lifecycle === "active" ? currentNovel.generation : original.generation,
        serverSequence: sequence
      });
      state = applyMutation(state, mutation);
      appliedCount += 1;
      await client.query(
        "INSERT INTO sync_mutations (subject, mutation_id, sequence, mutation) VALUES ($1, $2, $3, $4)",
        [request.userSubject, mutation.mutationId, sequence, mutation]
      );
      acknowledgedMutationIds.push(mutation.mutationId);
    }
    // sync_mutation_receipts is the durable dedup record; keeping every
    // applied id in the JSONB state as well made sync_states grow without
    // bound and get rewritten on every batch. Strip it before persisting —
    // replay safety comes from receipts plus structurally idempotent
    // re-application (see docs/sync-api.md).
    delete state.appliedMutations;
    await client.query(
      "UPDATE sync_states SET state = $2, sequence = $3, updated_at = now() WHERE subject = $1",
      [request.userSubject, state, sequence]
    );
    await client.query("COMMIT");
    return {
      acknowledgedMutationIds,
      rejectedMutations,
      novelIdMappings,
      // The full canonical blob only rides along when something actually
      // changed; steady-state duplicate/heartbeat batches stay tiny. Clients
      // already fall back to applying an empty batch locally when state is
      // absent (adoptCanonicalState).
      ...(appliedCount > 0 ? { state } : {}),
      mutations: [],
      cursor: String(sequence)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.get(API_CONTRACTS.v1.endpoints.pullSync.path, async (request) => {
  const cursor = Math.max(0, Number.parseInt(request.query?.cursor || "0", 10) || 0);
  const changes = await database.query(
    "SELECT sequence, mutation FROM sync_mutations WHERE subject = $1 AND sequence > $2 ORDER BY sequence ASC LIMIT $3",
    [request.userSubject, cursor, SYNC_PAGE_SIZE]
  );
  const latest = await database.query("SELECT sequence FROM sync_states WHERE subject = $1", [request.userSubject]);
  const latestSequence = Number(latest.rows[0]?.sequence || 0);
  const pageCursor = changes.rows.length ? Number(changes.rows.at(-1).sequence) : latestSequence;
  return {
    mutations: changes.rows.map((row) => row.mutation),
    cursor: String(pageCursor),
    hasMore: pageCursor < latestSequence
  };
});

async function deleteSyncData(subject) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [subject]);
    await client.query("DELETE FROM purged_novel_ids WHERE subject = $1", [subject]);
    await client.query("DELETE FROM sync_mutation_receipts WHERE subject = $1", [subject]);
    await client.query("DELETE FROM novel_id_mappings WHERE subject = $1", [subject]);
    await client.query("DELETE FROM sync_states WHERE subject = $1", [subject]);
    await client.query("DELETE FROM sync_mutations WHERE subject = $1", [subject]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Erases everything synced to the account while leaving the account itself in
// place, so the next sync repopulates the server from whatever the device still
// holds. This is the pre-existing behaviour of `DELETE /v1/account`, split out
// under its own path now that that route deletes the account for real.
app.delete(API_CONTRACTS.v1.endpoints.deleteSyncData.path, async (request) => {
  await deleteSyncData(request.userSubject);
  return { deleted: true };
});

// Deletes the account itself, not just its synced rows (App Store guideline
// 5.1.1(v) — a disconnect or deactivate is explicitly not enough).
//
// The step order is chosen for its failure modes. The identity is removed
// *last*, so anything that fails before it leaves the reader still signed in
// and able to retry the whole request. Deleting the Keycloak user first would
// strand sync rows under a subject that can no longer authenticate to retry,
// which is the one outcome with no recovery path.
app.delete(API_CONTRACTS.v1.endpoints.deleteAccount.path, async (request, reply) => {
  if (!identityAdminConfig.configured) {
    // Refuse up front rather than deleting the data and silently leaving the
    // account alive — that half-success is the exact defect being fixed here.
    request.log.error("Account deletion is unavailable: Keycloak admin credentials are not configured");
    return reply.code(503).send({ error: "account deletion is unavailable" });
  }

  if (request.userProvider === "apple") {
    if (!appleConfig.configured) {
      request.log.error("Account deletion is unavailable: Apple credentials are not configured");
      return reply.code(503).send({ error: "account deletion is unavailable" });
    }
    // Apple requires the grant to be revoked when the account goes away, and
    // the stored token is unreadable once the Keycloak user is gone — so this
    // has to happen before either deletion below.
    const brokerToken = await readBrokerToken(identityAdminConfig, request.userAccessToken, "apple");
    await revokeAppleToken(appleConfig, brokerToken);
  }

  await deleteSyncData(request.userSubject);
  await deleteIdentityUser(identityAdminConfig, request.userSubject);
  return { deleted: true };
});

app.get("/health", async () => ({ ok: true, ...releaseInfo }));

app.get("/ready", async (_request, reply) => {
  if (!issuer || !audience || !jwks) {
    return reply.code(503).send({ ok: false, reason: "identity-config" });
  }
  try {
    await database.query({ text: "SELECT 1", query_timeout: 2_000 });
    return { ok: true, ...releaseInfo, schema: migrationState.latestVersion };
  } catch (error) {
    app.log.error(error, "Readiness database check failed");
    return reply.code(503).send({ ok: false, reason: "database" });
  }
});

async function purgeExpiredServerTombstones() {
  // Keyset-paginated by subject: an updated_at cursor would livelock on
  // subjects with nothing to purge (they never move forward). Each chunk
  // takes the SAME per-subject advisory lock the mutation path uses — before
  // any row lock, and in ascending subject order — so a purge chunk can never
  // deadlock against a concurrent push (push = advisory then row, same
  // subject; purge holds no row locks while acquiring advisories).
  let lastSubject = "";
  try {
    for (;;) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const page = await client.query(
          "SELECT subject FROM sync_states WHERE subject > $1 ORDER BY subject LIMIT $2",
          [lastSubject, PURGE_BATCH_SIZE]
        );
        if (!page.rows.length) {
          await client.query("COMMIT");
          return;
        }
        const subjects = page.rows.map((row) => row.subject);
        for (const subject of subjects) {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [subject]);
        }
        const rows = await client.query(
          "SELECT subject, state FROM sync_states WHERE subject > $1 AND subject <= $2 ORDER BY subject FOR UPDATE",
          [lastSubject, subjects.at(-1)]
        );
        for (const row of rows.rows) {
          const expiredIds = Object.values(row.state.novels || {})
            .filter((novel) => novel.lifecycle === "deleted" && Date.now() - Number(novel.deletedAtMs || Date.now()) >= TOMBSTONE_RETENTION_MS)
            .map((novel) => novel.id);
          if (!expiredIds.length) continue;
          const state = purgeExpiredTombstones(row.state);
          await client.query(
            `INSERT INTO purged_novel_ids (subject, canonical_novel_id)
             SELECT $1, unnest($2::text[])
             ON CONFLICT DO NOTHING`,
            [row.subject, expiredIds]
          );
          await client.query("UPDATE sync_states SET state = $2, updated_at = now() WHERE subject = $1", [row.subject, state]);
          await client.query(
            "DELETE FROM sync_mutations WHERE subject = $1 AND mutation->>'novelId' = ANY($2::text[])",
            [row.subject, expiredIds]
          );
        }
        lastSubject = subjects.at(-1);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  } catch (error) {
    app.log.error(error, "Tombstone cleanup failed");
  }
}

const cleanupTimer = setInterval(purgeExpiredServerTombstones, 24 * 60 * 60 * 1000);
cleanupTimer.unref();
purgeExpiredServerTombstones().catch((error) => app.log.error(error));

app.addHook("onClose", async () => {
  await database.end();
});

// Drain in-flight requests, then close the pool via the onClose hook above.
// The timer is the backstop: if a request or a purge chunk refuses to finish,
// exit anyway rather than sit until the container runtime sends SIGKILL.
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down");
  const force = setTimeout(() => {
    app.log.error({ signal }, "Graceful shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();
  app.close().then(
    () => process.exit(0),
    (error) => {
      app.log.error(error, "Shutdown failed");
      process.exit(1);
    }
  );
}

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => shutdown(signal));

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3000) });
