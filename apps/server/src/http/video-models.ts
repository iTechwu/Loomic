import { unauthenticatedErrorResponseSchema } from "@lovart.dofe/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { RequestAuthenticator } from "../auth/sso-authenticator.js";
import { getAvailableVideoModels } from "../generation/providers/registry.js";

export async function registerVideoModelRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
  },
) {
  app.get("/api/video-models", async (request, reply) => {
    if (!(await options.auth.authenticate(request))) {
      return sendUnauthorized(reply);
    }
    const models = getAvailableVideoModels();

    const annotated = models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      description: m.description,
      iconUrl: m.iconUrl,
      provider: m.provider,
    }));

    return reply.code(200).send({ models: annotated });
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
