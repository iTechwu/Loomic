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
 * disk for reference/rollback but are no longer registered — every supported
 * model id must exist in DOFE_IMAGE_MODELS / DOFE_VIDEO_MODELS.
 */
import type { ServerEnv } from "../../config/env.js";
import { DofeImageProvider, DofeVideoProvider } from "./dofe-generation.js";
import { registerImageProvider, registerVideoProvider } from "./registry.js";

export function registerAllProviders(env: ServerEnv): void {
  // DoFe gateway is the sole image/video data plane. Credentials are per-user
  // (injected via params.auth at generate() time), so registration only needs
  // the gateway base URL — no shared API-key gate.
  if (env.dofeModelBaseUrl) {
    registerImageProvider(new DofeImageProvider(env.dofeModelBaseUrl));
    registerVideoProvider(new DofeVideoProvider(env.dofeModelBaseUrl));
  }
}
