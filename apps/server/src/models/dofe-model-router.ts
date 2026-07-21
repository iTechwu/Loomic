import type { ServerEnv } from "../config/env.js";
import { logOperationalWarning } from "../utils/operational-log.js";

const DEFAULT_CACHE_TTL_MS = 60_000;
const CHAT_MODEL_TYPES = new Set(["llm", "text"]);

export type DofeModelProtocol = "anthropic" | "gemini" | "openai";

/** Public, generation-relevant subset of Models capabilityMetadata. */
export type DofeGenerationCapabilityMetadata = {
  resolutions?: string[];
  ratios?: string[];
  durationSeconds?: { min?: number; max?: number; step?: number };
  maxInputAssets?: number;
  supportsGenerateAudio?: boolean;
};

export type DofeRouterModel = {
  id: string;
  ownedBy?: string;
  modelType?: string;
  capabilities?: string[];
  /**
   * Models-authoritative preferred protocol, projected from the capability
   * endpoint when the gateway exposes it. Undefined until the catalog refresh
   * observes it; `resolveDofeModelProtocol` then falls back to alias prefixes.
   */
  preferredProtocol?: DofeModelProtocol;
  supportedProtocols?: DofeModelProtocol[];
  /** Capability-keyed public parameter boundaries supplied by Models. */
  capabilityMetadata?: Record<string, DofeGenerationCapabilityMetadata>;
};

type OpenAIModelListResponse = {
  data?: Array<{ id?: unknown; owned_by?: unknown }>;
};

type ModelCapabilitiesResponse = {
  model_type?: unknown;
  capabilities?: Array<{
    capabilityName?: unknown;
    capabilityMetadata?: unknown;
  }>;
  preferred_protocol?: unknown;
  supported_protocols?: unknown;
};

function parseStringArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  return value;
}

