import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  applicationErrorResponseSchema,
  billingBalanceResponseSchema,
  pricingCalculateRequestSchema,
  pricingCalculateResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@lovart.dofe/shared";

import type { RequestAuthenticator } from "../auth/sso-authenticator.js";
import {
  BillingServiceError,
  type BillingService,
} from "../features/billing/billing-service.js";
import {
  ModelsInternalClientError,
  type Logger,
} from "../features/models-internal/models-internal-client.js";

/**
 * Billing/pricing endpoints that proxy models.dofe.ai internal data.
 *
 * Authorization note: team access is proven by the existence of a ready
 * `user_credentials` row. Replace this with a workspace permission service once
 * multi-team RBAC is first-class.
 */
export async function registerBillingRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; billingService?: BillingService | undefined },
) {
  app.get("/api/billing/tenant/balance", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return sendUnauthorized(reply);

    const service = resolveBillingService(options.billingService, reply);
    if (!service) return reply;

    const context = service.forRequest(
      correlationId(request),
      fastifyLogger(request.log),
    );

    try {
      const balance = await context.getTenantBalance(user);
      return reply.code(200).send(billingBalanceResponseSchema.parse(balance));
    } catch (error) {
      return handleBillingError(error, reply, "billing_query_failed");
    }
  });

  app.get("/api/billing/teams/:teamId/balance", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return sendUnauthorized(reply);

    const params = request.params as { teamId: string };
    const teamIdResult = teamIdParamSchema.safeParse(params.teamId);
    if (!teamIdResult.success) {
      return sendInvalidRequest(reply, "teamId must be a valid UUID");
    }

    const service = resolveBillingService(options.billingService, reply);
    if (!service) return reply;

    const context = service.forRequest(
      correlationId(request),
      fastifyLogger(request.log),
    );

    try {
      const balance = await context.getTeamBalance(user, teamIdResult.data);
      return reply.code(200).send(billingBalanceResponseSchema.parse(balance));
    } catch (error) {
      return handleBillingError(error, reply, "billing_query_failed");
    }
  });

  app.get("/api/pricing/calculate", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return sendUnauthorized(reply);

    const parseResult = pricingCalculateRequestSchema.safeParse(request.query);
    if (!parseResult.success) {
      return sendInvalidRequest(reply, parseResult.error.message);
    }

    const service = resolveBillingService(options.billingService, reply);
    if (!service) return reply;

    const context = service.forRequest(
      correlationId(request),
      fastifyLogger(request.log),
    );

    try {
      const price = await context.calculatePrice(user, parseResult.data);
      return reply
        .code(200)
        .send(pricingCalculateResponseSchema.parse(price));
    } catch (error) {
      return handleBillingError(error, reply, "pricing_query_failed");
    }
  });
}

const teamIdParamSchema = z.string().uuid();

function correlationId(request: FastifyRequest): string {
  const header = request.headers["x-correlation-id"];
  if (typeof header === "string" && header.trim()) return header;
  return request.id;
}

function fastifyLogger(log: FastifyRequest["log"]): Logger {
  return {
    info: (message, data) => log.info(data ?? {}, message),
    warn: (message, data) => log.warn(data ?? {}, message),
    error: (message, data) => log.error(data ?? {}, message),
  };
}

function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send(
    unauthenticatedErrorResponseSchema.parse({
      error: {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
      },
    }),
  );
}

function sendInvalidRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: "application_error",
        message,
      },
    }),
  );
}

function resolveBillingService(
  billingService: BillingService | undefined,
  reply: FastifyReply,
): BillingService | null {
  if (!billingService) {
    reply.code(503).send(
      applicationErrorResponseSchema.parse({
        error: {
          code: "application_error",
          message: "Billing service is unavailable.",
        },
      }),
    );
    return null;
  }
  return billingService;
}

function handleBillingError(
  error: unknown,
  reply: FastifyReply,
  code:
    | "billing_query_failed"
    | "pricing_query_failed",
) {
  if (error instanceof BillingServiceError && error.code === "forbidden") {
    return reply.code(403).send(
      applicationErrorResponseSchema.parse({
        error: {
          code: "forbidden",
          message: error.message,
        },
      }),
    );
  }

  if (error instanceof ModelsInternalClientError) {
    const status = error.status === 0 ? 504 : error.status >= 500 ? 502 : error.status;
    return reply.code(status).send(
      applicationErrorResponseSchema.parse({
        error: {
          code,
          message: "Unable to fetch billing data.",
        },
      }),
    );
  }

  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: "application_error",
        message: "Internal server error.",
      },
    }),
  );
}
