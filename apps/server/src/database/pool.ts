import pg from "pg";

import { logOperationalFailure } from "../utils/operational-log.js";

export type DatabasePool = Pick<pg.Pool, "end" | "query"> & {
  transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T>;
};

/**
 * Shared native PostgreSQL pool for application repositories and migrations.
 * Transaction ownership stays explicit so request-scoped authorization filters
 * and multi-table updates cannot accidentally run on separate connections.
 */
export function createDatabasePool(connectionString: string): DatabasePool {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max: 10,
  });

  pool.on("error", () =>
    logOperationalFailure(
      "[database-pool] idle client error",
      "database_idle_client",
    ),
  );

  return Object.assign(pool, {
    async transaction<T>(
      operation: (client: pg.PoolClient) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client
          .query("ROLLBACK")
          .catch(() =>
            logOperationalFailure(
              "[database-pool] rollback failed",
              "database_rollback",
            ),
          );
        throw error;
      } finally {
        client.release();
      }
    },
  });
}
