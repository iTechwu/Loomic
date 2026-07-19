import { bootstrap } from "global-agent";
bootstrap();
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { randomUUID } from "node:crypto";
import type { BackgroundJobType } from "@lovart.dofe/shared";

import { loadServerEnv } from "./config/env.js";
import { createDatabasePool } from "./database/pool.js";
import { createNativeDataRepository } from "./database/native-data-repository.js";
import { createNativeJobRepository } from "./database/job-repository.js";
import { createRabbitMqClient } from "./queue/rabbitmq-client.js";
import { createConfiguredTosObjectStorage } from "./storage/tos-object-storage.js";
import { createJobService } from "./features/jobs/job-service.js";
import { getExecutor, type ExecutorContext } from "./features/jobs/job-executor.js";
import { registerAllProviders } from "./generation/providers/register-all.js";
import { createCredentialCrypto } from "./features/credentials/crypto.js";
import {
  createCredentialsService,
  type CredentialsService,
} from "./features/credentials/credentials-service.js";
import { createUserCredentialsRepository } from "./features/credentials/credentials-repository.js";
import "./features/jobs/executors/image-generation.js";
import "./features/jobs/executors/video-generation.js";

const QUEUES = ["image_generation_jobs", "video_generation_jobs"] as const;
const QUEUE_TO_TYPE: Record<string, BackgroundJobType> = { image_generation_jobs: "image_generation", video_generation_jobs: "video_generation" };

async function main() {
  const env = loadServerEnv();
  if (!env.databaseUrl || !env.rabbitMqUrl || !env.tos) throw new Error("DATABASE_URL, RABBITMQ_URL, and complete TOS_* configuration are required for the worker.");
  registerAllProviders(env);

  const pool = createDatabasePool(env.databaseUrl);
  // Per-user models credential resolver — workers resolve the job owner's key
  // (background_jobs.created_by) before each generation call. Provisioning
  // itself runs on the API server (OIDC/ensureViewer); the worker only reads.
  const credentialCrypto = createCredentialCrypto(env.lovartCredentialEncryptionKey);
  const credentialsService: CredentialsService | undefined =
    credentialCrypto.enabled && env.internalApiSecret && env.dofeModelBaseUrl
      ? createCredentialsService({
          repository: createUserCredentialsRepository(pool),
          crypto: credentialCrypto,
          provisionConfig: {
            baseUrl: env.dofeModelBaseUrl,
            serviceName: env.lovartModelsServiceName ?? "lovart.dofe.ai",
            internalApiSecret: env.internalApiSecret,
          },
        })
      : undefined;
  const dataRepository = createNativeDataRepository(pool);
  const jobRepository = createNativeJobRepository(pool);
  const rabbitMq = createRabbitMqClient(env.rabbitMqUrl);
  const objectStorage = createConfiguredTosObjectStorage(env.tos);
  const jobService = createJobService({ repository: jobRepository, rabbitMq });
  const tag = `[worker:${env.workerId ?? randomUUID().slice(0, 8)}]`;
  let stopping = false;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log(`${tag} shutting down`);
    await rabbitMq.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);

  await Promise.all(QUEUES.map(async (queue) => {
    const prefetch = queue === "image_generation_jobs" ? env.workerImageConcurrency ?? 3 : env.workerVideoConcurrency ?? 2;
    await rabbitMq.consume(queue, async ({ payload }) => {
      if (stopping) return;
      await processMessage(queue, payload as Record<string, unknown>, { dataRepository, env, jobRepository, jobService, objectStorage, rabbitMq, ...(credentialsService ? { credentialsService } : {}) }, tag);
    }, { prefetch });
  }));
  console.log(`${tag} started`, { queues: QUEUES });
}

async function processMessage(queue: string, payload: Record<string, unknown>, ctx: ExecutorContext, tag: string) {
  const jobId = typeof payload.job_id === "string" ? payload.job_id : null;
  const jobType = (payload.job_type as BackgroundJobType | undefined) ?? QUEUE_TO_TYPE[queue];
  if (!jobId || !jobType) { console.error(`${tag} invalid RabbitMQ payload`, payload); return; }
  const executor = getExecutor(jobType);
  if (!executor) { await ctx.jobService.markDeadLetter(jobId, "no_executor", `No executor registered for ${jobType}`); return; }
  const attempt = await ctx.jobService.incrementAttempt(jobId);
  await ctx.jobService.markRunning(jobId);
  try {
    const result = await executor(jobId, payload, ctx);
    await ctx.jobService.markSucceeded(jobId, result);
    console.log(`${tag} job succeeded`, { jobId, jobType });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "executor_error";
    const message = error instanceof Error ? error.message : String(error);
    const nonRetryable = new Set(["invalid_input", "model_not_found", "provider_not_found", "safety_filter"]);
    if (attempt.attempt_count >= attempt.max_attempts || nonRetryable.has(code)) {
      await ctx.jobService.markDeadLetter(jobId, code, message);
      console.error(`${tag} job dead-lettered`, { attempt: attempt.attempt_count, jobId, code });
    } else {
      await ctx.jobService.markFailed(jobId, code, message);
      await ctx.rabbitMq.publish(queue, payload);
      console.warn(`${tag} job requeued`, { attempt: attempt.attempt_count, jobId, code });
    }
  }
}

void main().catch((error: unknown) => { console.error("[worker] fatal", { message: error instanceof Error ? error.message : String(error) }); process.exit(1); });
