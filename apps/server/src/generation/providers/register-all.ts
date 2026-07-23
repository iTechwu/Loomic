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

const CATALOG_SYNC_RETRY_MS = 30_000;

export function toCatalogVideoModelInfo(
  model: DofeRouterModel,
): VideoModelInfo {
  const capabilities = new Set(model.capabilities ?? []);
  const capabilityMetadata = model.capabilityMetadata;
  const audioSupported = Object.values(capabilityMetadata ?? {}).some(
    (metadata) => metadata.supportsGenerateAudio === true,
  );
  return {
    id: model.id,
    displayName: model.id,
    description: "Video generation via ixicai.cn",
    capabilities: {
      textToVideo: capabilities.has("text_to_video"),
      imageToVideo: capabilities.has("image_to_video"),
      videoToVideo: capabilities.has("video_to_video"),
      audio: audioSupported,
    },
    ...(capabilityMetadata ? { capabilityMetadata } : {}),
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
    if (!catalog) return;

    const syncCatalog = async () => {
      try {
        const [imageModels, videoModels] = await Promise.all([
          catalog.listImageModels(),
          catalog.listVideoModels(),
        ]);
        imageProvider.setModels(
          imageModels.map((model) => ({
            id: model.id,
            displayName: model.id,
            description: "Image generation via ixicai.cn",
          })),
        );
        videoProvider.setModels(videoModels.map(toCatalogVideoModelInfo));
        console.info("[model-router] generation_catalog_synced", {
          imageModelCount: imageModels.length,
          videoModelCount: videoModels.length,
        });
      } catch {
        logOperationalFailure(
          "[model-router] generation catalog sync failed; retry scheduled",
          "model_catalog_generation_sync",
        );
      } finally {
        // The provider registry is synchronous, while the Models catalog is
        // network-backed. Keep it fresh and recover from a transient startup
        // failure so the model picker cannot remain empty for process lifetime.
        setTimeout(() => void syncCatalog(), CATALOG_SYNC_RETRY_MS).unref();
      }
    };

    void syncCatalog();
  }
}
