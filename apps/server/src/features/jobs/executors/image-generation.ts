// @credits-system — Image generation executor: applies watermark for free-tier users
import { DEFAULT_IMAGE_MODEL } from "@lovart.dofe/shared";
import { generateImage } from "../../../generation/image-generation.js";
import { resolveImageProviderName } from "../../../generation/providers/registry.js";
import { type ExecutorContext, registerExecutor } from "../job-executor.js";

registerExecutor(
  "image_generation",
  async (jobId, _rawPayload, ctx: ExecutorContext) => {
    const t0 = Date.now();

    // Read the full job row including payload from the database.
    // The RabbitMQ message only contains { job_id, job_type, workspace_id },
    // so we must fetch prompt/model/aspect_ratio from background_jobs.payload.
    const jobRow = await ctx.jobRepository.find(jobId);

    if (!jobRow) throw new Error(`Job ${jobId} not found in database`);

    // Build log tag with traceability context: jobId + sessionId (if available)
    const sessionShort =
      (jobRow.session_id as string)?.slice(0, 8) ?? "no-session";
    const tag = `[image-job:${jobId.slice(0, 8)} session:${sessionShort}]`;
    const lap = (label: string) =>
      console.log(`${tag} ${label} +${Date.now() - t0}ms`);
    lap("db_fetch");

    const payload = (jobRow.payload ?? {}) as {
      prompt: string;
      model?: string;
      aspect_ratio?: string;
      title?: string;
      input_images?: string[];
    };

    if (!payload.prompt)
      throw new Error(`Job ${jobId} has no prompt in payload`);

    const createdBy: string | null = jobRow.created_by ?? null;
    const workspaceId: string = jobRow.workspace_id ?? jobId;

    // Resolve provider dynamically from model ID via registry
    const model = payload.model ?? DEFAULT_IMAGE_MODEL;
    const providerName = resolveImageProviderName(model);

    // Log input image format for debugging the data-URI-passthrough pipeline
    if (payload.input_images?.length) {
      const formats = payload.input_images.map((img) =>
        img.startsWith("data:") ? "data-uri" : "url",
      );
      console.log(
        `${tag} input_images formats: [${formats.join(", ")}] (${formats.length} total)`,
      );
    }

    // Resolve the job owner's DoFe credentials. Strict no-fallback: getByUserId
    // throws CredentialsNotProvisionedError when the user has no ready
    // credentials, which fails this job into the dead-letter queue.
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
      // Generate image via the registered provider
      lap(`${providerName}_call_start`);
      let generated;
      try {
        generated = await generateImage(providerName, {
          prompt: payload.prompt,
          model,
          ...(auth ? { auth } : {}),
          ...(payload.aspect_ratio !== undefined
            ? { aspectRatio: payload.aspect_ratio }
            : {}),
          ...(payload.input_images?.length
            ? { inputImages: payload.input_images }
            : {}),
        });
      } catch (genError) {
        const detail =
          genError instanceof Error ? genError.message : String(genError);
        const wrapped = new Error(
          `Image generation failed for model ${model}: ${detail}`,
        );
        (wrapped as Error & { code?: string }).code =
          (genError as { code?: string })?.code ?? "executor_error";
        throw wrapped;
      }
      lap(`${providerName}_call_done`);

      // Download the generated image from the provider CDN
      const response = await fetch(generated.url);
      if (!response.ok) {
        throw new Error(
          `Failed to download generated image from ${model}: ${response.status} ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer: Buffer = Buffer.from(arrayBuffer);
      lap("image_download_done");

      // Subscription watermarking moves with the credits repository migration.
      // This job path deliberately does not query TOS/CDN for plan state.
      const timestamp = Date.now();
      const objectPath = `generated/${workspaceId}/${timestamp}-${jobId}.png`;
      const uploaded = await ctx.objectStorage.put({
        body: buffer,
        contentType: generated.mimeType ?? "image/png",
        key: objectPath,
      });
      lap("storage_upload_done");

      if (!createdBy) throw new Error(`Job ${jobId} has no creator`);
      const assetRow = await ctx.dataRepository.createAsset({
        bucket: "project-assets",
        byteSize: buffer.length,
        createdBy,
        etag: uploaded.etag,
        mimeType: generated.mimeType ?? "image/png",
        objectPath,
        ...(jobRow.project_id ? { projectId: jobRow.project_id } : {}),
        workspaceId,
      });
      if (!assetRow) throw new Error("Failed to create asset metadata");

      lap("asset_record_done");

      lap("total");
      return {
        asset_id: assetRow.id,
        signed_url: ctx.objectStorage.createReadUrl(objectPath, 3600),
        object_path: objectPath,
        width: generated.width,
        height: generated.height,
        mime_type: generated.mimeType ?? "image/png",
      };
    } finally {
    }
  },
);
