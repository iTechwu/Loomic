import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";

import { LANGGRAPH_PERSISTENCE_SCHEMA } from "./postgres-checkpointer.js";

const DEFAULT_POOL_MAX = 3;

export async function createPostgresStore(options: {
  connectionString: string;
  poolMax?: number;
}) {
  const store = new PostgresStore({
    connectionOptions: {
      connectionString: options.connectionString,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      max: options.poolMax ?? DEFAULT_POOL_MAX,
    },
    schema: LANGGRAPH_PERSISTENCE_SCHEMA,
  });
  await store.setup();
  return store;
}
