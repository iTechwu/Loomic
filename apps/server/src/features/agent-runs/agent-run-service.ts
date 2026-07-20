import type { DatabasePool } from "../../database/pool.js";
import { logOperationalFailure } from "../../utils/operational-log.js";
import type {
  CreateAcceptedAgentRunInput,
  UpdateAgentRunInput,
} from "./types.js";

export class AgentRunPersistenceError extends Error {
  readonly statusCode: number;
  readonly code: "application_error";

  constructor(message: string, statusCode = 500) {
    super(message);
    this.code = "application_error";
    this.statusCode = statusCode;
  }
}

export type AgentRunMetadataService = {
  createAcceptedRun(input: CreateAcceptedAgentRunInput): Promise<void>;
  updateRun(input: UpdateAgentRunInput): Promise<void>;
};

export function createAgentRunMetadataService(options: {
  pool: DatabasePool;
}): AgentRunMetadataService {
  return {
    async createAcceptedRun(input) {
      try {
        await options.pool.query(
          `insert into agent_runs (id, model, session_id, status, thread_id)
           values ($1, $2, $3, 'accepted', $4)`,
          [input.runId, input.model ?? null, input.sessionId, input.threadId],
        );
      } catch {
        logOperationalFailure(
          "[agent-run-metadata] create failed",
          "agent_run_metadata_create",
        );
        throw new AgentRunPersistenceError("Failed to persist accepted run.");
      }
    },

    async updateRun(input) {
      try {
        await options.pool.query(
          `update agent_runs set status = $2, completed_at = coalesce($3::timestamptz, completed_at),
             error_code = coalesce($4, error_code), error_message = coalesce($5, error_message)
           where id = $1`,
          [
            input.runId,
            input.status,
            input.completedAt ?? null,
            input.errorCode ?? null,
            input.errorMessage ?? null,
          ],
        );
      } catch {
        logOperationalFailure(
          "[agent-run-metadata] update failed",
          "agent_run_metadata_update",
        );
        throw new AgentRunPersistenceError("Failed to update run metadata.");
      }
    },
  };
}
