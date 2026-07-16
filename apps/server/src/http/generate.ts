import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  applicationErrorResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@lovart.dofe/shared";

import { generateImage } from "../generation/image-generation.js";
import { resolveImageProviderName } from "../generation/providers/registry.js";
import type { JobService } from "../features/jobs/job-service.js";
import { JobServiceError } from "../features/jobs/job-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { UploadService } from "../features/uploads/upload-service.js";
import type { AuthenticatedUser, RequestAuthenticator } from "../auth/sso-authenticator.js";

const generateImageRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  quality: z.enum(["standard", "hd", "ultra"]).optional(),
});

const generateVideoRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  duration: z.number().int().min(3).max(16).optional(),
  resolution: z.enum(["720p", "1080p", "4k"]).optional(),
  aspectRatio: z.enum(["16:9", "9:16"]).optional(),
  inputImages: z.array(z.string()).max(3).optional(),
});

export async function registerGenerateRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    jobService?: JobService;
    uploadService: UploadService;
    viewerService: ViewerService;
  },
) {
  app.post("/api/agent/generate-image", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) {
      return reply.code(401).send(
        unauthenticatedErrorResponseSchema.parse({
          error: {
            code: "unauthorized",
            message: "Missing or invalid bearer token.",
          },
        }),
      );
    }

    let payload: z.infer<typeof generateImageRequestSchema>;
    try {
      payload = generateImageRequestSchema.parse(request.body);
    } catch {
      return reply.code(400).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "invalid_request",
            message: "Invalid request body.",
          },
        }),
      );
    }

    const model = payload.model ?? "black-forest-labs/flux-kontext-pro";

    try {
      const providerName = resolveImageProviderName(model);
      const result = await generateImage(providerName, {
        prompt: payload.prompt,
        model,
        aspectRatio: payload.aspectRatio ?? "1:1",
        ...(payload.quality ? { quality: payload.quality } : {}),
      });

      // Download and persist to TOS/CDN Storage
      const { signedUrl, assetId } = await downloadAndUpload(
        result.url,
        result.mimeType,
        payload.prompt,
        user,
        options,
      );

      return reply.code(200).send({
        url: signedUrl,
        assetId,
        prompt: payload.prompt,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Image generation failed.";

      if (message.includes("No provider registered")) {
        return reply.code(400).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "provider_not_configured",
              message: "Image generation is not available.",
            },
          }),
        );
      }

      return reply.code(502).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "generation_failed",
            message,
          },
        }),
      );
    }
  });

  // ── POST /api/agent/generate-video ──────────────────────────
  app.post("/api/agent/generate-video", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) {
      return reply.code(401).send(
        unauthenticatedErrorResponseSchema.parse({
          error: {
            code: "unauthorized",
            message: "Missing or invalid bearer token.",
          },
        }),
      );
    }

    let payload: z.infer<typeof generateVideoRequestSchema>;
    try {
      payload = generateVideoRequestSchema.parse(request.body);
    } catch {
      return reply.code(400).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "invalid_request",
            message: "Invalid request body.",
          },
        }),
      );
    }

    if (!options.jobService) {
      return reply.code(503).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "service_unavailable",
            message: "Video generation is not available (job service not configured).",
          },
        }),
      );
    }

    const model = payload.model ?? "google-official/veo-3.1-generate-preview";

    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const workspaceId = viewer.workspace.id;

      // ── Create job ──
      const job = await options.jobService.createJob(user, {
        workspaceId,
        jobType: "video_generation",
        payload: {
          prompt: payload.prompt,
          model,
          ...(payload.duration != null ? { duration: payload.duration } : {}),
          ...(payload.resolution ? { resolution: payload.resolution } : {}),
          ...(payload.aspectRatio
            ? { aspect_ratio: payload.aspectRatio }
            : {}),
          ...(payload.inputImages?.length
            ? { input_images: payload.inputImages }
            : {}),
        },
      });

      // ── Poll until terminal state ──
      const POLL_INTERVAL = 3_000;
      const MAX_WAIT = 300_000; // 5 minutes

      const result = await pollJobUntilDone(
        options.jobService,
        job.id,
        POLL_INTERVAL,
        MAX_WAIT,
      );

      if ("error" in result) {
        return reply.code(502).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "generation_failed",
              message: result.error,
            },
          }),
        );
      }

      return reply.code(200).send({
        url: result.signed_url,
        assetId: result.asset_id,
        prompt: payload.prompt,
        mimeType: result.mime_type,
        width: result.width,
        height: result.height,
        durationSeconds: result.duration_seconds,
      });
    } catch (error) {
      if (error instanceof JobServiceError) {
        return reply.code(error.statusCode).send(
          applicationErrorResponseSchema.parse({
            error: { code: error.code, message: error.message },
          }),
        );
      }

      const message =
        error instanceof Error ? error.message : "Video generation failed.";

      return reply.code(502).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "generation_failed",
            message,
          },
        }),
      );
    }
  });
}

// ── Job polling helper ──────────────────────────────────────

type VideoJobResult = {
  signed_url: string;
  asset_id: string;
  width: number;
  height: number;
  duration_seconds: number;
  mime_type: string;
};

type PollResult = VideoJobResult | { error: string };

async function pollJobUntilDone(
  jobService: JobService,
  jobId: string,
  pollInterval: number,
  maxWait: number,
): Promise<PollResult> {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await delay(pollInterval);

    const current = await jobService.getJobAdmin(jobId);

    if (current.status === "succeeded" && current.result) {
      const r = current.result as Record<string, unknown>;
      return {
        signed_url: (r.signed_url as string) ?? "",
        asset_id: (r.asset_id as string) ?? "",
        width: (r.width as number) ?? 0,
        height: (r.height as number) ?? 0,
        duration_seconds: (r.duration_seconds as number) ?? 0,
        mime_type: (r.mime_type as string) ?? "video/mp4",
      };
    }

    if (current.status === "dead_letter" || current.status === "canceled") {
      return { error: current.error_message ?? `Job ${current.status}` };
    }

    if (
      current.status === "failed" &&
      current.attempt_count >= current.max_attempts
    ) {
      return {
        error: current.error_message ?? "Job failed after max retries",
      };
    }
  }

  return { error: `Job timed out after ${maxWait / 1000}s` };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Image download + upload helper ──────────────────────────

async function downloadAndUpload(
  sourceUrl: string,
  mimeType: string,
  prompt: string,
  user: AuthenticatedUser,
  deps: { uploadService: UploadService; viewerService: ViewerService },
): Promise<{ signedUrl: string; assetId: string }> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download generated image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const ext = mimeType === "image/webp" ? "webp" : "png";
  const slug = prompt.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileName = `gen-${slug}-${Date.now()}.${ext}`;

  const viewer = await deps.viewerService.ensureViewer(user);

  const result = await deps.uploadService.uploadFile(user, {
    bucket: "project-assets",
    fileName,
    fileBuffer: buffer,
    mimeType,
    workspaceId: viewer.workspace.id,
  });

  return { signedUrl: result.url, assetId: result.asset.id };
}
