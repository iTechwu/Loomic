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
import {
  type DofeRouterModel,
  createDofeModelCatalog,
} from "../../models/dofe-model-router.js";
import { logOperationalFailure } from "../../utils/operational-log.js";
import type { VideoModelInfo } from "../types.js";
import { DofeImageProvider, DofeVideoProvider } from "./dofe-generation.js";
import { registerImageProvider, registerVideoProvider } from "./registry.js";

export function toCatalogVideoModelInfo(
  model: DofeRouterModel,
): VideoModelInfo {
  const capabilities = new Set(model.capabilities ?? []);
  return {
    id: model.id,
    displayName: model.id,
    description: "Video generation via ixicai.cn",
    capabilities: {
      textToVideo: capabilities.has("text_to_video"),
      imageToVideo: capabilities.has("image_to_video"),
      videoToVideo: capabilities.has("video_to_video"),
      // The public catalog response does not project provider audio metadata.
      // Keep the control disabled until models exposes an explicit capability.
      audio: false,
    },
  };
}

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
    void catalog
      ?.listImageModels()
      .then((models) => {
        imageProvider.setModels(
          models.map((model) => ({
            id: model.id,
            displayName: model.id,
            description: "Image generation via ixicai.cn",
          })),
        );
      })
      .catch(() => {
        logOperationalFailure(
          "[model-router] image catalog sync failed",
          "model_catalog_image_sync",
        );
      });
    void catalog
      ?.listVideoModels()
      .then((models) => {
        videoProvider.setModels(models.map(toCatalogVideoModelInfo));
      })
      .catch(() => {
        logOperationalFailure(
          "[model-router] video catalog sync failed",
          "model_catalog_video_sync",
        );
      });
  }
}
