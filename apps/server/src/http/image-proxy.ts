import { applicationErrorResponseSchema } from "@lovart.dofe/shared";
import type { FastifyInstance } from "fastify";
import type { TosConfig } from "../storage/tos-config.js";

/**
 * Proxy endpoint for fetching external images server-side, bypassing browser CORS restrictions.
 * Used by the frontend to load generated images into Excalidraw canvas.
 */
export function registerImageProxyRoute(
  app: FastifyInstance,
  options: { tos?: TosConfig } = {},
) {
  // Generated provider URLs only; product assets use TOS signed URLs directly.
  const staticAllowed = [
    "replicate.delivery",
    "replicate.com",
    "pbxt.replicate.delivery",
  ];

  // Lovart stores generated assets in the DoFe system bucket. The canvas fetches
  // them through this proxy, so the bucket domains must be allowed.
  const tosDomains: string[] = [];
  if (options.tos?.bucketDomain) {
    tosDomains.push(hostnameOf(options.tos.bucketDomain));
  }
  if (options.tos?.internalBucketDomain) {
    tosDomains.push(hostnameOf(options.tos.internalBucketDomain));
  }
  const systemBucketDomain = deriveSystemBucketDomain(options.tos);
  if (systemBucketDomain) {
    tosDomains.push(systemBucketDomain);
  }

  const allowed = [...staticAllowed, ...tosDomains];

  app.get<{
    Querystring: { url: string };
  }>("/api/proxy-image", async (request, reply) => {
    const { url } = request.query;

    if (!url || typeof url !== "string") {
      return reply.status(400).send(
        applicationErrorResponseSchema.parse({
          error: { code: "invalid_request", message: "Missing url parameter" },
        }),
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return reply.status(400).send(
        applicationErrorResponseSchema.parse({
          error: { code: "invalid_request", message: "Invalid URL" },
        }),
      );
    }

    if (!allowed.some((domain) => parsedUrl.hostname.endsWith(domain))) {
      console.warn(
        `[image-proxy] blocked request for ${parsedUrl.hostname}; allowed domains: ${allowed.join(", ")}`,
      );
      return reply.status(403).send(
        applicationErrorResponseSchema.parse({
          error: { code: "forbidden", message: "Domain not allowed" },
        }),
      );
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(
          `[image-proxy] upstream fetch failed for ${parsedUrl.hostname}: ${response.status} ${response.statusText}`,
        );
        return reply.status(response.status).send(
          applicationErrorResponseSchema.parse({
            error: {
              code: "generation_failed",
              message: `Upstream fetch failed: ${response.status} ${response.statusText}`,
            },
          }),
        );
      }

      const contentType =
        response.headers.get("content-type") ?? "application/octet-stream";
      const buffer = Buffer.from(await response.arrayBuffer());

      return reply
        .header("content-type", contentType)
        .header("cache-control", "public, max-age=86400")
        .send(buffer);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(
        `[image-proxy] failed to fetch ${parsedUrl.hostname}: ${detail}`,
      );
      return reply.status(502).send(
        applicationErrorResponseSchema.parse({
          error: {
            code: "generation_failed",
            message: "Failed to fetch image",
          },
        }),
      );
    }
  });
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
}

function deriveSystemBucketDomain(tos?: TosConfig): string | null {
  if (!tos) return null;
  if (tos.systemBucketDomain) return hostnameOf(tos.systemBucketDomain);
  const host = hostnameOf(tos.endpoint);
  const bucket = tos.systemBucket ?? "dofe-system";
  return `${bucket}.${host}`;
}
