import Fastify from "fastify";
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

const { Pool } = pg;
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
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
const MAX_MUTATIONS_PER_BATCH = 500;
const SYNC_PAGE_SIZE = 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_REQUESTS_PER_WINDOW = 120;
const requestWindows = new Map();
const MUTATION_TYPES = new Set(["novel.create", "novel.patch", "checkpoint.record", "novel.delete", "novel.restore"]);

await database.query(`
  CREATE TABLE IF NOT EXISTS sync_states (
    subject TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    sequence BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sync_mutations (
    subject TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,
    mutation JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, mutation_id)
  );
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'sync_mutations' AND column_name = 'mutation_id' AND data_type <> 'text'
    ) THEN
      ALTER TABLE sync_mutations ALTER COLUMN mutation_id TYPE TEXT USING mutation_id::text;
    END IF;
  END $$;
  CREATE TABLE IF NOT EXISTS novel_id_mappings (
    subject TEXT NOT NULL,
    device_id TEXT NOT NULL,
    local_novel_id TEXT NOT NULL,
    canonical_novel_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, device_id, local_novel_id)
  );
  CREATE TABLE IF NOT EXISTS sync_mutation_receipts (
    subject TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, mutation_id)
  );
  CREATE TABLE IF NOT EXISTS purged_novel_ids (
    subject TEXT NOT NULL,
    canonical_novel_id TEXT NOT NULL,
    purged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, canonical_novel_id)
  );
  INSERT INTO sync_mutation_receipts (subject, mutation_id)
  SELECT subject, mutation_id FROM sync_mutations
  ON CONFLICT DO NOTHING;
`);

app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/health") return;
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token || !jwks) return reply.code(401).send({ error: "unauthorized" });
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    request.userSubject = payload.sub;
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
  if (row.rowCount) return { state: row.rows[0].state, sequence: Number(row.rows[0].sequence) };
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

app.post("/v1/sync/mutations", async (request, reply) => {
  const mutations = Array.isArray(request.body?.mutations) ? request.body.mutations : null;
  if (!mutations) return reply.code(400).send({ error: "mutations must be an array" });
  if (mutations.length > MAX_MUTATIONS_PER_BATCH) return reply.code(413).send({ error: "mutation batch is too large" });
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    let { state, sequence } = await lockedState(client, request.userSubject);
    state = purgeExpiredTombstones(state);
    const acknowledgedMutationIds = [];
    const novelIdMappings = [];
    for (const original of mutations) {
      if (
        !original?.mutationId || String(original.mutationId).length > 200 ||
        !original?.deviceId || String(original.deviceId).length > 200 ||
        !original?.novelId || String(original.novelId).length > 200 ||
        !MUTATION_TYPES.has(original?.type) || !original?.clock ||
        !Number.isInteger(Number(original.generation)) || Number(original.generation) < 1 ||
        typeof original.payload !== "object" || original.payload === null
      ) continue;
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
      await client.query(
        "INSERT INTO sync_mutations (subject, mutation_id, sequence, mutation) VALUES ($1, $2, $3, $4)",
        [request.userSubject, mutation.mutationId, sequence, mutation]
      );
      acknowledgedMutationIds.push(mutation.mutationId);
    }
    await client.query(
      "UPDATE sync_states SET state = $2, sequence = $3, updated_at = now() WHERE subject = $1",
      [request.userSubject, state, sequence]
    );
    await client.query("COMMIT");
    return { acknowledgedMutationIds, novelIdMappings, state, mutations: [], cursor: String(sequence) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.get("/v1/sync", async (request) => {
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

app.delete("/v1/account", async (request) => {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [request.userSubject]);
    await client.query("DELETE FROM purged_novel_ids WHERE subject = $1", [request.userSubject]);
    await client.query("DELETE FROM sync_mutation_receipts WHERE subject = $1", [request.userSubject]);
    await client.query("DELETE FROM novel_id_mappings WHERE subject = $1", [request.userSubject]);
    await client.query("DELETE FROM sync_states WHERE subject = $1", [request.userSubject]);
    await client.query("DELETE FROM sync_mutations WHERE subject = $1", [request.userSubject]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { deleted: true };
});

app.get("/health", async () => ({ ok: true }));

async function purgeExpiredServerTombstones() {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query("SELECT subject, state FROM sync_states FOR UPDATE");
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    app.log.error(error, "Tombstone cleanup failed");
  } finally {
    client.release();
  }
}

const cleanupTimer = setInterval(purgeExpiredServerTombstones, 24 * 60 * 60 * 1000);
cleanupTimer.unref();
purgeExpiredServerTombstones().catch((error) => app.log.error(error));
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3000) });
