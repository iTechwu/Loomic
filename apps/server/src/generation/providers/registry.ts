import type {
  ImageProvider,
  ModelInfo,
  VideoModelInfo,
  VideoProvider,
} from "../types.js";
import { GenerationError } from "../utils.js";

const imageProviders = new Map<string, ImageProvider>();
const videoProviders = new Map<string, VideoProvider>();

export function registerImageProvider(provider: ImageProvider): void {
  imageProviders.set(provider.name, provider);
}

export function registerVideoProvider(provider: VideoProvider): void {
  videoProviders.set(provider.name, provider);
}

export function getImageProvider(name: string): ImageProvider {
  const provider = imageProviders.get(name);
  if (!provider) {
    throw new GenerationError(
      name,
      "provider_not_found",
      `No image provider registered: ${name}`,
    );
  }
  return provider;
}

export function getVideoProvider(name: string): VideoProvider {
  const provider = videoProviders.get(name);
  if (!provider) {
    throw new GenerationError(
      name,
      "provider_not_found",
      `No video provider registered: ${name}`,
    );
  }
  return provider;
}

/** Model info enriched with its owning provider name. */
export interface AvailableModel extends ModelInfo {
  provider: string;
}

/** Video model info enriched with its owning provider name. */
export interface AvailableVideoModel extends VideoModelInfo {
  provider: string;
}

/** Returns all image models from all registered providers. */
export function getAvailableImageModels(): AvailableModel[] {
  return [...imageProviders.values()].flatMap((p) =>
    p.models.map((m) => ({ ...m, provider: p.name })),
  );
}

/** Returns all video models from all registered providers. */
export function getAvailableVideoModels(): AvailableVideoModel[] {
  return [...videoProviders.values()].flatMap((p) =>
    p.models.map((m) => ({ ...m, provider: p.name })),
  );
}

/** Resolves the provider name that handles a given image model ID. */
export function resolveImageProviderName(modelId: string): string {
  for (const provider of imageProviders.values()) {
    if (provider.models.some((m) => m.id === modelId)) {
      return provider.name;
    }
  }
  // No explicit match. A provider's model list can be empty during the boot
  // race (registerAllProviders populates it asynchronously from /v1/models) or
  // when a capability fetch failed. When exactly one provider is registered —
  // the gateway-only case — it owns every model id, so route to it and let the
  // gateway validate the alias authoritatively instead of failing generation
  // with a spurious model_not_found.
  const soleProvider = [...imageProviders.values()][0];
  if (imageProviders.size === 1 && soleProvider) {
    return soleProvider.name;
  }
  throw new GenerationError(
    "unknown",
    "model_not_found",
    `No provider registered for image model: ${modelId}`,
  );
}

/** Resolves the provider name that handles a given video model ID. */
export function resolveVideoProviderName(modelId: string): string {
  for (const provider of videoProviders.values()) {
    if (provider.models.some((m) => m.id === modelId)) {
      return provider.name;
    }
  }
  // See resolveImageProviderName: don't let an unpopulated catalog fail a
  // generation when a single registered provider owns all video models.
  const soleProvider = [...videoProviders.values()][0];
  if (videoProviders.size === 1 && soleProvider) {
    return soleProvider.name;
  }
  throw new GenerationError(
    "unknown",
    "model_not_found",
    `No provider registered for video model: ${modelId}`,
  );
}

export function clearProviders(): void {
  imageProviders.clear();
  videoProviders.clear();
}
