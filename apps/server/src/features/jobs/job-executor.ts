import type { BackgroundJobType } from "@lovart.dofe/shared";

import type { JobService } from "./job-service.js";
import type { ServerEnv } from "../../config/env.js";
import type { NativeDataRepository } from "../../database/native-data-repository.js";
import type { NativeJobRepository } from "../../database/job-repository.js";
import type { RabbitMqClient } from "../../queue/rabbitmq-client.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";
import type { CredentialsService } from "../credentials/credentials-service.js";

export type ExecutorContext = {
  jobService: JobService;
  jobRepository: NativeJobRepository;
  dataRepository: NativeDataRepository;
  rabbitMq: RabbitMqClient;
  objectStorage: TosObjectStorage;
  env: ServerEnv;
  /**
   * Per-user models credential resolver. When set, executors resolve the job
   * owner's credentials and pass them to the provider so generation runs under
   * that user's DoFe key (strict per-user isolation).
   */
  credentialsService?: CredentialsService;
};

export type JobExecutor = (
  jobId: string,
  payload: Record<string, unknown>,
  ctx: ExecutorContext,
) => Promise<Record<string, unknown>>;

const executors = new Map<BackgroundJobType, JobExecutor>();

export function registerExecutor(jobType: BackgroundJobType, executor: JobExecutor): void {
  executors.set(jobType, executor);
}

export function getExecutor(jobType: BackgroundJobType): JobExecutor | undefined {
  return executors.get(jobType);
}
