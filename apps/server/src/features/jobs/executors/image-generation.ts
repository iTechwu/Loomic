// @credits-system — Image generation executor: applies watermark for free-tier users
import { DEFAULT_IMAGE_MODEL } from "@lovart.dofe/shared";
import { generateImage } from "../../../generation/image-generation.js";
import { resolveImageProviderName } from "../../../generation/providers/registry.js";
import type { GeneratedImage } from "../../../generation/types.js";
import { persistGeneratedAsset } from "../../assets/generated-asset-persister.js";
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
    const lap = (label: string, extra?: Record<string, unknown>) =>
      console.log(
        `${tag} ${label} +${Date.now() - t0}ms`,
        extra ? JSON.stringify(extra) : "",
      );
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
      let generated: GeneratedImage;
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
      // Validate the provider URL before logging or downloading. Malformed URLs
      // such as "dofe-system.https://..." produce confusing DNS errors otherwise.
      let imageUrl: URL;
      try {
        imageUrl = new URL(generated.url);
      } catch {
        throw new Error(
          `Generated image URL for model ${model} is not a valid absolute URL: ${generated.url.slice(0, 200)}`,
        );
      }
      if (imageUrl.protocol !== "https:" && imageUrl.protocol !== "http:") {
        throw new Error(
          `Generated image URL for model ${model} uses unsupported protocol ${imageUrl.protocol}`,
        );
      }

      lap(`${providerName}_call_done`, {
        urlHost: imageUrl.hostname,
        urlPathPrefix: imageUrl.pathname.slice(0, 40),
        urlHasSignature: imageUrl.search.length > 0,
        mimeType: generated.mimeType,
        width: generated.width,
        height: generated.height,
      });

      // Persist the generated asset. When the provider already returned a TOS
      // URL in the dofe-system bucket we simply record the key; otherwise we
      // download and upload into dofe-system.
      const tosEndpoint = ctx.env.tos?.endpoint;
      if (!tosEndpoint) {
        throw new Error(
          `TOS endpoint is not configured; cannot persist generated image`,
        );
      }

      const persisted = await persistGeneratedAsset({
        sourceUrl: generated.url,
        mimeType: generated.mimeType ?? "image/png",
        userId: createdBy,
        workspaceId,
        ...(jobRow.project_id ? { projectId: jobRow.project_id } : {}),
        dataRepository: ctx.dataRepository,
        objectStorage: ctx.objectStorage,
        tosEndpoint,
        title: payload.title,
      });

      lap("asset_record_done", {
        bucket: persisted.bucket,
        objectPath: persisted.objectPath,
        reusedProviderKey: imageUrl.hostname.startsWith("dofe-system."),
      });

      lap("total");
      return {
        asset_id: persisted.assetId,
        signed_url: persisted.signedUrl,
        object_path: persisted.objectPath,
        width: generated.width,
        height: generated.height,
        mime_type: generated.mimeType ?? "image/png",
      };
    } catch (executorError) {
      const detail =
        executorError instanceof Error
          ? executorError.message
          : String(executorError);
      console.error(`${tag} executor failed after provider call`, {
        error: detail,
        model,
        provider: providerName,
      });
      throw executorError;
    } finally {
    }
  },
);
