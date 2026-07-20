import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

import { logOperationalFailure } from "../../utils/operational-log.js";

export const LANGGRAPH_PERSISTENCE_SCHEMA = "langgraph";

const DEFAULT_POOL_MAX = 3;

export async function createPostgresCheckpointer(options: {
  connectionString: string;
  poolMax?: number;
}) {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max: options.poolMax ?? DEFAULT_POOL_MAX,
  });
  pool.on("error", () =>
    logOperationalFailure(
      "[agent-checkpointer] idle PostgreSQL client error",
      "agent_checkpointer_idle_client",
    ),
  );
  const checkpointer = new PostgresSaver(pool, undefined, {
    schema: LANGGRAPH_PERSISTENCE_SCHEMA,
  });
  await checkpointer.setup();
  return checkpointer;
}
