import type {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";

import type { ServerEnv } from "../../config/env.js";
import { createPostgresCheckpointer } from "./postgres-checkpointer.js";
import { createPostgresStore } from "./postgres-store.js";

export type AgentPersistence = {
  checkpointer: BaseCheckpointSaver;
  store: BaseStore;
};

export type AgentPersistenceService = {
  getPersistence(): Promise<AgentPersistence | null>;
};

export function createAgentPersistenceService(
  env: Pick<ServerEnv, "databaseUrl">,
  overrides?: {
    createCheckpointer?: typeof createPostgresCheckpointer;
    createStore?: typeof createPostgresStore;
  },
): AgentPersistenceService {
  let pendingPersistence: Promise<AgentPersistence> | null = null;

  return {
    async getPersistence() {
      if (!env.databaseUrl) {
        return null;
      }
      const databaseUrl = env.databaseUrl;

      if (!pendingPersistence) {
        pendingPersistence = (async () => {
          // Both LangGraph adapters initialize the shared schema. Running their
          // setup methods concurrently races on PostgreSQL's schema creation.
          const checkpointer = await (
            overrides?.createCheckpointer ?? createPostgresCheckpointer
          )({
            connectionString: databaseUrl,
          });
          const store = await (overrides?.createStore ?? createPostgresStore)({
            connectionString: databaseUrl,
          });
          return { checkpointer, store };
        })().catch((error) => {
          pendingPersistence = null;
          throw error;
        });
      }

      return pendingPersistence;
    },
  };
}
