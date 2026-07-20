import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { CredentialsNotProvisionedError } from "../features/credentials/credentials-service.js";
import { registerGenerateRoutes } from "./generate.js";

const USER_ID = "00000000-0000-4000-8000-000000000010";

describe("generation credential readiness", () => {
  it.each([
    ["/api/agent/generate-image", { prompt: "an image" }],
    ["/api/agent/generate-video", { prompt: "a video" }],
  ])(
    "returns 424 before attempting %s when tenant credentials are unavailable",
    async (url, body) => {
      const app = Fastify();
      const createJob = vi.fn();
      await registerGenerateRoutes(app, {
        auth: {
          authenticate: vi.fn(async () => ({ id: USER_ID })),
        } as never,
        credentialsService: {
          getByUserId: vi.fn(async () => {
            throw new CredentialsNotProvisionedError(USER_ID);
          }),
        } as never,
        jobService: { createJob } as never,
        uploadService: {} as never,
        viewerService: {
          ensureViewer: vi.fn(async () => ({
            workspace: { id: "00000000-0000-4000-8000-000000000020" },
          })),
        } as never,
      });

      try {
        const response = await app.inject({
          method: "POST",
          url,
          payload: body,
        });

        expect(response.statusCode).toBe(424);
        expect(response.json()).toMatchObject({
          error: { code: "credentials_not_provisioned" },
        });
        expect(createJob).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );
});
