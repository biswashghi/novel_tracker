import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const migrationsDirectory = new URL("./migrations/", import.meta.url);
const migrationPattern = /^\d{4}_[a-z0-9_-]+\.sql$/;

export async function loadMigrations(directory = migrationsDirectory) {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (!filenames.length) throw new Error("No database migrations were found.");
  for (const filename of filenames) {
    if (!migrationPattern.test(filename)) throw new Error(`Invalid migration filename: ${filename}`);
  }

  return Promise.all(
    filenames.map(async (version) => {
      const sql = await readFile(new URL(version, directory), "utf8");
      return {
        version,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex")
      };
    })
  );
}

export async function runMigrations(pool, directory = migrationsDirectory) {
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  try {
    // A session-level advisory lock prevents two newly started API containers
    // from racing the same migration during deployment.
    await client.query("SELECT pg_advisory_lock(hashtext($1))", ["novel-tracker-schema-migrations"]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query("SELECT version, checksum FROM schema_migrations ORDER BY version");
    const checksums = new Map(applied.rows.map((row) => [row.version, row.checksum]));

    for (const migration of migrations) {
      const existingChecksum = checksums.get(migration.version);
      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new Error(`Applied migration ${migration.version} has been modified.`);
      }
      if (existingChecksum) continue;

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
          migration.version,
          migration.checksum
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return { latestVersion: migrations.at(-1).version };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["novel-tracker-schema-migrations"]).catch(() => {});
    client.release();
  }
}
