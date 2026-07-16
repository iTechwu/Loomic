import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadServerEnv } from "../config/env.js";
import { createDatabasePool } from "./pool.js";

const migrationDirectory = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

async function migrate() {
  const env = loadServerEnv();
  if (!env.databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");

  const pool = createDatabasePool(env.databaseUrl);
  try {
    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();
    await pool.query(`create table if not exists app_schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())`);

    for (const file of files) {
      const sql = await readFile(join(migrationDirectory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      await pool.transaction(async (client) => {
        const existing = await client.query<{ checksum: string }>(
          "select checksum from app_schema_migrations where version = $1",
          [file],
        );
        if (existing.rowCount) {
          if (existing.rows[0]!.checksum !== checksum) {
            throw new Error(`Migration checksum changed after application: ${file}`);
          }
          return;
        }
        await client.query(sql);
        await client.query(
          "insert into app_schema_migrations (version, checksum) values ($1, $2)",
          [file, checksum],
        );
        console.info("[database-migrate] applied", { file });
      });
    }
  } finally {
    await pool.end();
  }
}

void migrate().catch((error: unknown) => {
  console.error("[database-migrate] failed", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
