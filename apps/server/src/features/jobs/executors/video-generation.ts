import { registerExecutor, type ExecutorContext } from "../job-executor.js";
import { generateVideo } from "../../../generation/video-generation.js";
import { resolveVideoProviderName } from "../../../generation/providers/registry.js";

registerExecutor("video_generation", async (jobId, _rawPayload, ctx: ExecutorContext) => {
  const t0 = Date.now();

  const jobRow = await ctx.jobRepository.find(jobId);

  if (!jobRow) throw new Error(`Job ${jobId} not found in database`);

  // Build log tag with traceability context: jobId + sessionId (if available)
  const sessionShort = (jobRow.session_id as string)?.slice(0, 8) ?? "no-session";
  const tag = `[video-job:${jobId.slice(0, 8)} session:${sessionShort}]`;
  const lap = (label: string) => console.log(`${tag} ${label} +${Date.now() - t0}ms`);
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

  const model = payload.model ?? "wan-video/wan-2.6";
  const providerName = resolveVideoProviderName(model);

  try {
    lap("replicate_call_start");
    const generated = await generateVideo(providerName, {
      prompt: payload.prompt,
      model,
      ...(payload.duration != null ? { duration: payload.duration } : {}),
      ...(payload.resolution ? { resolution: payload.resolution as "480p" | "720p" | "1080p" } : {}),
      ...(payload.aspect_ratio ? { aspectRatio: payload.aspect_ratio } : {}),
      ...(payload.input_images?.length ? { inputImages: payload.input_images } : {}),
      ...(payload.input_video ? { inputVideo: payload.input_video } : {}),
      ...(payload.enable_audio != null ? { enableAudio: payload.enable_audio } : {}),
    });
    lap("replicate_call_done");

    // Vertex AI returns inline base64 data URIs; Developer API returns HTTP URLs.
    let buffer: Buffer;
    if (generated.url.startsWith("data:")) {
      const commaIdx = generated.url.indexOf(",");
      if (commaIdx === -1) throw new Error("Invalid data URI: no comma separator");
      buffer = Buffer.from(generated.url.slice(commaIdx + 1), "base64");
    } else {
      const response = await fetch(generated.url);
      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }
    lap("video_download_done");

    const ext = generated.mimeType === "video/webm" ? "webm" : "mp4";
    const timestamp = Date.now();
    const objectPath = `generated/${workspaceId}/${timestamp}-${jobId}.${ext}`;
    const uploaded = await ctx.objectStorage.put({ body: buffer, contentType: generated.mimeType ?? "video/mp4", key: objectPath });
    lap("storage_upload_done");

    if (!createdBy) throw new Error(`Job ${jobId} has no creator`);
    const assetRow = await ctx.dataRepository.createAsset({ bucket: "project-assets", byteSize: buffer.length, createdBy, etag: uploaded.etag, mimeType: generated.mimeType ?? "video/mp4", objectPath, ...(jobRow.project_id ? { projectId: jobRow.project_id } : {}), workspaceId });
    if (!assetRow) throw new Error("Failed to create asset metadata");
    lap("asset_record_done");

    lap("total");
    return {
      asset_id: assetRow.id,
      signed_url: ctx.objectStorage.createReadUrl(objectPath, 3600),
      object_path: objectPath,
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
