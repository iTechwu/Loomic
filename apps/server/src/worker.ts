import { bootstrap } from "global-agent";
bootstrap();
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import type { BackgroundJobType } from "@lovart.dofe/shared";

import { loadServerEnv } from "./config/env.js";
import { createNativeJobRepository } from "./database/job-repository.js";
import { createNativeDataRepository } from "./database/native-data-repository.js";
import { createDatabasePool } from "./database/pool.js";
import { createUserCredentialsRepository } from "./features/credentials/credentials-repository.js";
import {
  type CredentialsService,
  createCredentialsService,
} from "./features/credentials/credentials-service.js";
import { createCredentialCrypto } from "./features/credentials/crypto.js";
import { checkInternalApiSecretSmoke } from "./features/credentials/models-client.js";
import {
  type ExecutorContext,
  getExecutor,
} from "./features/jobs/job-executor.js";
import { createJobService } from "./features/jobs/job-service.js";
import { registerAllProviders } from "./generation/providers/register-all.js";
import { runDefaultModelsBootSmoke } from "./models/default-model-smoke.js";
import { createRabbitMqClient } from "./queue/rabbitmq-client.js";
import { createConfiguredTosObjectStorage } from "./storage/tos-object-storage.js";
import {
  logOperationalFailure,
  logOperationalInfo,
  logOperationalWarning,
} from "./utils/operational-log.js";
import "./features/jobs/executors/image-generation.js";
import "./features/jobs/executors/video-generation.js";

const QUEUES = ["image_generation_jobs", "video_generation_jobs"] as const;
const QUEUE_TO_TYPE: Record<string, BackgroundJobType> = {
  image_generation_jobs: "image_generation",
  video_generation_jobs: "video_generation",
};

async function main() {
  const env = loadServerEnv();
  if (!env.databaseUrl || !env.rabbitMqUrl || !env.tos)
    throw new Error(
      "DATABASE_URL, RABBITMQ_URL, and complete TOS_* configuration are required for the worker.",
    );

  // Same contract as the API server: a 401 means the shared INTERNAL_API_SECRET
  // is wrong. Non-fatal (warn) by default so an unreachable models never wedges
  // the worker; set LOVART_STRICT_INTERNAL_SECRET_SMOKE=true in production to
  // make a 401 fatal.
  const strictSecretSmoke =
    process.env.LOVART_STRICT_INTERNAL_SECRET_SMOKE === "true";
  if (env.internalApiSecret && env.dofeModelBaseUrl) {
    const smoke = await checkInternalApiSecretSmoke({
      baseUrl: env.dofeModelBaseUrl,
      serviceName: env.lovartModelsServiceName ?? "lovart.dofe.ai",
      internalApiSecret: env.internalApiSecret,
    });
    if (!smoke.ok && smoke.status === 401) {
      const message =
        "INTERNAL_API_SECRET rejected by models (HTTP 401). Rotate to a fresh value matching models.dofe.ai.";
      if (strictSecretSmoke) {
        throw new Error(message);
      }
      logOperationalWarning(
        `[worker] ${message} (non-fatal; set LOVART_STRICT_INTERNAL_SECRET_SMOKE=true to block boot)`,
        "worker_internal_api_secret_smoke_401",
      );
    } else if (!smoke.ok) {
      logOperationalWarning(
        `[worker] INTERNAL_API_SECRET smoke check did not return 200 (status=${smoke.status}); continuing because models may be temporarily unreachable.`,
        "worker_internal_api_secret_smoke_unreachable",
      );
    }
  }

  registerAllProviders(env);

  // Same default-model contract as the API server: warn on a miss by default,
  // fatal when LOVART_STRICT_DEFAULT_MODELS=true.
  await runDefaultModelsBootSmoke(env);

  const pool = createDatabasePool(env.databaseUrl);
  // Per-user models credential resolver — workers resolve the job owner's key
  // (background_jobs.created_by) before each generation call. Provisioning
  // itself runs on the API server (OIDC/ensureViewer); the worker only reads.
  const credentialCrypto = createCredentialCrypto(
    env.lovartCredentialEncryptionKey,
  );
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
  let stopping = false;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    logOperationalInfo("[worker] shutting down", "worker_shutdown");
    await rabbitMq.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.all(
    QUEUES.map(async (queue) => {
      const prefetch =
        queue === "image_generation_jobs"
          ? (env.workerImageConcurrency ?? 3)
          : (env.workerVideoConcurrency ?? 2);
      await rabbitMq.consume(
        queue,
        async ({ payload }) => {
          if (stopping) return;
          await processMessage(queue, payload as Record<string, unknown>, {
            dataRepository,
            env,
            jobRepository,
            jobService,
            objectStorage,
            rabbitMq,
            ...(credentialsService ? { credentialsService } : {}),
          });
        },
        { prefetch },
      );
    }),
  );
  logOperationalInfo("[worker] started", "worker_started");
}

async function processMessage(
  queue: string,
  payload: Record<string, unknown>,
  ctx: ExecutorContext,
) {
  const jobId = typeof payload.job_id === "string" ? payload.job_id : null;
  const jobType =
    (payload.job_type as BackgroundJobType | undefined) ?? QUEUE_TO_TYPE[queue];
  if (!jobId || !jobType) {
    logOperationalFailure(
      "[worker] invalid RabbitMQ payload",
      "worker_message_invalid",
    );
    return;
  }
  const executor = getExecutor(jobType);
  if (!executor) {
    await ctx.jobService.markDeadLetter(
      jobId,
      "no_executor",
      `No executor registered for ${jobType}`,
    );
    return;
  }
  const attempt = await ctx.jobService.incrementAttempt(jobId);
  await ctx.jobService.markRunning(jobId);
  try {
    const result = await executor(jobId, payload, ctx);
    await ctx.jobService.markSucceeded(jobId, result);
    logOperationalInfo("[worker] job succeeded", "worker_job_succeeded");
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "executor_error";
    const message = error instanceof Error ? error.message : String(error);
    const nonRetryable = new Set([
      "invalid_input",
      "model_not_found",
      "provider_not_found",
      "safety_filter",
    ]);
    if (
      attempt.attempt_count >= attempt.max_attempts ||
      nonRetryable.has(code)
    ) {
      await ctx.jobService.markDeadLetter(jobId, code, message);
      logOperationalFailure(
        "[worker] job dead-lettered",
        "worker_job_dead_lettered",
      );
    } else {
      await ctx.jobService.markFailed(jobId, code, message);
      await ctx.rabbitMq.publish(queue, payload);
      logOperationalWarning("[worker] job requeued", "worker_job_requeued");
    }
  }
}

void main().catch(() => {
  logOperationalFailure("[worker] fatal", "worker_fatal");
  process.exit(1);
});
