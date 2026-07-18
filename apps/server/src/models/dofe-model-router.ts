import type { ServerEnv } from "../config/env.js";

const CACHE_TTL_MS = 60_000;

export type DofeRouterModel = {
  id: string;
  ownedBy?: string;
};

type ModelListResponse = {
  data?: Array<{ id?: unknown; owned_by?: unknown }>;
};

export type DofeModelCatalog = {
  listChatModels(): Promise<DofeRouterModel[]>;
};

export function createDofeModelCatalog(
  env: Pick<ServerEnv, "dofeModelApiKey" | "dofeModelBaseUrl">,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): DofeModelCatalog | undefined {
  if (!env.dofeModelApiKey || !env.dofeModelBaseUrl) return undefined;

  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cache: { models: DofeRouterModel[]; expiresAt: number } | undefined;
  let pending: Promise<DofeRouterModel[]> | undefined;

  const refresh = async () => {
    const endpoint = `${env.dofeModelBaseUrl}/v1/models`;
    const response = await fetchFn(endpoint, {
      headers: { Authorization: `Bearer ${env.dofeModelApiKey}` },
    });
    if (!response.ok) {
      throw new Error(
        `DoFe model catalog request failed with HTTP ${response.status}`,
      );
    }
    const payload = (await response.json()) as ModelListResponse;
    if (!Array.isArray(payload.data)) {
      throw new Error(
        "DoFe model catalog response did not contain a model list",
      );
    }
    const models = payload.data
      .flatMap((entry): DofeRouterModel[] => {
        if (typeof entry.id !== "string" || !isChatModel(entry.id)) return [];
        return [
          {
            id: entry.id,
            ...(typeof entry.owned_by === "string"
              ? { ownedBy: entry.owned_by }
              : {}),
          },
        ];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    cache = { models, expiresAt: now() + CACHE_TTL_MS };
    return models;
  };

  return {
    async listChatModels() {
      if (cache && cache.expiresAt > now()) return cache.models;
      if (!pending) {
        pending = refresh().finally(() => {
          pending = undefined;
        });
      }
      return pending;
    },
  };
}

function isChatModel(modelId: string): boolean {
  return !/(?:^|[-_/])(imagen|image|seedream|seedance|veo|sora|kling|wan|hailuo)(?:[-_/]|$)/i.test(
    modelId,
  );
}
