import type { BackgroundJob, BackgroundJobStatus, BackgroundJobType } from "@lovart.dofe/shared";

import type { NativeJobRepository, JobRow } from "../../database/job-repository.js";
import type { RabbitMqClient } from "../../queue/rabbitmq-client.js";
import type { AuthenticatedUser } from "../../auth/sso-authenticator.js";
import { logOperationalFailure } from "../../utils/operational-log.js";

const QUEUE_MAP: Record<BackgroundJobType, string> = { image_generation: "image_generation_jobs", video_generation: "video_generation_jobs" };

export class JobServiceError extends Error {
  constructor(readonly code: "job_not_found" | "job_create_failed" | "job_query_failed" | "job_cancel_failed", message: string, readonly statusCode: number) { super(message); }
}

export type CreateJobInput = { workspaceId: string; projectId?: string; canvasId?: string; sessionId?: string; threadId?: string; jobType: BackgroundJobType; payload: Record<string, unknown> };
export type JobService = {
  createJob(user: AuthenticatedUser, input: CreateJobInput): Promise<BackgroundJob>;
  getJob(user: AuthenticatedUser, jobId: string): Promise<BackgroundJob>;
  listJobs(user: AuthenticatedUser, filters?: { status?: BackgroundJobStatus; jobType?: BackgroundJobType }): Promise<BackgroundJob[]>;
  cancelJob(user: AuthenticatedUser, jobId: string): Promise<BackgroundJob>;
  getJobAdmin(jobId: string): Promise<BackgroundJob>;
  markRunning(jobId: string): Promise<void>; markSucceeded(jobId: string, result: Record<string, unknown>): Promise<void>;
  markFailed(jobId: string, errorCode: string, errorMessage: string): Promise<void>; markDeadLetter(jobId: string, errorCode: string, errorMessage: string): Promise<void>;
  incrementAttempt(jobId: string): Promise<{ attempt_count: number; max_attempts: number }>;
};

export function createJobService(options: { repository: NativeJobRepository; rabbitMq: RabbitMqClient }): JobService {
  return {
    async createJob(user, input) {
      const queueName = QUEUE_MAP[input.jobType];
      const job = await options.repository.create({ ...input, createdBy: user.id, queueName });
      if (!job) throw new JobServiceError("job_create_failed", "Failed to create job record.", 500);
      try { await options.rabbitMq.publish(queueName, { job_id: job.id, job_type: job.job_type, workspace_id: job.workspace_id, ...(job.canvas_id ? { canvas_id: job.canvas_id } : {}), ...(job.session_id ? { session_id: job.session_id } : {}) }); }
      catch {
        await options.repository.delete(job.id);
        logOperationalFailure(
          "[job-service] RabbitMQ publish failed",
          "job_queue_publish",
        );
        throw new JobServiceError("job_create_failed", "Failed to enqueue job.", 500);
      }
      return mapJob(job);
    },
    async getJob(user, jobId) { const job = await options.repository.findForUser(user.id, jobId); if (!job) throw notFound(); return mapJob(job); },
    async listJobs(user, filters) { return (await options.repository.listForUser(user.id, filters)).map(mapJob); },
    async cancelJob(user, jobId) { const job = await options.repository.cancel(user.id, jobId); if (!job) throw new JobServiceError("job_not_found", "Job not found or already completed.", 404); return mapJob(job); },
    async getJobAdmin(jobId) { const job = await options.repository.find(jobId); if (!job) throw notFound(); return mapJob(job); },
    async markRunning(jobId) { await options.repository.markRunning(jobId); }, async markSucceeded(jobId, result) { await options.repository.markSucceeded(jobId, result); },
    async markFailed(jobId, code, message) { await options.repository.markFailed(jobId, code, message); }, async markDeadLetter(jobId, code, message) { await options.repository.markDeadLetter(jobId, code, message); },
    async incrementAttempt(jobId) { return (await options.repository.incrementAttempt(jobId)) ?? { attempt_count: 1, max_attempts: 3 }; },
  };
}
function notFound() { return new JobServiceError("job_not_found", "Job not found.", 404); }
function mapJob(row: JobRow): BackgroundJob { return { ...row, canceled_at: iso(row.canceled_at), completed_at: iso(row.completed_at), created_at: row.created_at.toISOString(), failed_at: iso(row.failed_at), started_at: iso(row.started_at), updated_at: row.updated_at.toISOString() }; }
function iso(value: Date | null) { return value?.toISOString() ?? null; }
