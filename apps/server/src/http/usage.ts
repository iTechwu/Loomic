import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  apiKeyUsageStatsQuerySchema,
  applicationErrorResponseSchema,
  tenantUsageLogsQuerySchema,
  tenantUsageStatsQuerySchema,
  unauthenticatedErrorResponseSchema,
  usageLogsQuerySchema,
  usageLogsResponseSchema,
  usageStatsResponseSchema,
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
 * Usage endpoints that proxy models.dofe.ai internal usage data.
 *
 * Authorization note: team/apikey access is proven by the existence of a ready
 * `user_credentials` row. Replace this with a workspace permission service once
 * multi-team RBAC is first-class.
 */
export async function registerUsageRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; billingService?: BillingService | undefined },
) {
  app.get("/api/usage/tenant/stats", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return sendUnauthorized(reply);

    const parseResult = tenantUsageStatsQuerySchema.safeParse(request.query);
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
      const stats = await context.getTenantUsageStats(user, parseResult.data);
      return reply.code(200).send(usageStatsResponseSchema.parse(stats));
    } catch (error) {
      return handleUsageError(error, reply);
    }
  });

  app.get("/api/usage/teams/:teamId/stats", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return sendUnauthorized(reply);

    const params = request.params as { teamId: string };
    const teamIdResult = teamIdParamSchema.safeParse(params.teamId);
    if (!teamIdResult.success) {
      return sendInvalidRequest(reply, "teamId must be a valid UUID");
    }

    const parseResult = apiKeyUsageStatsQuerySchema.safeParse(request.query);
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
      const stats = await context.getTeamUsageStats(
        user,
        teamIdResult.data,
        parseResult.data,
      );
      return reply.code(200).send(usageStatsResponseSchema.parse(stats));
    } catch (error) {
      return handleUsageError(error, reply);
    }
  });

  app.get("/api/usage/bots/:apiKeyId/stats", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return sendUnauthorized(reply);

    const params = request.params as { apiKeyId: string };
    const apiKeyIdResult = apiKeyIdParamSchema.safeParse(params.apiKeyId);
    if (!apiKeyIdResult.success) {
      return sendInvalidRequest(reply, "apiKeyId must be a valid UUID");
    }

    const parseResult = apiKeyUsageStatsQuerySchema.safeParse(request.query);
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
      const stats = await context.getApiKeyUsageStats(
        user,
        apiKeyIdResult.data,
        parseResult.data,
      );
      return reply.code(200).send(usageStatsResponseSchema.parse(stats));
    } catch (error) {
      return handleUsageError(error, reply);
    }
  });

  app.get("/api/usage/logs", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return sendUnauthorized(reply);

    const parseResult = usageLogsQuerySchema.safeParse(request.query);
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
      const logs = await context.getUsageLogs(user, parseResult.data);
      return reply.code(200).send(usageLogsResponseSchema.parse(logs));
    } catch (error) {
      return handleUsageError(error, reply);
    }
  });

  app.get("/api/usage/tenant/logs", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return sendUnauthorized(reply);

    const parseResult = tenantUsageLogsQuerySchema.safeParse(request.query);
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
      const logs = await context.getTenantUsageLogs(user, parseResult.data);
      return reply.code(200).send(usageLogsResponseSchema.parse(logs));
    } catch (error) {
      return handleUsageError(error, reply);
    }
  });
}

const teamIdParamSchema = z.string().uuid();
const apiKeyIdParamSchema = z.string().uuid();

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
    void reply.code(503).send(
      applicationErrorResponseSchema.parse({
        error: {
          code: "application_error",
          message: "Usage service is unavailable.",
        },
      }),
    );
    return null;
  }
  return billingService;
}

function handleUsageError(error: unknown, reply: FastifyReply) {
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
          code: "usage_query_failed",
          message: "Unable to fetch usage data.",
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
