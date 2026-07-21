/**
 * Gateway default model aliases — the single source of truth shared by the
 * server (HTTP routes, worker executors, agent tools) and the web client
 * (canvas generator, model preferences).
 *
 * These MUST be valid aliases in the ixicai.cn `/v1/models` catalog. The
 * server validates them against the live catalog at boot
 * (`runDefaultModelsBootSmoke`): warn by default, fatal when
 * `LOVART_STRICT_DEFAULT_MODELS=true`. The gateway is the sole model-id
 * authority — Lovart does not maintain a second executable catalog.
 */
export const DEFAULT_CHAT_MODEL = "glm-5.2";
export const DEFAULT_IMAGE_MODEL = "flux-kontext-pro";
export const DEFAULT_VIDEO_MODEL = "seedance-2.0";
