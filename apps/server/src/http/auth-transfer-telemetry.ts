import type { FastifyInstance } from "fastify";
import { z } from "zod";

const authTransferEventSchema = z
  .object({
    durationMsBucket: z.enum(["lt_1s", "1_to_5s", "5_to_10s", "over_10s"]),
    entryPoint: z.enum(["callback", "workspace"]),
    flowId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
    state: z.enum([
      "authorized",
      "callback_invalid",
      "cancelled",
      "checking",
      "exchange_failed",
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
export async function registerAuthTransferTelemetryRoute(app: FastifyInstance) {
  app.post("/api/telemetry/auth-transfer", async (request, reply) => {
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
  });
}
