import { afterEach, describe, expect, it } from "vitest";

import type { ImageProvider, VideoProvider } from "../types.js";
import type { GenerationError } from "../utils.js";
import {
  clearProviders,
  registerImageProvider,
  registerVideoProvider,
  resolveImageProviderName,
  resolveVideoProviderName,
} from "./registry.js";

afterEach(() => {
  clearProviders();
});

// Minimal provider doubles — only `name` and `models` are exercised by the
// resolver, so we stub the rest as `never` for the cast.
function imageProvider(name: string, ids: string[]): ImageProvider {
  return {
    name,
    models: ids.map((id) => ({ id, displayName: id, description: "" })),
  } as unknown as ImageProvider;
}

function videoProvider(name: string, ids: string[]): VideoProvider {
  return {
    name,
    models: ids.map((id) => ({
      id,
      displayName: id,
      description: "",
      capabilities: {
        textToVideo: true,
        imageToVideo: false,
        videoToVideo: false,
        audio: false,
      },
    })),
  } as unknown as VideoProvider;
}

/** Assert that `fn` throws a GenerationError with the given code. */
function expectGenerationError(
  fn: () => unknown,
  code: string,
  messageContains: string,
): void {
  try {
    fn();
    throw new Error("expected the function to throw");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "expected the function to throw"
    ) {
      throw error;
    }
    expect((error as GenerationError).code).toBe(code);
    expect((error as Error).message).toContain(messageContains);
  }
}

describe("resolveImageProviderName", () => {
  it("returns the provider that lists the model", () => {
    registerImageProvider(
      imageProvider("dofe", ["flux-kontext-pro", "seedream-5.0"]),
    );
    expect(resolveImageProviderName("seedream-5.0")).toBe("dofe");
  });

  it("falls back to the sole registered provider when the catalog list is empty (boot race / partial catalog)", () => {
    // The provider is registered but its model list has not been populated yet
    // (registerAllProviders populates asynchronously from /v1/models).
    // Generation must still route to it instead of failing with model_not_found.
    registerImageProvider(imageProvider("dofe", []));
    expect(resolveImageProviderName("flux-kontext-pro")).toBe("dofe");
  });

  it("still throws when no provider is registered", () => {
    expectGenerationError(
      () => resolveImageProviderName("flux-kontext-pro"),
      "model_not_found",
      "No provider registered for image model: flux-kontext-pro",
    );
  });

  it("throws model_not_found when multiple providers are registered and none list the model", () => {
    registerImageProvider(imageProvider("dofe", []));
    registerImageProvider(imageProvider("replicate", []));
    expectGenerationError(
      () => resolveImageProviderName("flux-kontext-pro"),
      "model_not_found",
      "No provider registered for image model: flux-kontext-pro",
    );
  });
});

describe("resolveVideoProviderName", () => {
  it("returns the provider that lists the model", () => {
    registerVideoProvider(videoProvider("dofe", ["seedance-2.0"]));
    expect(resolveVideoProviderName("seedance-2.0")).toBe("dofe");
  });

  it("falls back to the sole registered provider when the catalog list is empty", () => {
    registerVideoProvider(videoProvider("dofe", []));
    expect(resolveVideoProviderName("seedance-2.0")).toBe("dofe");
  });

  it("still throws when no provider is registered", () => {
    expectGenerationError(
      () => resolveVideoProviderName("seedance-2.0"),
      "model_not_found",
      "No provider registered for video model: seedance-2.0",
    );
  });
});
