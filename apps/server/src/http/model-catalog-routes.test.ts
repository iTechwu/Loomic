import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerImageProvider,
  registerVideoProvider,
} from "../generation/providers/registry.js";
import { clearProviders } from "../generation/providers/registry.js";
import { registerImageModelRoutes } from "./image-models.js";
import { registerVideoModelRoutes } from "./video-models.js";

afterEach(() => {
  clearProviders();
});

describe("model catalog routes", () => {
  it("rejects unauthenticated callers before reading either catalog", async () => {
    const app = Fastify();
    const authenticate = vi.fn(async () => null);
    await registerImageModelRoutes(app, { auth: { authenticate } });
    await registerVideoModelRoutes(app, { auth: { authenticate } });

    try {
      const [image, video] = await Promise.all([
        app.inject({ method: "GET", url: "/api/image-models" }),
        app.inject({ method: "GET", url: "/api/video-models" }),
      ]);

      expect(image.statusCode).toBe(401);
      expect(video.statusCode).toBe(401);
      expect(image.json()).toEqual({
        error: {
          code: "unauthorized",
          message: "Missing or invalid bearer token.",
        },
      });
      expect(authenticate).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it("returns the authenticated server-side catalog projection without credentials", async () => {
    registerImageProvider({
      name: "dofe",
      models: [
        {
          id: "image-authorized",
          displayName: "Image Authorized",
          description: "catalog projection",
        },
      ],
    } as never);
    registerVideoProvider({
      name: "dofe",
      models: [
        {
          id: "video-authorized",
          displayName: "Video Authorized",
          description: "catalog projection",
          capabilities: {
            textToVideo: true,
            imageToVideo: false,
            videoToVideo: false,
            audio: false,
          },
        },
      ],
    } as never);
    const app = Fastify();
    await registerImageModelRoutes(app, {
      auth: { authenticate: vi.fn(async () => ({ id: "user-1" })) } as never,
    });
    await registerVideoModelRoutes(app, {
      auth: { authenticate: vi.fn(async () => ({ id: "user-1" })) } as never,
    });

    try {
      const [image, video] = await Promise.all([
        app.inject({
          headers: { authorization: "Bearer session-token" },
          method: "GET",
          url: "/api/image-models",
        }),
        app.inject({
          headers: { authorization: "Bearer session-token" },
          method: "GET",
          url: "/api/video-models",
        }),
      ]);

      expect(image.statusCode).toBe(200);
      expect(video.statusCode).toBe(200);
      expect(image.json()).toEqual({
        models: [
          {
            id: "image-authorized",
            displayName: "Image Authorized",
            description: "catalog projection",
            provider: "dofe",
          },
        ],
      });
      expect(video.json()).toEqual({
        models: [
          {
            id: "video-authorized",
            displayName: "Video Authorized",
            description: "catalog projection",
            provider: "dofe",
          },
        ],
      });
      expect(JSON.stringify([image.json(), video.json()])).not.toContain(
        "session-token",
      );
    } finally {
      await app.close();
    }
  });
});
