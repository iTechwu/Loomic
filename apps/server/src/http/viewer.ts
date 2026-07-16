import type { FastifyInstance, FastifyReply } from "fastify";

import {
  applicationErrorResponseSchema,
  profileUpdateRequestSchema,
  profileUpdateResponseSchema,
  unauthenticatedErrorResponseSchema,
  viewerResponseSchema,
} from "@lovart.dofe/shared";

import {
  BootstrapError,
  type ViewerService,
} from "../features/bootstrap/ensure-user-foundation.js";
import type {
  RequestAuthenticator,
} from "../auth/sso-authenticator.js";

export async function registerViewerRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    viewerService: ViewerService;
  },
) {
  app.get("/api/viewer", async (request, reply) => {
    try {
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

      const viewer = await options.viewerService.ensureViewer(user);

      return reply
        .code(200)
        .send(viewerResponseSchema.parse(viewer));
    } catch (error) {
      return sendApplicationError(
        error,
        reply,
        "bootstrap_failed",
        "Unable to prepare viewer workspace.",
      );
    }
  });

  app.patch("/api/viewer/profile", async (request, reply) => {
    try {
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

      const payload = profileUpdateRequestSchema.parse(request.body);
      const data = await options.viewerService.updateProfile(user, payload.displayName);

      return reply.code(200).send(
        profileUpdateResponseSchema.parse({
          profile: {
            id: data.id,
            email: data.email,
            displayName: data.displayName,
            avatarUrl: data.avatarUrl,
          },
        }),
      );
    } catch (error) {
      if (isZodError(error)) {
        return reply.code(400).send({
          issues: error.issues,
          message: "Invalid request body",
        });
      }

      return sendApplicationError(
        error,
        reply,
        "application_error",
        "Internal server error.",
      );
    }
  });
}

function isZodError(
  error: unknown,
): error is { issues: unknown[]; name: string } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  );
}

function sendApplicationError(
  error: unknown,
  reply: FastifyReply,
  fallbackCode: "application_error" | "bootstrap_failed",
  fallbackMessage: string,
) {
  if (error instanceof BootstrapError) {
    return reply.code(error.statusCode).send(
      applicationErrorResponseSchema.parse({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
    );
  }

  return reply.code(500).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: fallbackCode,
        message: fallbackMessage,
      },
    }),
  );
}
