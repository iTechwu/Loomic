import type { BackgroundJobStatus, BackgroundJobType } from "@lovart.dofe/shared";
import type { QueryResultRow } from "pg";

import type { DatabasePool } from "./pool.js";

export type JobRow = {
  attempt_count: number; canceled_at: Date | null; canvas_id: string | null; completed_at: Date | null;
  created_at: Date; created_by: string;
  error_code: string | null; error_message: string | null; failed_at: Date | null; id: string;
  job_type: BackgroundJobType; max_attempts: number; payload: Record<string, unknown>; project_id: string | null;
  queue_name: string; result: Record<string, unknown> | null; session_id: string | null; started_at: Date | null;
  status: BackgroundJobStatus; thread_id: string | null; updated_at: Date; workspace_id: string;
};

const COLUMNS = `id, workspace_id, project_id, canvas_id, session_id, thread_id, queue_name, job_type,
  status, payload, result, error_code, error_message, attempt_count, max_attempts, created_by, created_at,
  updated_at, started_at, completed_at, failed_at, canceled_at`;

export type NativeJobRepository = {
  cancel(userId: string, jobId: string): Promise<JobRow | null>;
  countActive(workspaceId: string): Promise<number>;
  create(input: { canvasId?: string; createdBy: string; jobType: BackgroundJobType; payload: Record<string, unknown>; projectId?: string; queueName: string; sessionId?: string; threadId?: string; workspaceId: string }): Promise<JobRow | null>;
  delete(jobId: string): Promise<void>;
  find(jobId: string): Promise<JobRow | null>;
  findForUser(userId: string, jobId: string): Promise<JobRow | null>;
  incrementAttempt(jobId: string): Promise<{ attempt_count: number; max_attempts: number } | null>;
  listForUser(userId: string, filters?: { status?: BackgroundJobStatus; jobType?: BackgroundJobType }): Promise<JobRow[]>;
  markDeadLetter(jobId: string, code: string, message: string): Promise<void>;
  markFailed(jobId: string, code: string, message: string): Promise<void>;
  markRunning(jobId: string): Promise<void>;
  markSucceeded(jobId: string, result: Record<string, unknown>): Promise<void>;
};

export function createNativeJobRepository(pool: DatabasePool): NativeJobRepository {
  return {
    async create(input) {
      const result = await pool.query<JobRow>(
        `insert into background_jobs (workspace_id, project_id, canvas_id, session_id, thread_id, queue_name, job_type, payload, created_by)
         select $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9
         where exists (select 1 from workspace_members where workspace_id = $1 and user_id = $9)
         returning ${COLUMNS}`,
        [input.workspaceId, input.projectId ?? null, input.canvasId ?? null, input.sessionId ?? null, input.threadId ?? null, input.queueName, input.jobType, JSON.stringify(input.payload), input.createdBy],
      );
      return result.rows[0] ?? null;
    },
    async countActive(workspaceId) {
      const result = await pool.query<{ count: string }>("select count(*)::text as count from background_jobs where workspace_id = $1 and status in ('queued', 'running')", [workspaceId]);
      return Number(result.rows[0]?.count ?? 0);
    },
    async delete(jobId) { await pool.query("delete from background_jobs where id = $1", [jobId]); },
    async find(jobId) { return first(pool, `select ${COLUMNS} from background_jobs where id = $1`, [jobId]); },
    async findForUser(userId, jobId) { return first(pool, `select ${COLUMNS} from background_jobs where id = $2 and created_by = $1`, [userId, jobId]); },
    async listForUser(userId, filters) {
      const values: unknown[] = [userId]; const predicates = ["created_by = $1"];
      if (filters?.status) { values.push(filters.status); predicates.push(`status = $${values.length}`); }
      if (filters?.jobType) { values.push(filters.jobType); predicates.push(`job_type = $${values.length}`); }
      const result = await pool.query<JobRow>(`select ${COLUMNS} from background_jobs where ${predicates.join(" and ")} order by created_at desc limit 50`, values);
      return result.rows;
    },
    async cancel(userId, jobId) { return first(pool, `update background_jobs set status = 'canceled', canceled_at = now() where id = $2 and created_by = $1 and status in ('queued', 'running') returning ${COLUMNS}`, [userId, jobId]); },
    async incrementAttempt(jobId) { return first(pool, "update background_jobs set attempt_count = attempt_count + 1 where id = $1 returning attempt_count, max_attempts", [jobId]); },
    async markRunning(jobId) { await pool.query("update background_jobs set status = 'running', started_at = now() where id = $1 and status = 'queued'", [jobId]); },
    async markSucceeded(jobId, result) { await pool.query("update background_jobs set status = 'succeeded', result = $2::jsonb, completed_at = now() where id = $1", [jobId, JSON.stringify(result)]); },
    async markFailed(jobId, code, message) { await pool.query("update background_jobs set status = 'failed', error_code = $2, error_message = $3, failed_at = now() where id = $1", [jobId, code, message]); },
    async markDeadLetter(jobId, code, message) { await pool.query("update background_jobs set status = 'dead_letter', error_code = $2, error_message = $3, failed_at = now() where id = $1", [jobId, code, message]); },
  };
}

async function first<T extends QueryResultRow>(pool: DatabasePool, text: string, values: unknown[]): Promise<T | null> {
  const result = await pool.query<T>(text, values);
  return result.rows[0] ?? null;
}
