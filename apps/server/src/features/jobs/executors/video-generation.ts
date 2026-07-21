import { DEFAULT_VIDEO_MODEL } from "@lovart.dofe/shared";
import { registerExecutor, type ExecutorContext } from "../job-executor.js";
import { generateVideo } from "../../../generation/video-generation.js";
import { resolveVideoProviderName } from "../../../generation/providers/registry.js";
import { persistGeneratedAsset } from "../../assets/generated-asset-persister.js";

registerExecutor("video_generation", async (jobId, _rawPayload, ctx: ExecutorContext) => {
  const t0 = Date.now();

  const jobRow = await ctx.jobRepository.find(jobId);

  if (!jobRow) throw new Error(`Job ${jobId} not found in database`);

  // Build log tag with traceability context: jobId + sessionId (if available)
  const sessionShort = (jobRow.session_id as string)?.slice(0, 8) ?? "no-session";
  const tag = `[video-job:${jobId.slice(0, 8)} session:${sessionShort}]`;
  const lap = (label: string, extra?: Record<string, unknown>) =>
    console.log(
      `${tag} ${label} +${Date.now() - t0}ms`,
      extra ? JSON.stringify(extra) : "",
    );
  lap("db_fetch");

  const payload = (jobRow.payload ?? {}) as {
    prompt: string;
    model?: string;
    duration?: number;
    resolution?: string;
    aspect_ratio?: string;
    input_images?: string[];
    input_video?: string;
    enable_audio?: boolean;
  };

  if (!payload.prompt) throw new Error(`Job ${jobId} has no prompt in payload`);

  const createdBy: string | null = jobRow.created_by ?? null;
  const workspaceId: string = jobRow.workspace_id ?? jobId;

  const model = payload.model ?? DEFAULT_VIDEO_MODEL;
  const providerName = resolveVideoProviderName(model);

  // Resolve the job owner's DoFe credentials (strict no-fallback).
  if (!createdBy) throw new Error(`Job ${jobId} has no creator`);
  const credentials = ctx.credentialsService
    ? await ctx.credentialsService.getByUserId(createdBy)
    : undefined;
  const auth = credentials
    ? {
        designApiKey: credentials.designApiKey,
        seedanceAccessKeyId: credentials.seedanceAccessKeyId,
        seedanceSecretAccessKey: credentials.seedanceSecretAccessKey,
      }
    : undefined;

  try {
    lap("dofe_call_start");
    const generated = await generateVideo(providerName, {
      prompt: payload.prompt,
      model,
      ...(auth ? { auth } : {}),
      ...(payload.duration != null ? { duration: payload.duration } : {}),
      ...(payload.resolution ? { resolution: payload.resolution as "480p" | "720p" | "1080p" } : {}),
      ...(payload.aspect_ratio ? { aspectRatio: payload.aspect_ratio } : {}),
      ...(payload.input_images?.length ? { inputImages: payload.input_images } : {}),
      ...(payload.input_video ? { inputVideo: payload.input_video } : {}),
      ...(payload.enable_audio != null ? { enableAudio: payload.enable_audio } : {}),
    });
    lap("dofe_call_done");

    // Persist the generated asset into dofe-system, reusing the provider key
    // when the URL is already a TOS dofe-system object.
    const tosEndpoint = ctx.env.tos?.endpoint;
    if (!tosEndpoint) {
      throw new Error(
        `TOS endpoint is not configured; cannot persist generated video`,
      );
    }

    const persisted = await persistGeneratedAsset({
      sourceUrl: generated.url,
      mimeType: generated.mimeType ?? "video/mp4",
      userId: createdBy,
      workspaceId,
      ...(jobRow.project_id ? { projectId: jobRow.project_id } : {}),
      dataRepository: ctx.dataRepository,
      objectStorage: ctx.objectStorage,
      tosEndpoint,
    });

    lap("asset_record_done", {
      bucket: persisted.bucket,
      objectPath: persisted.objectPath,
    });

    lap("total");
    return {
      asset_id: persisted.assetId,
      signed_url: persisted.signedUrl,
      object_path: persisted.objectPath,
      width: generated.width,
      height: generated.height,
      duration_seconds: generated.durationSeconds,
      mime_type: generated.mimeType ?? "video/mp4",
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`Video generation failed for model ${model}: ${detail}`);
    // Preserve the original error code so the worker can distinguish
    // non-retryable errors (e.g. invalid_input) from transient failures.
    (wrapped as Error & { code?: string }).code =
      (err as { code?: string })?.code ?? "executor_error";
    throw wrapped;
  } finally {}
});
