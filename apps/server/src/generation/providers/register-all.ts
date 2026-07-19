/**
 * Centralized provider registration.
 *
 * Both the HTTP server (app.ts) and the background worker (worker.ts) need the
 * same set of image/video generation providers. This module is the single
 * source of truth so that adding a new provider only requires a change here.
 *
 * Image and video generation now flows exclusively through the DoFe (ixicai.cn)
 * gateway, with per-user credentials injected at call time (params.auth). The
 * legacy Replicate/Google/OpenAI/Volces provider source files are retained on
 * disk for reference/rollback but are no longer registered. The ixicai
 * catalog is the sole model-id authority.
 */
import type { ServerEnv } from "../../config/env.js";
import { createDofeModelCatalog } from "../../models/dofe-model-router.js";
import { DofeImageProvider, DofeVideoProvider } from "./dofe-generation.js";
import { registerImageProvider, registerVideoProvider } from "./registry.js";

export function registerAllProviders(env: ServerEnv): void {
  // DoFe gateway is the sole image/video data plane. Credentials are per-user
  // (injected via params.auth at generate() time), so registration only needs
  // the gateway base URL — no shared API-key gate.
  if (env.dofeModelBaseUrl) {
    const imageProvider = new DofeImageProvider(env.dofeModelBaseUrl);
    const videoProvider = new DofeVideoProvider(env.dofeModelBaseUrl);
    registerImageProvider(imageProvider);
    registerVideoProvider(videoProvider);

    const catalog = createDofeModelCatalog(env);
    void catalog?.listImageModels().then((models) => {
      imageProvider.setModels(models.map((model) => ({
        id: model.id,
        displayName: model.id,
        description: "Image generation via ixicai.cn",
      })));
    }).catch((error: unknown) => {
      console.error("[model-router] image_catalog_sync_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    void catalog?.listVideoModels().then((models) => {
      videoProvider.setModels(models.map((model) => ({
        id: model.id,
        displayName: model.id,
        description: "Video generation via ixicai.cn",
        capabilities: {
          textToVideo: true,
          imageToVideo: true,
          videoToVideo: false,
          audio: false,
        },
        limits: { maxDuration: 16, maxResolution: "1080p", maxInputImages: 3 },
      })));
    }).catch((error: unknown) => {
      console.error("[model-router] video_catalog_sync_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