function parseNumberRange(
  value: unknown,
): DofeGenerationCapabilityMetadata["durationSeconds"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const range = value as Record<string, unknown>;
  const result = Object.fromEntries(
    ["min", "max", "step"].flatMap((key) => {
      const candidate = range[key];
      return typeof candidate === "number" && Number.isFinite(candidate)
        ? [[key, candidate]]
        : [];
    }),
  ) as DofeGenerationCapabilityMetadata["durationSeconds"];
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Models already strips provider-private metadata. Validate the remaining
 * boundary before caching it so malformed catalog data cannot change request
 * validation or reach the browser.
 */
export function parseDofeGenerationCapabilityMetadata(
  value: unknown,
): DofeGenerationCapabilityMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const metadata = value as Record<string, unknown>;
  const result: DofeGenerationCapabilityMetadata = {
    ...(parseStringArray(metadata.resolutions)
      ? { resolutions: parseStringArray(metadata.resolutions) }
      : {}),
    ...(parseStringArray(metadata.ratios)
      ? { ratios: parseStringArray(metadata.ratios) }
      : {}),
    ...(parseNumberRange(metadata.durationSeconds)
      ? { durationSeconds: parseNumberRange(metadata.durationSeconds) }
      : {}),
    ...(typeof metadata.maxInputAssets === "number" &&
    Number.isInteger(metadata.maxInputAssets) &&
    metadata.maxInputAssets >= 0
      ? { maxInputAssets: metadata.maxInputAssets }
      : {}),
    ...(typeof metadata.supportsGenerateAudio === "boolean"
      ? { supportsGenerateAudio: metadata.supportsGenerateAudio }
      : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Validate and coerce an unknown value into a DofeModelProtocol. Returns
 * undefined for anything that is not one of the supported protocol identifiers
 * so we never pollute the cache with an invalid projection.
 */
export function parseDofeModelProtocol(
  value: unknown,
): DofeModelProtocol | undefined {
  if (value === "anthropic" || value === "gemini" || value === "openai") {
    return value;
  }
  return undefined;
}

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
    const response = await fetchFn(
      `${dofeModelProtocolBaseUrl(baseUrl, "openai")}/models`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    if (!response.ok) {
      throw new Error(
        `DoFe model catalog request failed with HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as OpenAIModelListResponse;
    if (!Array.isArray(payload.data)) {
      throw new Error(
        "DoFe model catalog response did not contain a model list",
      );
    }

    const aliases = payload.data.flatMap(
      (entry): Array<{ id: string; ownedBy?: string }> => {
        if (typeof entry.id !== "string") return [];
        return [
          {
            id: entry.id,
            ...(typeof entry.owned_by === "string"
              ? { ownedBy: entry.owned_by }
              : {}),
          },
        ];
      },
    );
    // Fetch each alias's capability doc. Use allSettled so one flaky capability
    // endpoint cannot empty the whole catalog — without a capability doc we
    // cannot classify model_type, so we drop that alias from the typed lists
    // but keep every other model. Generation still routes correctly via the
    // sole-provider fallback in the registry.
    const settled = await Promise.allSettled(
      aliases.map(async (entry): Promise<DofeRouterModel> => {
        const capabilityResponse = await fetchFn(
          `${dofeModelProtocolBaseUrl(baseUrl, "openai")}/models/${encodeURIComponent(entry.id)}/capabilities`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!capabilityResponse.ok) {
          throw new Error(
            `DoFe capability request failed for ${entry.id} with HTTP ${capabilityResponse.status}`,
          );
        }
        const capability =
          (await capabilityResponse.json()) as ModelCapabilitiesResponse;
        const preferredProtocol = parseDofeModelProtocol(
          capability.preferred_protocol,
        );
        const supportedProtocols = Array.isArray(capability.supported_protocols)
          ? capability.supported_protocols
              .map(parseDofeModelProtocol)
              .filter((p): p is DofeModelProtocol => p !== undefined)
          : undefined;
        // Cache the authoritative projection so deep-agent's synchronous
        // protocol resolver can use it without an extra round trip.
        if (preferredProtocol) {
          cacheDofeModelProtocol(entry.id, preferredProtocol);
        }
        return {
          ...entry,
          ...(typeof capability.model_type === "string"
            ? { modelType: capability.model_type }
            : {}),
          capabilities: Array.isArray(capability.capabilities)
            ? capability.capabilities.flatMap((item) =>
                typeof item?.capabilityName === "string"
                  ? [item.capabilityName]
                  : [],
              )
            : [],
          ...(Array.isArray(capability.capabilities)
            ? (() => {
                const entries = capability.capabilities.flatMap((item) => {
                  if (typeof item?.capabilityName !== "string") return [];
                  const metadata = parseDofeGenerationCapabilityMetadata(
                    item.capabilityMetadata,
                  );
                  return metadata
                    ? [[item.capabilityName, metadata] as const]
                    : [];
                });
                return entries.length > 0
                  ? { capabilityMetadata: Object.fromEntries(entries) }
                  : {};
              })()
            : {}),
          ...(preferredProtocol ? { preferredProtocol } : {}),
          ...(supportedProtocols ? { supportedProtocols } : {}),
        };
      }),
    );
    const dropped: string[] = [];
    const models = settled
      .flatMap((result, idx) => {
        if (result.status === "fulfilled") return [result.value];
        const failedId = aliases[idx]?.id;
        if (failedId) dropped.push(failedId);
        return [];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    if (dropped.length > 0) {
      console.warn(
        `[model-router] capability fetch dropped ${dropped.length}/${aliases.length} aliases from catalog`,
        { dropped },
      );
    }

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
      // `/v1/models` is a unified visibility list. Only Models' explicit LLM
      // projection is compatible with the agent chat surface; accepting every
      // non-image/video type would expose embedding, audio, or transcode aliases
      // to a text-completion client. `text` remains for older gateway payloads.
      return models.filter(
        (model) =>
          model.modelType !== undefined &&
          CHAT_MODEL_TYPES.has(model.modelType),
      );
    },
    async listImageModels() {
      return (await getModels()).filter(
        (model) =>
          model.modelType === "image" &&
          model.capabilities?.includes("text_to_image"),
      );
    },
    async listVideoModels() {
      return (await getModels()).filter((model) => model.modelType === "video");
    },
  };

  async function getModels() {
    if (cache && cache.expiresAt > now()) return cache.models;
    if (pending) return pending;

    pending = refresh()
      .catch((error: unknown) => {
        if (cache) {
          logOperationalWarning(
            "[model-router] catalog refresh failed using stale cache",
            "model_catalog_stale_cache",
          );
          return cache.models;
        }
        throw error;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
}

/**
 * Process-local cache of the Models-authoritative preferred protocol per alias.
 * Populated by the catalog refresh; read synchronously by deep-agent when it
 * selects the LangChain client. Falls back to alias-prefix matching on a miss.
 */
const preferredProtocolCache = new Map<string, DofeModelProtocol>();

export function cacheDofeModelProtocol(
  modelId: string,
  protocol: DofeModelProtocol,
): void {
  preferredProtocolCache.set(modelId, protocol);
}

/** Test/diagnostic helper: clears the protocol projection cache. */
export function resetDofeModelProtocolCache(): void {
  preferredProtocolCache.clear();
}

export function resolveDofeModelProtocol(modelId: string): DofeModelProtocol {
  const projected = preferredProtocolCache.get(modelId);
  if (projected) return projected;

  // Backward-compatible fallback: until/unless the gateway projects a protocol,
  // keep the existing alias-prefix heuristic so routing still works.
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
  return !/(?:^|[-_/])(imagen|image|seedream|seedance|veo|sora|kling|wan|hailuo)(?:[-_/]|$)/i.test(
    modelId,
  );
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
  if (
    provider === "dofe" ||
    provider === "openai" ||
    provider === "google" ||
    provider === "anthropic"
  ) {
    return specifier.slice(separator + 1);
  }
  return specifier;
}
