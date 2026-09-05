import assert from "node:assert/strict";
import test from "node:test";

import { loadMigrations, runMigrations } from "../server/migrations.js";

function fakePool(appliedRows = []) {
  const statements = [];
  const client = {
    async query(statement, parameters) {
      const text = typeof statement === "string" ? statement : statement.text;
      statements.push({ text, parameters });
      if (text === "SELECT version, checksum FROM schema_migrations ORDER BY version") {
        return { rows: appliedRows };
      }
      return { rows: [] };
    },
    release() {
      statements.push({ text: "RELEASE" });
    }
  };
  return { pool: { async connect() { return client; } }, statements };
}

test("database migrations are ordered and checksummed", async () => {
  const migrations = await loadMigrations();
  assert.ok(migrations.length > 0);
  assert.deepEqual(
    migrations.map(({ version }) => version),
    [...migrations.map(({ version }) => version)].sort()
  );
  for (const migration of migrations) assert.match(migration.checksum, /^[a-f0-9]{64}$/);
});

test("migration runner records unapplied migrations transactionally", async () => {
  const { pool, statements } = fakePool();
  const migrations = await loadMigrations();
  const result = await runMigrations(pool);

  assert.equal(result.latestVersion, migrations.at(-1).version);
  assert.ok(statements.some(({ text }) => text === "BEGIN"));
  assert.ok(statements.some(({ text }) => text === migrations[0].sql));
  assert.ok(statements.some(({ text }) => text.startsWith("INSERT INTO schema_migrations")));
  assert.ok(statements.some(({ text }) => text === "COMMIT"));
  assert.equal(statements.at(-1).text, "RELEASE");
});

test("migration runner refuses edits to an applied migration", async () => {
  const migrations = await loadMigrations();
  const { pool, statements } = fakePool([{ version: migrations[0].version, checksum: "changed" }]);

  await assert.rejects(runMigrations(pool), /has been modified/);
  assert.ok(!statements.some(({ text }) => text === migrations[0].sql));
  assert.equal(statements.at(-1).text, "RELEASE");
});
