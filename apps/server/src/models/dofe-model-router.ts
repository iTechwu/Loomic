import type { ServerEnv } from "../config/env.js";

const DEFAULT_CACHE_TTL_MS = 60_000;

export type DofeModelProtocol = "anthropic" | "gemini" | "openai";

export type DofeRouterModel = {
  id: string;
  ownedBy?: string;
  modelType?: string;
};

type OpenAIModelListResponse = {
  data?: Array<{ id?: unknown; owned_by?: unknown }>;
};

type ModelCapabilitiesResponse = {
  model_type?: unknown;
};

type FetchLike = typeof fetch;
export type DofeModelCatalog = {
  listChatModels(): Promise<DofeRouterModel[]>;
  listImageModels(): Promise<DofeRouterModel[]>;
  listVideoModels(): Promise<DofeRouterModel[]>;
};

export function hasDofeModelRouter(
  env: Pick<ServerEnv, "dofeModelApiKey" | "dofeModelBaseUrl">,
): env is Pick<Required<ServerEnv>, "dofeModelApiKey" | "dofeModelBaseUrl"> {
  return !!env.dofeModelApiKey && !!env.dofeModelBaseUrl;
}

/**
 * The gateway catalog is the only model-id authority. `/v1/models` supplies
 * the API-key-scoped aliases and the capability endpoint classifies each one,
 * including asynchronous image and video models.
 */
export function createDofeModelCatalog(
  env: Pick<ServerEnv, "dofeModelApiKey" | "dofeModelBaseUrl">,
  options: { cacheTtlMs?: number; fetch?: FetchLike; now?: () => number } = {},
): DofeModelCatalog | undefined {
  if (!hasDofeModelRouter(env)) return undefined;

  const baseUrl = env.dofeModelBaseUrl;
  const apiKey = env.dofeModelApiKey;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  let cache: { models: DofeRouterModel[]; expiresAt: number } | undefined;
  let pending: Promise<DofeRouterModel[]> | undefined;

  async function refresh() {
    const response = await fetchFn(`${dofeModelProtocolBaseUrl(baseUrl, "openai")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`DoFe model catalog request failed with HTTP ${response.status}`);
    }

    const payload = await response.json() as OpenAIModelListResponse;
    if (!Array.isArray(payload.data)) {
      throw new Error("DoFe model catalog response did not contain a model list");
    }

    const aliases = payload.data
      .flatMap((entry): Array<{ id: string; ownedBy?: string }> => {
        if (typeof entry.id !== "string") return [];
        return [{
          id: entry.id,
          ...(typeof entry.owned_by === "string" ? { ownedBy: entry.owned_by } : {}),
        }];
      });
    const models = (await Promise.all(aliases.map(async (entry): Promise<DofeRouterModel> => {
      const capabilityResponse = await fetchFn(
        `${dofeModelProtocolBaseUrl(baseUrl, "openai")}/models/${encodeURIComponent(entry.id)}/capabilities`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!capabilityResponse.ok) {
        throw new Error(`DoFe capability request failed for ${entry.id} with HTTP ${capabilityResponse.status}`);
      }
      const capability = await capabilityResponse.json() as ModelCapabilitiesResponse;
      return {
        ...entry,
        ...(typeof capability.model_type === "string" ? { modelType: capability.model_type } : {}),
      };
    })))
      .sort((left, right) => left.id.localeCompare(right.id));

    cache = { models, expiresAt: now() + cacheTtlMs };
    console.info("[model-router] catalog_refreshed", {
      endpoint: baseUrl,
      modelCount: models.length,
    });
    return models;
  }

  return {
    async listChatModels() {
      const models = await getModels();
      return models.filter((model) => model.modelType !== "image" && model.modelType !== "video");
    },
    async listImageModels() {
      return (await getModels()).filter((model) => model.modelType === "image");
    },
    async listVideoModels() {
      return (await getModels()).filter((model) => model.modelType === "video");
    },
  };

  async function getModels() {
      if (cache && cache.expiresAt > now()) return cache.models;
      if (pending) return pending;

      pending = refresh().catch((error: unknown) => {
        if (cache) {
          console.warn("[model-router] catalog_refresh_failed_using_stale_cache", {
            endpoint: baseUrl,
            error: error instanceof Error ? error.message : String(error),
          });
          return cache.models;
        }
        throw error;
      }).finally(() => {
        pending = undefined;
      });
      return pending;
  }
}

export function resolveDofeModelProtocol(modelId: string): DofeModelProtocol {
  if (modelId.startsWith("gemini-")) return "gemini";
  if (modelId.startsWith("claude-")) return "anthropic";
  return "openai";
}

/** Returns the native data-plane base required by each client SDK. */
export function dofeModelProtocolBaseUrl(
  baseUrl: string,
  protocol: DofeModelProtocol,
): string {
  switch (protocol) {
    case "anthropic":
      return `${baseUrl}/anthropic`;
    case "gemini":
      return `${baseUrl}/gemini`;
    case "openai":
      return `${baseUrl}/v1`;
  }
}

/** @deprecated Use `DofeModelCatalog` model types from the gateway instead. */
export function isChatModelAlias(modelId: string): boolean {
  return !/(?:^|[-_/])(imagen|image|seedream|seedance|veo|sora|kling|wan|hailuo)(?:[-_/]|$)/i.test(modelId);
}

/**
 * Existing workspace preferences use provider prefixes. Once the gateway is
 * enabled they become aliases, letting the gateway own routing and protocol
 * selection instead of silently bypassing it with direct vendor credentials.
 */
export function toDofeRouterModelId(specifier: string): string {
  const separator = specifier.indexOf(":");
  if (separator <= 0) return specifier;

  const provider = specifier.slice(0, separator);
  if (provider === "dofe" || provider === "openai" || provider === "google" || provider === "anthropic") {
    return specifier.slice(separator + 1);
  }
  return specifier;
}
