import type { FastifyInstance } from "fastify";
import { getAvailableImageModels } from "../generation/providers/registry.js";
import type { RequestAuthenticator } from "../supabase/user.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

export async function registerImageModelRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    viewerService: ViewerService;
  },
) {
  app.get("/api/image-models", async (request, reply) => {
    const models = getAvailableImageModels();

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
