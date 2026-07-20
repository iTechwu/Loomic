import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";

const AUTH_TRANSFER_EVENTS_PER_MINUTE = 30;

const authTransferEventSchema = z
  .object({
    durationMsBucket: z.enum(["lt_1s", "1_to_5s", "5_to_10s", "over_10s"]),
    entryPoint: z.enum(["callback", "public", "workspace"]),
    flowId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
    state: z.enum([
      "authorized",
      "callback_invalid",
      "cancelled",
      "checking",
      "exchange_failed",
      "intent_started",
      "service_unavailable",
      "timeout",
      "viewer_bootstrap_failed",
    ]),
  })
  .strict();

/**
 * Accepts only non-identifying auth-transition measurements. The event is
 * deliberately unauthenticated because callback failures occur before a
 * Lovart session exists; the strict schema prevents it becoming a log sink.
 */
export type AuthTransferTelemetryOptions = {
  /** Shared across API instances when REDIS_URL is configured. */
  redis?: Redis;
};

/**
 * A configured Redis limiter is part of the production telemetry boundary.
 * Fail Fastify readiness when it cannot be reached instead of accepting
 * traffic that would later fail only for a subset of callback events.
 */
export function registerAuthTransferTelemetryReadiness(
  app: FastifyInstance,
  redis: Pick<Redis, "ping"> | undefined,
) {
  if (!redis) return;

  app.addHook("onReady", async () => {
    await redis.ping();
    app.log.info("auth_transfer_telemetry_redis_ready");
  });
}

export async function registerAuthTransferTelemetryRoute(
  app: FastifyInstance,
  options: AuthTransferTelemetryOptions = {},
) {
  // The compose deployment exposes Fastify only behind Nginx, so X-Real-IP is
  // trustworthy there. Direct development keeps Fastify's socket-derived IP.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => {
      const realIp = request.headers["x-real-ip"];
      return typeof realIp === "string" && realIp ? realIp : request.ip;
    },
    ...(options.redis
      ? {
          nameSpace: "lovart-auth-transfer-",
          redis: options.redis,
          // Do not permit a Redis outage to turn this anonymous endpoint into
          // an unbounded log sink. The request fails until the limiter recovers.
          skipOnError: false,
        }
      : {}),
  });

  app.log.info(
    { rateLimitStore: options.redis ? "redis" : "memory" },
    "auth_transfer_telemetry_rate_limit_configured",
  );

  app.post(
    "/api/telemetry/auth-transfer",
    {
      config: {
        rateLimit: {
          errorResponseBuilder: (_request, context) => ({
            error: "telemetry_rate_limited",
            statusCode: context.statusCode,
          }),
          max: AUTH_TRANSFER_EVENTS_PER_MINUTE,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const event = authTransferEventSchema.safeParse(request.body);
      if (!event.success) {
        request.log.warn(
          { failureCategory: "invalid_auth_transfer_event" },
          "auth_transfer_telemetry_rejected",
        );
        return reply.code(400).send({ error: "invalid_telemetry_event" });
      }

      request.log.info(
        { requestId: request.id, ...event.data },
        "auth_transfer_viewed",
      );
      return reply.code(204).send();
    },
  );
}
