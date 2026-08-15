import Fastify from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import pg from "pg";
import { applyMutation, createSyncState } from "../src/lib/sync-core.js";

const { Pool } = pg;
const database = new Pool({ connectionString: process.env.DATABASE_URL });
const issuer = process.env.KEYCLOAK_ISSUER;
const audience = process.env.KEYCLOAK_AUDIENCE;
const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`)) : null;
const app = Fastify({ logger: true });

await database.query(`
  CREATE TABLE IF NOT EXISTS sync_states (
    subject TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    sequence BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sync_mutations (
    subject TEXT NOT NULL,
    mutation_id UUID NOT NULL,
    sequence BIGINT NOT NULL,
    mutation JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, mutation_id)
  );
`);

app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/health") return;
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token || !jwks) return reply.code(401).send({ error: "unauthorized" });
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    request.userSubject = payload.sub;
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

async function lockedState(client, subject) {
  const row = await client.query("SELECT state, sequence FROM sync_states WHERE subject = $1 FOR UPDATE", [subject]);
  if (row.rowCount) return { state: row.rows[0].state, sequence: Number(row.rows[0].sequence) };
  const state = createSyncState();
  await client.query("INSERT INTO sync_states (subject, state) VALUES ($1, $2)", [subject, state]);
  return { state, sequence: 0 };
}

app.post("/v1/sync/mutations", async (request, reply) => {
  const mutations = Array.isArray(request.body?.mutations) ? request.body.mutations : null;
  if (!mutations) return reply.code(400).send({ error: "mutations must be an array" });
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    let { state, sequence } = await lockedState(client, request.userSubject);
    const acknowledgedMutationIds = [];
    for (const original of mutations) {
      if (!original?.mutationId || !original?.novelId || !original?.type) continue;
      const existing = await client.query(
        "SELECT sequence FROM sync_mutations WHERE subject = $1 AND mutation_id = $2",
        [request.userSubject, original.mutationId]
      );
      if (existing.rowCount) {
        acknowledgedMutationIds.push(original.mutationId);
        continue;
      }
      sequence += 1;
      const mutation = { ...original, serverSequence: sequence };
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
    return { acknowledgedMutationIds, mutations: [], cursor: String(sequence) };
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
    "SELECT mutation FROM sync_mutations WHERE subject = $1 AND sequence > $2 ORDER BY sequence ASC",
    [request.userSubject, cursor]
  );
  const latest = await database.query("SELECT sequence FROM sync_states WHERE subject = $1", [request.userSubject]);
  return { mutations: changes.rows.map((row) => row.mutation), cursor: String(latest.rows[0]?.sequence || 0) };
});

app.delete("/v1/account", async (request) => {
  await database.query("DELETE FROM sync_states WHERE subject = $1", [request.userSubject]);
  await database.query("DELETE FROM sync_mutations WHERE subject = $1", [request.userSubject]);
  return { deleted: true };
});

app.get("/health", async () => ({ ok: true }));
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3000) });
