import type { FastifyInstance, FastifyReply } from "fastify";

import {
  modelListResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@lovart.dofe/shared";
import type { RequestAuthenticator } from "../auth/sso-authenticator.js";
import type { ServerEnv } from "../config/env.js";
import { createDofeModelCatalog } from "../models/dofe-model-router.js";

export async function registerModelRoutes(
  app: FastifyInstance,
  options: { auth: RequestAuthenticator; env: ServerEnv },
) {
  const dofeCatalog = createDofeModelCatalog(options.env);

  app.get("/api/models", async (request, reply) => {
    if (!(await options.auth.authenticate(request)))
      return sendUnauthorized(reply);
    if (!dofeCatalog) {
      // The ixicai gateway is the sole model-id authority; Lovart does not keep
      // a fallback catalog. An empty list + warn surfaces the misconfiguration
      // instead of advertising fabricated model names.
      app.log.warn(
        "Chat model catalog is empty: DOFE_MODEL_BASE_URL/DOFE_MODEL_API_KEY are not configured.",
      );
      return reply
        .code(200)
        .send(modelListResponseSchema.parse({ models: [] }));
    }
    try {
      const models = await dofeCatalog.listChatModels();
      return reply.code(200).send(
        modelListResponseSchema.parse({
          models: models.map((model) => ({
            id: `dofe:${model.id}`,
            name: model.id,
            provider: "dofe",
          })),
        }),
      );
    } catch (error) {
      app.log.error(error, "DoFe model router catalog is unavailable");
      return reply.code(503).send({
        error: "Model router catalog is temporarily unavailable.",
      });
    }
  });
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
